require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('./config/db');
const User = require('./models/User');
const Friendship = require('./models/Friendship');
const Block = require('./models/Block');
const Notification = require('./models/Notification');
const {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  unfriend,
  getFriends,
  getIncomingRequests,
  getSentRequests,
  getFriendshipHistory
} = require('./controllers/friendController');

// Mock Express req/res helper for clean controller unit and integration testing
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

async function runFriendshipTestSuite() {
  console.log('========================================================');
  console.log('       COMPLETE FRIENDSHIP SYSTEM VERIFICATION SUITE    ');
  console.log('========================================================\n');

  await connectDB();

  // Clean previous test data
  const testEmailPrefix = `test_friend_${Date.now()}`;
  console.log('[1] Creating 3 distinct authenticated test campus users...');

  const alice = await User.create({
    name: 'Alice Springs',
    email: `${testEmailPrefix}_alice@thequad.edu`,
    password: 'Password123!',
    dateOfBirth: new Date('2001-01-15'),
    gender: 'female',
    city: 'Campus West'
  });

  const bob = await User.create({
    name: 'Bob Harper',
    email: `${testEmailPrefix}_bob@thequad.edu`,
    password: 'Password123!',
    dateOfBirth: new Date('2000-05-20'),
    gender: 'male',
    city: 'Campus North'
  });

  const charlie = await User.create({
    name: 'Charlie Davis',
    email: `${testEmailPrefix}_charlie@thequad.edu`,
    password: 'Password123!',
    dateOfBirth: new Date('2002-11-08'),
    gender: 'non-binary',
    city: 'Campus East'
  });

  console.log(`  Alice ID:   ${alice._id}`);
  console.log(`  Bob ID:     ${bob._id}`);
  console.log(`  Charlie ID: ${charlie._id}\n`);

  try {
    // -----------------------------------------------------------
    // TEST 1: Prevent sending a friend request to oneself
    // -----------------------------------------------------------
    console.log('[TEST 1] Prevent sending friend request to oneself');
    {
      const { req, res, next } = createMockReqRes(alice, {}, { recipientId: alice._id.toString() });
      await sendFriendRequest(req, res, next);
      assert(res.getStatusCode() === 400, 'Returns HTTP 400 for self-friend request');
      assert(res.getResponse().success === false, 'success is false');
      assert(res.getResponse().message.includes('yourself'), 'Message indicates self-friend request blocked');
    }

    // -----------------------------------------------------------
    // TEST 2: Alice sends friend request to Bob
    // -----------------------------------------------------------
    console.log('\n[TEST 2] Alice sends valid friend request to Bob');
    let aliceToBobRequestId = null;
    {
      const { req, res, next } = createMockReqRes(
        alice,
        {},
        { recipientId: bob._id.toString(), message: 'Hey Bob, let us explore the Love Garden!' }
      );
      await sendFriendRequest(req, res, next);
      assert(res.getStatusCode() === 201, 'Returns HTTP 201 Created');
      assert(res.getResponse().success === true, 'success is true');
      const data = res.getResponse().data;
      assert(data.status === 'PENDING', 'Status is PENDING');
      assert(data.requester._id.toString() === alice._id.toString(), 'Requester is Alice');
      assert(data.recipient._id.toString() === bob._id.toString(), 'Recipient is Bob');
      aliceToBobRequestId = data._id.toString();

      // Check persistent notification
      const notif = await Notification.findOne({ recipient: bob._id, type: 'friend_request' });
      assert(notif !== null, 'Persistent in-app notification created for Bob');
      assert(notif.message.includes('Alice Springs'), 'Notification mentions Alice by name');
    }

    // -----------------------------------------------------------
    // TEST 3: Prevent duplicate pending request in same direction
    // -----------------------------------------------------------
    console.log('\n[TEST 3] Prevent duplicate pending request (Alice -> Bob again)');
    {
      const { req, res, next } = createMockReqRes(alice, {}, { recipientId: bob._id.toString() });
      await sendFriendRequest(req, res, next);
      assert(res.getStatusCode() === 400, 'Returns HTTP 400 for duplicate request');
      assert(res.getResponse().message.includes('already sent a pending friend request'), 'Message blocks duplicate');
    }

    // -----------------------------------------------------------
    // TEST 4: Prevent duplicate pending request in opposite direction
    // -----------------------------------------------------------
    console.log('\n[TEST 4] Prevent duplicate pending request in reverse direction (Bob -> Alice)');
    {
      const { req, res, next } = createMockReqRes(bob, {}, { recipientId: alice._id.toString() });
      await sendFriendRequest(req, res, next);
      assert(res.getStatusCode() === 400, 'Returns HTTP 400 for reverse pending request');
      assert(res.getResponse().message.includes('already sent you a friend request'), 'Advises user to accept instead');
    }

    // -----------------------------------------------------------
    // TEST 5: Verify GET /friends/requests and GET /friends/requests/sent
    // -----------------------------------------------------------
    console.log('\n[TEST 5] Verify incoming and sent request listings');
    {
      // Bob should see 1 incoming request from Alice
      const { req, res, next } = createMockReqRes(bob);
      await getIncomingRequests(req, res, next);
      assert(res.getStatusCode() === 200, 'Bob GET /friends/requests returns 200');
      assert(res.getResponse().data.length === 1, 'Bob has 1 incoming request');
      assert(res.getResponse().data[0].requester.name === 'Alice Springs', 'Incoming request is from Alice');

      // Alice should see 1 sent request to Bob
      const { req: reqA, res: resA, next: nextA } = createMockReqRes(alice);
      await getSentRequests(reqA, resA, nextA);
      assert(resA.getStatusCode() === 200, 'Alice GET /friends/requests/sent returns 200');
      assert(resA.getResponse().data.length === 1, 'Alice has 1 sent request');
      assert(resA.getResponse().data[0].recipient.name === 'Bob Harper', 'Sent request is to Bob');
    }

    // -----------------------------------------------------------
    // TEST 6: Security: Charlie (unauthorized third-party) cannot accept
    // -----------------------------------------------------------
    console.log('\n[TEST 6] Security: Charlie cannot accept Alice -> Bob request');
    {
      const { req, res, next } = createMockReqRes(charlie, { requestId: aliceToBobRequestId });
      await acceptFriendRequest(req, res, next);
      assert(res.getStatusCode() === 403, 'Returns HTTP 403 Forbidden');
      assert(res.getResponse().message.includes('not authorized to accept'), 'Forbidden message returned');
    }

    // -----------------------------------------------------------
    // TEST 7: Security: Alice (requester) cannot accept her own request
    // -----------------------------------------------------------
    console.log('\n[TEST 7] Security: Requester cannot accept their own request');
    {
      const { req, res, next } = createMockReqRes(alice, { requestId: aliceToBobRequestId });
      await acceptFriendRequest(req, res, next);
      assert(res.getStatusCode() === 403, 'Returns HTTP 403 Forbidden');
      assert(res.getResponse().message.includes('cannot accept your own'), 'Forbidden message returned');
    }

    // -----------------------------------------------------------
    // TEST 8: Security: Charlie cannot decline Alice -> Bob request
    // -----------------------------------------------------------
    console.log('\n[TEST 8] Security: Charlie cannot decline Alice -> Bob request');
    {
      const { req, res, next } = createMockReqRes(charlie, { requestId: aliceToBobRequestId });
      await declineFriendRequest(req, res, next);
      assert(res.getStatusCode() === 403, 'Returns HTTP 403 Forbidden');
    }

    // -----------------------------------------------------------
    // TEST 9: Security: Bob (recipient) cannot cancel Alice's request (only sender can cancel)
    // -----------------------------------------------------------
    console.log('\n[TEST 9] Security: Recipient cannot cancel request (must decline instead)');
    {
      const { req, res, next } = createMockReqRes(bob, { requestId: aliceToBobRequestId });
      await cancelFriendRequest(req, res, next);
      assert(res.getStatusCode() === 403, 'Returns HTTP 403 Forbidden');
      assert(res.getResponse().message.includes('Only the sender can cancel'), 'Error explains only sender can cancel');
    }

    // -----------------------------------------------------------
    // TEST 10: Bob (authorized recipient) accepts the friend request
    // -----------------------------------------------------------
    console.log('\n[TEST 10] Bob accepts Alice friend request');
    {
      const { req, res, next } = createMockReqRes(bob, { requestId: aliceToBobRequestId });
      await acceptFriendRequest(req, res, next);
      assert(res.getStatusCode() === 200, 'Returns HTTP 200 OK');
      assert(res.getResponse().data.status === 'ACCEPTED', 'Status transitioned to ACCEPTED');
      assert(res.getResponse().data.acceptedAt !== null, 'acceptedAt timestamp is set');
      assert(res.getResponse().data.actionUserId.toString() === bob._id.toString(), 'actionUserId is Bob');

      // Check persistent accepted notification for Alice
      const notif = await Notification.findOne({ recipient: alice._id, type: 'friend_accepted' });
      assert(notif !== null, 'Persistent notification created for Alice');
    }

    // -----------------------------------------------------------
    // TEST 11: Prevent accepting an already accepted request
    // -----------------------------------------------------------
    console.log('\n[TEST 11] Prevent re-accepting an already accepted request');
    {
      const { req, res, next } = createMockReqRes(bob, { requestId: aliceToBobRequestId });
      await acceptFriendRequest(req, res, next);
      assert(res.getStatusCode() === 400, 'Returns HTTP 400 for already accepted request');
    }

    // -----------------------------------------------------------
    // TEST 12: Prevent duplicate friendship request when already friends
    // -----------------------------------------------------------
    console.log('\n[TEST 12] Prevent duplicate friend request when already friends');
    {
      const { req, res, next } = createMockReqRes(alice, {}, { recipientId: bob._id.toString() });
      await sendFriendRequest(req, res, next);
      assert(res.getStatusCode() === 400, 'Returns HTTP 400');
      assert(res.getResponse().message.includes('already friends'), 'Message indicates already friends');
    }

    // -----------------------------------------------------------
    // TEST 13: GET /friends returns friends for both Alice and Bob
    // -----------------------------------------------------------
    console.log('\n[TEST 13] Verify GET /friends listing for both users');
    {
      // Alice's friends
      const { req: reqA, res: resA, next: nextA } = createMockReqRes(alice);
      await getFriends(reqA, resA, nextA);
      assert(resA.getStatusCode() === 200, 'Alice GET /friends returns 200');
      assert(resA.getResponse().data.length === 1, 'Alice has 1 friend');
      assert(resA.getResponse().data[0].friend.name === 'Bob Harper', 'Alice friend is Bob');

      // Bob's friends
      const { req: reqB, res: resB, next: nextB } = createMockReqRes(bob);
      await getFriends(reqB, resB, nextB);
      assert(resB.getStatusCode() === 200, 'Bob GET /friends returns 200');
      assert(resB.getResponse().data.length === 1, 'Bob has 1 friend');
      assert(resB.getResponse().data[0].friend.name === 'Alice Springs', 'Bob friend is Alice');

      // Charlie has 0 friends
      const { req: reqC, res: resC, next: nextC } = createMockReqRes(charlie);
      await getFriends(reqC, resC, nextC);
      assert(resC.getResponse().data.length === 0, 'Charlie has 0 friends');
    }

    // -----------------------------------------------------------
    // TEST 14: Unfriend via DELETE /friends/:friendId
    // -----------------------------------------------------------
    console.log('\n[TEST 14] Unfriend via DELETE /friends/:friendId');
    {
      // Charlie cannot unfriend Alice (not friends)
      const { req: reqC, res: resC, next: nextC } = createMockReqRes(charlie, { friendId: alice._id.toString() });
      await unfriend(reqC, resC, nextC);
      assert(resC.getStatusCode() === 404, 'Charlie unfriend Alice returns 404 Not Found');

      // Alice unfriends Bob
      const { req: reqA, res: resA, next: nextA } = createMockReqRes(alice, { friendId: bob._id.toString() });
      await unfriend(reqA, resA, nextA);
      assert(resA.getStatusCode() === 200, 'Alice unfriend Bob returns 200 OK');

      // Rule: Do not destroy historical records simply because a friendship is removed!
      const preservedRecord = await Friendship.findOne({
        status: 'REMOVED',
        $or: [
          { requester: alice._id, recipient: bob._id },
          { requester: bob._id, recipient: alice._id }
        ]
      });
      assert(preservedRecord !== null, 'Friendship record is permanently preserved in database (not destroyed)');
      assert(preservedRecord.removed_at !== null, 'removed_at timestamp is set');
      assert(preservedRecord.accepted_at !== null, 'accepted_at timestamp is preserved');

      // Alice now has 0 active friends
      const { req: reqA2, res: resA2, next: nextA2 } = createMockReqRes(alice);
      await getFriends(reqA2, resA2, nextA2);
      assert(resA2.getResponse().data.length === 0, 'Alice has 0 active friends after unfriending');
    }

    // -----------------------------------------------------------
    // TEST 15: Send new request -> Recipient declines (DECLINED state)
    // -----------------------------------------------------------
    console.log('\n[TEST 15] Send new request and Decline (DECLINED state)');
    {
      // Charlie sends request to Alice
      const { req: req1, res: res1, next: next1 } = createMockReqRes(charlie, {}, { recipientId: alice._id.toString() });
      await sendFriendRequest(req1, res1, next1);
      assert(res1.getStatusCode() === 201, 'Charlie sends request to Alice (201)');
      const charlieReqId = res1.getResponse().data._id.toString();

      // Alice declines
      const { req: req2, res: res2, next: next2 } = createMockReqRes(alice, { requestId: charlieReqId });
      await declineFriendRequest(req2, res2, next2);
      assert(res2.getStatusCode() === 200, 'Alice declines Charlie request (200)');
      assert(res2.getResponse().data.status === 'DECLINED', 'Status is DECLINED');
      assert(res2.getResponse().data.declinedAt !== null, 'declinedAt timestamp is set');
    }

    // -----------------------------------------------------------
    // TEST 16: Send new request -> Requester cancels (CANCELLED state)
    // -----------------------------------------------------------
    console.log('\n[TEST 16] Send new request and Cancel (CANCELLED state)');
    {
      // Bob sends request to Charlie
      const { req: req1, res: res1, next: next1 } = createMockReqRes(bob, {}, { recipientId: charlie._id.toString() });
      await sendFriendRequest(req1, res1, next1);
      assert(res1.getStatusCode() === 201, 'Bob sends request to Charlie (201)');
      const bobReqId = res1.getResponse().data._id.toString();

      // Bob cancels
      const { req: req2, res: res2, next: next2 } = createMockReqRes(bob, { requestId: bobReqId });
      await cancelFriendRequest(req2, res2, next2);
      assert(res2.getStatusCode() === 200, 'Bob cancels request (200)');
      assert(res2.getResponse().data.status === 'CANCELLED', 'Status is CANCELLED');
      assert(res2.getResponse().data.cancelledAt !== null, 'cancelledAt timestamp is set');
    }

    // -----------------------------------------------------------
    // TEST 17: Block restrictions (BLOCKED state)
    // -----------------------------------------------------------
    console.log('\n[TEST 17] Block restrictions: sending requests to/from blocked users');
    {
      // Alice blocks Charlie
      await Block.create({ blocker: alice._id, blocked: charlie._id });

      // Charlie tries to send friend request to Alice -> 403
      const { req: req1, res: res1, next: next1 } = createMockReqRes(charlie, {}, { recipientId: alice._id.toString() });
      await sendFriendRequest(req1, res1, next1);
      assert(res1.getStatusCode() === 403, 'Charlie cannot send request to Alice who blocked him (403)');

      // Alice tries to send friend request to Charlie whom she blocked -> 403
      const { req: req2, res: res2, next: next2 } = createMockReqRes(alice, {}, { recipientId: charlie._id.toString() });
      await sendFriendRequest(req2, res2, next2);
      assert(res2.getStatusCode() === 403, 'Alice cannot send request to user she blocked (403)');
    }

    // -----------------------------------------------------------
    // TEST 18: GET /friends/history
    // -----------------------------------------------------------
    console.log('\n[TEST 18] GET /friends/history audit trail');
    {
      const { req, res, next } = createMockReqRes(alice);
      await getFriendshipHistory(req, res, next);
      assert(res.getStatusCode() === 200, 'Returns 200 OK');
      const history = res.getResponse().data;
      assert(Array.isArray(history), 'History is an array');
      assert(history.length >= 2, 'History contains multiple logged events');
      assert(history[0].actionTakenByMe !== undefined, 'History includes actionTakenByMe indicator');
      assert(history[0].status !== undefined, 'History includes state');
      console.log(`  Audit history items for Alice: ${history.length}`);
    }

    console.log('\n========================================================');
    console.log('  🎉 ALL 18 FRIENDSHIP SYSTEM TESTS PASSED SUCCESSFULLY! ');
    console.log('========================================================\n');
  } finally {
    // Clean up test records
    await Friendship.deleteMany({
      $or: [
        { requester: { $in: [alice._id, bob._id, charlie._id] } },
        { recipient: { $in: [alice._id, bob._id, charlie._id] } }
      ]
    });
    await Block.deleteMany({
      $or: [
        { blocker: { $in: [alice._id, bob._id, charlie._id] } },
        { blocked: { $in: [alice._id, bob._id, charlie._id] } }
      ]
    });
    await Notification.deleteMany({
      $or: [
        { recipient: { $in: [alice._id, bob._id, charlie._id] } },
        { sender: { $in: [alice._id, bob._id, charlie._id] } }
      ]
    });
    await User.deleteMany({
      _id: { $in: [alice._id, bob._id, charlie._id] }
    });

    await disconnectDB();
  }
}

runFriendshipTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
