/**
 * test-realtime-messaging-delivery.js
 * Verification of Real-Time 1-to-1 Private Messaging Delivery between Campus Users
 */

const { io: ioClient } = require('../frontend/node_modules/socket.io-client');

const API_URL = 'http://127.0.0.1:5000';
const SOCKET_URL = 'http://127.0.0.1:5000';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function run() {
  console.log('================================================================');
  console.log('   REAL-TIME PRIVATE MESSAGING DELIVERY VERIFICATION            ');
  console.log('================================================================\n');

  // 1. Authenticate both test users
  const res1 = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sahatanush511@gmail.com', password: 'password123' })
  });
  const data1 = await res1.json();
  const token1 = data1.data.token;
  const user1 = data1.data.user;

  const res2 = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'sahatanush5@gmail.com', password: 'password123' })
  });
  const data2 = await res2.json();
  const token2 = data2.data.token;
  const user2 = data2.data.user;

  assert(token1 && token2, 'Both authentication tokens retrieved');
  console.log(`User 1: ${user1.name} (${user1._id})`);
  console.log(`User 2: ${user2.name} (${user2._id})\n`);

  // 2. Fetch conversation ID via API
  const convRes = await fetch(`${API_URL}/api/conversations/with/${user2._id}`, {
    headers: { Authorization: `Bearer ${token1}` }
  });
  const convData = await convRes.json();
  const conversationId = convData.data.conversation_id;
  assert(conversationId, `Resolved conversation ID: ${conversationId}`);

  // 3. Connect WebSockets for both users
  const s1 = ioClient(SOCKET_URL, { auth: { token: token1 }, transports: ['websocket'] });
  const s2 = ioClient(SOCKET_URL, { auth: { token: token2 }, transports: ['websocket'] });

  await Promise.all([
    new Promise((r) => s1.on('connect', r)),
    new Promise((r) => s2.on('connect', r))
  ]);

  assert(s1.connected && s2.connected, 'Both users connected to WebSocket server');

  // Both join conversation channel
  s1.emit('conversation:join', { conversationId });
  s2.emit('conversation:join', { conversationId });

  await new Promise((r) => setTimeout(r, 400));

  // 4. Test User 1 -> User 2 Message Send
  console.log('\n[TEST 1] User 1 sending message: "hello Saha 5, can you hear me?"');
  let user2ReceivedMsg = null;

  s2.on('message_received', (msg) => {
    user2ReceivedMsg = msg;
  });

  const testMsg1 = 'hello Saha 5, can you hear me? ' + Date.now();

  const sendAck = await new Promise((resolve) => {
    s1.emit('message:send', { conversationId, text: testMsg1 }, resolve);
  });

  assert(sendAck && sendAck.success, 'Server acknowledged User 1 message:send');
  console.log('  ✓ Server confirmed sendAck success');

  // Wait for real-time delivery to s2
  for (let i = 0; i < 20; i++) {
    if (user2ReceivedMsg) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  assert(user2ReceivedMsg !== null, 'User 2 received real-time message_received event!');
  assert(user2ReceivedMsg.content === testMsg1, `Message content matches: "${user2ReceivedMsg.content}"`);
  console.log('  ✓ User 2 received exact message content in real time!\n');

  // 5. Test User 2 -> User 1 Reply
  console.log('[TEST 2] User 2 replying: "Yes Tanush! Message received loud and clear!"');
  let user1ReceivedReply = null;

  s1.on('message_received', (msg) => {
    user1ReceivedReply = msg;
  });

  const testMsg2 = 'Yes Tanush! Message received loud and clear! ' + Date.now();

  const replyAck = await new Promise((resolve) => {
    s2.emit('message:send', { conversationId, text: testMsg2 }, resolve);
  });

  assert(replyAck && replyAck.success, 'Server acknowledged User 2 reply');

  for (let i = 0; i < 20; i++) {
    if (user1ReceivedReply) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  assert(user1ReceivedReply !== null, 'User 1 received real-time reply from User 2!');
  assert(user1ReceivedReply.content === testMsg2, `Reply content matches: "${user1ReceivedReply.content}"`);
  console.log('  ✓ User 1 received reply in real time!\n');

  // 6. Test Polymorphic Resolution with Target User ID
  console.log('[TEST 3] Testing polymorphic send using targetUserId instead of conversationId');
  let user2ReceivedPolyMsg = null;

  s2.on('message_received', (msg) => {
    if (msg.content.includes('polymorphic')) {
      user2ReceivedPolyMsg = msg;
    }
  });

  const testMsg3 = 'Testing polymorphic targetUserId delivery! ' + Date.now();
  const polyAck = await new Promise((resolve) => {
    s1.emit('message:send', { targetUserId: user2._id, text: testMsg3 }, resolve);
  });

  assert(polyAck && polyAck.success, 'Server resolved conversation polymorphically by targetUserId');

  for (let i = 0; i < 20; i++) {
    if (user2ReceivedPolyMsg) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  assert(user2ReceivedPolyMsg !== null, 'User 2 received message sent via targetUserId!');
  console.log('  ✓ Polymorphic targetUserId delivery verified!\n');

  s1.disconnect();
  s2.disconnect();

  console.log('================================================================');
  console.log('🎉 ALL REAL-TIME MESSAGING DELIVERY TESTS PASSED (100%)!       ');
  console.log('================================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
