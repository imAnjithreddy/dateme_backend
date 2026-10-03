/**
 * test-direct-messaging.js
 * Verification of One-to-One Direct Messaging System
 *
 * Requirements:
 * 1. Both users are authenticated.
 * 2. A friendship exists.
 * 3. Friendship status is ACCEPTED.
 * 4. Neither user has blocked the other.
 * 5. Both accounts are allowed to communicate.
 *
 * Endpoints:
 * - GET  /conversations
 * - GET  /conversations/:conversationId/messages
 * - POST /conversations/:conversationId/messages
 *
 * Storage Fields:
 * - message_id
 * - conversation_id
 * - sender_id
 * - receiver_id
 * - content
 * - created_at
 * - updated_at
 * - read_at
 *
 * Security:
 * - Never trust sender_id from frontend. Derive sender from token.
 * - Server verifies user belongs to conversation.
 * - Prevents URL tampering to read other users' private conversations.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('./config/db');
const User = require('./models/User');
const Friendship = require('./models/Friendship');
const Block = require('./models/Block');
const Conversation = require('./models/Conversation');
const DirectMessage = require('./models/DirectMessage');
const {
  getConversations,
  getMessages,
  sendMessage
} = require('./controllers/conversationController');
const {
  sendFriendRequest,
  acceptFriendRequest
} = require('./controllers/friendController');

const assert = (condition, description) => {
  if (condition) {
    console.log(`  ✓ PASS: ${description}`);
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    throw new Error(`Assertion failed: ${description}`);
  }
};

const createMockReqRes = (user, params = {}, body = {}, query = {}) => {
  let statusCode = 200;
  let responseData = null;

  const req = { user, params, body, query, headers: {} };
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

async function runTests() {
  console.log('\n========================================================');
  console.log('       ONE-TO-ONE DIRECT MESSAGING TEST SUITE           ');
  console.log('========================================================\n');

  await connectDB();

  const timestamp = Date.now();

  // Create test users: Alice, Bob, and Eve (attacker)
  const alice = await User.create({
    name: `Alice_${timestamp}`,
    email: `alice_${timestamp}@test.edu`,
    password: 'password123',
    dateOfBirth: new Date('2002-05-15'),
    isVerified: true,
    campusYear: 'Junior',
    major: 'Computer Science'
  });

  const bob = await User.create({
    name: `Bob_${timestamp}`,
    email: `bob_${timestamp}@test.edu`,
    password: 'password123',
    dateOfBirth: new Date('2001-10-20'),
    isVerified: true,
    campusYear: 'Senior',
    major: 'Design'
  });

  const eve = await User.create({
    name: `Eve_${timestamp}`,
    email: `eve_${timestamp}@test.edu`,
    password: 'password123',
    dateOfBirth: new Date('2003-01-10'),
    isVerified: true,
    campusYear: 'Freshman',
    major: 'Cybersecurity'
  });

  console.log('Setup: Created test users Alice, Bob, and Eve.\n');

  // TEST 1: Reject messaging if NO friendship exists
  console.log('Test 1: Reject messaging if NO friendship exists');
  // Attempt to message before becoming friends
  // Create an unverified arbitrary conversation ID
  const fakeConvId = new mongoose.Types.ObjectId();
  const mockPostNoFriendship = createMockReqRes(
    alice,
    { conversationId: fakeConvId.toString() },
    { content: 'Hello stranger' }
  );
  await sendMessage(mockPostNoFriendship.req, mockPostNoFriendship.res, mockPostNoFriendship.next);
  assert(
    mockPostNoFriendship.res.getStatusCode() === 404,
    'Returns 404 when conversation does not exist'
  );

  // TEST 2: Reject messaging if friendship is still PENDING
  console.log('\nTest 2: Reject messaging if friendship is still PENDING');
  const reqResSendReq = createMockReqRes(alice, {}, { targetUserId: bob._id.toString(), note: 'Hi Bob!' });
  await sendFriendRequest(reqResSendReq.req, reqResSendReq.res, reqResSendReq.next);
  const pendingFriendship = await Friendship.findOne({ requester: alice._id, recipient: bob._id });
  assert(pendingFriendship.status === 'PENDING', 'Friendship is currently PENDING');

  // Create conversation entry for pending friendship
  const pendingConv = await Conversation.create({
    participants: [alice._id, bob._id],
    friendship: pendingFriendship._id
  });

  const mockPostPending = createMockReqRes(
    alice,
    { conversationId: pendingConv._id.toString() },
    { content: 'Message while pending' }
  );
  await sendMessage(mockPostPending.req, mockPostPending.res, mockPostPending.next);
  assert(
    mockPostPending.res.getStatusCode() === 403,
    'Rejects messaging with HTTP 403 when friendship status is not ACCEPTED'
  );
  assert(
    mockPostPending.res.getResponse()?.message.includes('ACCEPTED') ||
      mockPostPending.res.getResponse()?.message.includes('accepted'),
    'Error message clearly explains accepted friendship is required'
  );

  // TEST 3: Bob accepts friend request -> Friendship status is now ACCEPTED
  console.log('\nTest 3: Accept friend request -> Friendship status becomes ACCEPTED');
  const reqResAccept = createMockReqRes(bob, { requestId: pendingFriendship._id.toString() });
  await acceptFriendRequest(reqResAccept.req, reqResAccept.res, reqResAccept.next);
  const acceptedFriendship = await Friendship.findById(pendingFriendship._id);
  assert(acceptedFriendship.status === 'ACCEPTED', 'Friendship status is now ACCEPTED');

  // TEST 4: Send direct message from Alice to Bob (all conditions met)
  console.log('\nTest 4: Alice sends direct message to Bob successfully');
  const mockPostAlice = createMockReqRes(
    alice,
    { conversationId: pendingConv._id.toString() },
    { content: 'Hey Bob! Nice to connect on campus.' }
  );
  await sendMessage(mockPostAlice.req, mockPostAlice.res, mockPostAlice.next);
  assert(mockPostAlice.res.getStatusCode() === 201, 'Message created with HTTP 201');
  const sentMsg = mockPostAlice.res.getResponse()?.data;

  // Verify all required storage fields
  assert(sentMsg.message_id !== undefined, 'Contains message_id');
  assert(sentMsg.conversation_id === pendingConv._id.toString(), 'Contains valid conversation_id');
  assert(sentMsg.sender_id === alice._id.toString(), 'sender_id matches authenticated sender');
  assert(sentMsg.receiver_id === bob._id.toString(), 'receiver_id matches recipient');
  assert(sentMsg.content === 'Hey Bob! Nice to connect on campus.', 'content matches text');
  assert(sentMsg.created_at !== undefined, 'created_at timestamp is present');
  assert(sentMsg.updated_at !== undefined, 'updated_at timestamp is present');
  assert(sentMsg.read_at === null, 'read_at is initially null (unread)');

  // Verify database persistence
  const persistedMsg = await DirectMessage.findById(sentMsg.message_id);
  assert(persistedMsg !== null, 'Message is persistently stored in database');
  assert(persistedMsg.content === 'Hey Bob! Nice to connect on campus.', 'Stored content matches');

  // TEST 5: Never trust sender_id from frontend (Impersonation attempt prevention)
  console.log('\nTest 5: Never trust sender_id from frontend (spoofing prevention)');
  const mockPostSpoof = createMockReqRes(
    alice,
    { conversationId: pendingConv._id.toString() },
    {
      content: 'I am trying to pretend to be Bob!',
      sender_id: bob._id.toString(), // Attacker tries to spoof Bob's sender_id in payload
      sender: bob._id.toString()
    }
  );
  await sendMessage(mockPostSpoof.req, mockPostSpoof.res, mockPostSpoof.next);
  assert(mockPostSpoof.res.getStatusCode() === 201, 'Request handled safely');
  const spoofResult = mockPostSpoof.res.getResponse()?.data;
  assert(
    spoofResult.sender_id === alice._id.toString(),
    'Server derived sender_id strictly from authenticated token; client spoof ignored'
  );
  assert(
    spoofResult.sender_id !== bob._id.toString(),
    'Client cannot impersonate another sender_id'
  );

  // TEST 6: Bob replies to Alice
  console.log('\nTest 6: Bob replies to Alice');
  const mockPostBob = createMockReqRes(
    bob,
    { conversationId: pendingConv._id.toString() },
    { content: 'Hey Alice! Great to meet you at the cafe.' }
  );
  await sendMessage(mockPostBob.req, mockPostBob.res, mockPostBob.next);
  assert(mockPostBob.res.getStatusCode() === 201, 'Bob replies with HTTP 201');
  const bobSentMsg = mockPostBob.res.getResponse()?.data;
  assert(bobSentMsg.sender_id === bob._id.toString(), 'Bob is identified as sender');
  assert(bobSentMsg.receiver_id === alice._id.toString(), 'Alice is identified as recipient');

  // TEST 7: GET /conversations for Alice and Bob
  console.log('\nTest 7: GET /conversations lists active conversations');
  const mockGetConvsAlice = createMockReqRes(alice);
  await getConversations(mockGetConvsAlice.req, mockGetConvsAlice.res, mockGetConvsAlice.next);
  assert(mockGetConvsAlice.res.getStatusCode() === 200, 'Conversations retrieved with HTTP 200');
  const convListAlice = mockGetConvsAlice.res.getResponse()?.data?.conversations;
  assert(convListAlice.length >= 1, 'Alice has at least 1 active conversation');
  const aliceBobConv = convListAlice.find((c) => c.conversation_id === pendingConv._id.toString());
  assert(aliceBobConv !== undefined, 'Alice finds conversation with Bob');
  assert(aliceBobConv.partner._id.toString() === bob._id.toString(), 'Partner is Bob');
  assert(aliceBobConv.friendship_status === 'ACCEPTED', 'Friendship status is ACCEPTED');
  assert(aliceBobConv.unread_count === 1, 'Bob sent 1 unread message to Alice');
  assert(aliceBobConv.last_message.content === 'Hey Alice! Great to meet you at the cafe.', 'Last message matches');

  // TEST 8: GET /conversations/:conversationId/messages marks unread as read
  console.log('\nTest 8: GET /conversations/:conversationId/messages reads and marks read_at');
  const mockGetMessagesAlice = createMockReqRes(alice, { conversationId: pendingConv._id.toString() });
  await getMessages(mockGetMessagesAlice.req, mockGetMessagesAlice.res, mockGetMessagesAlice.next);
  assert(mockGetMessagesAlice.res.getStatusCode() === 200, 'Messages retrieved with HTTP 200');
  const msgData = mockGetMessagesAlice.res.getResponse()?.data;
  assert(msgData.messages.length === 3, 'All 3 messages retrieved');

  // Verify that message from Bob to Alice now has read_at populated
  const updatedBobMsg = await DirectMessage.findById(bobSentMsg.message_id);
  assert(updatedBobMsg.read_at !== null, 'read_at is populated after recipient reads conversation');

  // TEST 9: Security: URL Tampering Prevention (Unauthorized User C cannot read conversation)
  console.log('\nTest 9: URL tampering prevention (Third-party User Eve cannot read conversation)');
  const mockEveTamperGet = createMockReqRes(eve, { conversationId: pendingConv._id.toString() });
  await getMessages(mockEveTamperGet.req, mockEveTamperGet.res, mockEveTamperGet.next);
  assert(
    mockEveTamperGet.res.getStatusCode() === 403,
    'Server rejects unauthorized user with HTTP 403 Forbidden'
  );
  assert(
    mockEveTamperGet.res.getResponse()?.message.includes('not authorized'),
    'Rejection message clearly states lack of authorization'
  );

  // TEST 10: Security: URL Tampering Prevention (Third-party User Eve cannot send message)
  console.log('\nTest 10: URL tampering prevention (Third-party User Eve cannot inject message)');
  const mockEveTamperPost = createMockReqRes(
    eve,
    { conversationId: pendingConv._id.toString() },
    { content: 'Eve is injecting an unauthorized message' }
  );
  await sendMessage(mockEveTamperPost.req, mockEveTamperPost.res, mockEveTamperPost.next);
  assert(
    mockEveTamperPost.res.getStatusCode() === 403,
    'Server rejects injection attempt with HTTP 403 Forbidden'
  );

  // TEST 11: Blocking stops communication immediately
  console.log('\nTest 11: Blocking stops direct messaging immediately');
  await Block.create({
    blocker: alice._id,
    blocked: bob._id,
    reason: 'Testing block condition'
  });

  const mockPostBlocked = createMockReqRes(
    bob,
    { conversationId: pendingConv._id.toString() },
    { content: 'Can I still message you?' }
  );
  await sendMessage(mockPostBlocked.req, mockPostBlocked.res, mockPostBlocked.next);
  assert(
    mockPostBlocked.res.getStatusCode() === 403,
    'Messaging rejected with HTTP 403 when a block exists'
  );

  // Clean up test data
  await Block.deleteMany({
    $or: [{ blocker: alice._id }, { blocked: alice._id }, { blocker: bob._id }, { blocked: bob._id }]
  });
  await DirectMessage.deleteMany({ conversation_id: pendingConv._id });
  await Conversation.deleteMany({ _id: pendingConv._id });
  await Friendship.deleteMany({
    $or: [{ requester: alice._id }, { recipient: alice._id }, { requester: bob._id }, { recipient: bob._id }]
  });
  await User.deleteMany({ _id: { $in: [alice._id, bob._id, eve._id] } });

  console.log('\n========================================================');
  console.log('   ALL 11 DIRECT MESSAGING TESTS PASSED (100%)          ');
  console.log('========================================================\n');

  await disconnectDB();
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
