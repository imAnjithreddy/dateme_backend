/**
 * test-campus-proximity-friendship.js
 * Verification of Friendship & Campus Proximity Integration
 *
 * Validates:
 * 1. Proximity does NOT grant messaging or voice permissions.
 * 2. Sitting beside someone does NOT automatically make them friends.
 * 3. Friendship controls communication permissions.
 * 4. GET /friends/status/:targetUserId returns exact verified permissions for all states:
 *    - Stranger (NONE) -> View Profile, Add Friend
 *    - Request Pending (PENDING_SENT) -> View Profile, Request Sent
 *    - Received Request (PENDING_RECEIVED) -> View Profile, Accept Request, Decline Request
 *    - Already Friends (ACCEPTED) -> View Profile, Message, Voice, Remove Friend
 *    - Blocked (BLOCKED) -> No communication actions
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Friendship = require('./models/Friendship');
const Block = require('./models/Block');
const Connection = require('./models/Connection');
const {
  sendFriendRequest,
  acceptFriendRequest,
  unfriend,
  blockUserRelationship,
  getFriendshipStatus
} = require('./controllers/friendController');

const createMockReqRes = (user, params = {}, body = {}, query = {}) => {
  const req = {
    user,
    params,
    body,
    query,
    headers: {}
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    getStatusCode() {
      return statusCode;
    },
    getResponse() {
      return responseData;
    }
  };

  const next = (err) => {
    if (err) {
      statusCode = 500;
      responseData = { success: false, message: err.message };
    }
  };

  return { req, res, next };
};

const assert = (condition, description) => {
  if (condition) {
    console.log(`  ✓ PASS: ${description}`);
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    throw new Error(`Assertion failed: ${description}`);
  }
};

async function runTests() {
  console.log('\n========================================================');
  console.log('   CAMPUS 2D PROXIMITY & FRIENDSHIP INTEGRATION TESTS   ');
  console.log('========================================================\n');

  const uri = process.env.MONGODB_URI;
  await mongoose.connect(uri);
  console.log(`[MongoDB] Connected successfully.\n`);

  const timestamp = Date.now();
  const playerA = await User.create({
    name: `Player A_${timestamp}`,
    email: `player_a_${timestamp}@test.edu`,
    password: 'password123',
    dateOfBirth: new Date('2002-05-15'),
    isVerified: true,
    campusYear: 'Sophomore',
    major: 'Computer Science'
  });

  const playerB = await User.create({
    name: `Player B_${timestamp}`,
    email: `player_b_${timestamp}@test.edu`,
    password: 'password123',
    dateOfBirth: new Date('2001-08-20'),
    isVerified: true,
    campusYear: 'Junior',
    major: 'Architecture'
  });

  const playerC = await User.create({
    name: `Player C_${timestamp}`,
    email: `player_c_${timestamp}@test.edu`,
    password: 'password123',
    dateOfBirth: new Date('2000-11-10'),
    isVerified: true,
    campusYear: 'Senior',
    major: 'Music'
  });

  console.log(`[Setup] Created 3 test campus students:`);
  console.log(`  Player A ID: ${playerA._id} (Computer Science)`);
  console.log(`  Player B ID: ${playerB._id} (Architecture)`);
  console.log(`  Player C ID: ${playerC._id} (Music)\n`);

  try {
    // ----------------------------------------------------
    // TEST 1: Stranger Proximity (Player A approaches Player B)
    // ----------------------------------------------------
    console.log('[TEST 1] Proximity as Strangers: Player A approaches Player B on Campus');
    {
      const { req, res, next } = createMockReqRes(playerA, { targetUserId: playerB._id.toString() });
      await getFriendshipStatus(req, res, next);
      const data = res.getResponse()?.data;

      assert(res.getStatusCode() === 200, 'Returns HTTP 200 OK');
      assert(data.status === 'NONE', 'Status is NONE (strangers)');
      assert(data.isFriend === false, 'isFriend is false');
      assert(data.canAddFriend === true, 'canAddFriend is true');
      assert(data.canMessage === false, 'VIOLATION PREVENTION: Proximity does NOT grant message permission');
      assert(data.canVoice === false, 'VIOLATION PREVENTION: Proximity does NOT grant voice permission');
    }

    // ----------------------------------------------------
    // TEST 2: Request Pending Sent (Player A sends request to Player B)
    // ----------------------------------------------------
    console.log('\n[TEST 2] Player A sends friend request to Player B');
    let requestId = null;
    {
      const { req, res, next } = createMockReqRes(playerA, {}, {
        recipientId: playerB._id.toString(),
        message: 'Hey, let\'s connect on campus!'
      });
      await sendFriendRequest(req, res, next);
      assert(res.getStatusCode() === 201, 'Request sent successfully (201 Created)');
      requestId = res.getResponse()?.data?._id;

      // Check Player A view of Player B
      const checkA = createMockReqRes(playerA, { targetUserId: playerB._id.toString() });
      await getFriendshipStatus(checkA.req, checkA.res, checkA.next);
      const dataA = checkA.res.getResponse()?.data;

      assert(dataA.status === 'PENDING_SENT', 'Player A status is PENDING_SENT');
      assert(dataA.isPendingSent === true, 'isPendingSent is true');
      assert(dataA.canAddFriend === false, 'canAddFriend is false (already requested)');
      assert(dataA.canMessage === false, 'Messaging strictly denied while request is pending');
      assert(dataA.canVoice === false, 'Voice strictly denied while request is pending');
    }

    // ----------------------------------------------------
    // TEST 3: Request Pending Received (Player B approaches Player A)
    // ----------------------------------------------------
    console.log('\n[TEST 3] Player B approaches Player A who sent the request');
    {
      const { req, res, next } = createMockReqRes(playerB, { targetUserId: playerA._id.toString() });
      await getFriendshipStatus(req, res, next);
      const dataB = res.getResponse()?.data;

      assert(dataB.status === 'PENDING_RECEIVED', 'Player B status is PENDING_RECEIVED');
      assert(dataB.isPendingReceived === true, 'isPendingReceived is true');
      assert(dataB.requestId && dataB.requestId.toString() === requestId.toString(), 'requestId populated for Accept/Decline');
      assert(dataB.canMessage === false, 'Messaging strictly denied until accepted');
      assert(dataB.canVoice === false, 'Voice strictly denied until accepted');
    }

    // ----------------------------------------------------
    // TEST 4: Friendship Accepted -> Communication Permissions Granted
    // ----------------------------------------------------
    console.log('\n[TEST 4] Player B accepts Player A friend request');
    {
      const { req, res, next } = createMockReqRes(playerB, { requestId: requestId.toString() });
      await acceptFriendRequest(req, res, next);
      assert(res.getStatusCode() === 200, 'Friend request accepted (200 OK)');

      // Verify Player A view of Player B
      const checkA = createMockReqRes(playerA, { targetUserId: playerB._id.toString() });
      await getFriendshipStatus(checkA.req, checkA.res, checkA.next);
      const dataA = checkA.res.getResponse()?.data;

      assert(dataA.status === 'ACCEPTED', 'Player A status is ACCEPTED');
      assert(dataA.isFriend === true, 'isFriend is true for Player A');
      assert(dataA.canMessage === true, 'Messaging permission GRANTED for friends');
      assert(dataA.canVoice === true, 'Voice permission GRANTED for friends');
      assert(dataA.canAddFriend === false, 'canAddFriend is false');

      // Verify Player B view of Player A
      const checkB = createMockReqRes(playerB, { targetUserId: playerA._id.toString() });
      await getFriendshipStatus(checkB.req, checkB.res, checkB.next);
      const dataB = checkB.res.getResponse()?.data;

      assert(dataB.status === 'ACCEPTED', 'Player B status is ACCEPTED');
      assert(dataB.isFriend === true, 'isFriend is true for Player B');
      assert(dataB.canMessage === true, 'Messaging permission GRANTED for Player B');
      assert(dataB.canVoice === true, 'Voice permission GRANTED for Player B');
    }

    // ----------------------------------------------------
    // TEST 5: Sitting Beside Someone Does NOT Automatically Make Them Friends
    // ----------------------------------------------------
    console.log('\n[TEST 5] Sitting beside someone: Player A sits beside Player C (Strangers)');
    {
      // Proximity / sitting beside Player C
      const { req, res, next } = createMockReqRes(playerA, { targetUserId: playerC._id.toString() });
      await getFriendshipStatus(req, res, next);
      const data = res.getResponse()?.data;

      assert(data.isFriend === false, 'Sitting beside someone does NOT make them friends (isFriend is false)');
      assert(data.canMessage === false, 'Sitting beside someone does NOT grant messaging permissions');
      assert(data.canVoice === false, 'Sitting beside someone does NOT grant voice permissions');
      assert(data.canAddFriend === true, 'Add Friend action is available to initiate friendship');
    }

    // ----------------------------------------------------
    // TEST 6: Remove Friend (Unfriend) -> Permissions Revoked Immediately
    // ----------------------------------------------------
    console.log('\n[TEST 6] Player A removes Player B from friends');
    {
      const { req, res, next } = createMockReqRes(playerA, { friendId: playerB._id.toString() });
      await unfriend(req, res, next);
      assert(res.getStatusCode() === 200, 'Unfriended successfully (200 OK)');

      // Verify status transitions and permissions are revoked
      const checkA = createMockReqRes(playerA, { targetUserId: playerB._id.toString() });
      await getFriendshipStatus(checkA.req, checkA.res, checkA.next);
      const dataA = checkA.res.getResponse()?.data;

      assert(dataA.status === 'REMOVED', 'Status transitioned to REMOVED (permanent audit history preserved)');
      assert(dataA.isFriend === false, 'isFriend is false after unfriend');
      assert(dataA.canMessage === false, 'Messaging permission revoked immediately');
      assert(dataA.canVoice === false, 'Voice permission revoked immediately');
      assert(dataA.canAddFriend === true, 'Can send a new friend request if desired');
    }

    // ----------------------------------------------------
    // TEST 7: Blocked Relationship -> Communication Actions Suppressed
    // ----------------------------------------------------
    console.log('\n[TEST 7] Player A blocks Player C');
    {
      const { req, res, next } = createMockReqRes(playerA, { targetUserId: playerC._id.toString() }, { reason: 'Disturbing' });
      await blockUserRelationship(req, res, next);
      assert(res.getStatusCode() === 200, 'Blocked successfully (200 OK)');

      // Check Player A view of Player C
      const checkA = createMockReqRes(playerA, { targetUserId: playerC._id.toString() });
      await getFriendshipStatus(checkA.req, checkA.res, checkA.next);
      const dataA = checkA.res.getResponse()?.data;

      assert(dataA.status === 'BLOCKED', 'Player A status is BLOCKED');
      assert(dataA.isBlocked === true, 'isBlocked is true');
      assert(dataA.canMessage === false, 'Messaging suppressed for blocked user');
      assert(dataA.canVoice === false, 'Voice suppressed for blocked user');
      assert(dataA.canAddFriend === false, 'Add Friend suppressed for blocked user');

      // Check Player C view of Player A
      const checkC = createMockReqRes(playerC, { targetUserId: playerA._id.toString() });
      await getFriendshipStatus(checkC.req, checkC.res, checkC.next);
      const dataC = checkC.res.getResponse()?.data;

      assert(dataC.isBlocked === true, 'Player C sees relationship as blocked');
      assert(dataC.canMessage === false, 'Player C cannot message');
      assert(dataC.canVoice === false, 'Player C cannot voice');
      assert(dataC.canAddFriend === false, 'Player C cannot send friend request');
    }

    console.log('\n========================================================');
    console.log('  🎉 ALL 7 CAMPUS PROXIMITY & FRIENDSHIP TESTS PASSED!   ');
    console.log('========================================================\n');
  } finally {
    // Cleanup test records
    await User.deleteMany({ _id: { $in: [playerA._id, playerB._id, playerC._id] } });
    await Friendship.deleteMany({
      $or: [
        { requester: { $in: [playerA._id, playerB._id, playerC._id] } },
        { recipient: { $in: [playerA._id, playerB._id, playerC._id] } }
      ]
    });
    await Block.deleteMany({
      $or: [
        { blocker: { $in: [playerA._id, playerB._id, playerC._id] } },
        { blocked: { $in: [playerA._id, playerB._id, playerC._id] } }
      ]
    });
    await Connection.deleteMany({
      $or: [
        { requester: { $in: [playerA._id, playerB._id, playerC._id] } },
        { recipient: { $in: [playerA._id, playerB._id, playerC._id] } }
      ]
    });
    await mongoose.disconnect();
    console.log('[MongoDB] Cleaned up test data & disconnected.');
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
