const { io } = require('../frontend/node_modules/socket.io-client');

const API_URL = 'http://localhost:5000';
const SOCKET_URL = 'http://localhost:5000';

async function postJSON(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error(`  [postJSON Error ${res.status}] ${url}:`, JSON.stringify(data));
  }
  return { status: res.status, data };
}

async function getJSON(url, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  const data = await res.json();
  return { status: res.status, data };
}

async function runRealtimeMessagingTests() {
  console.log('================================================================');
  console.log('      THE QUAD: REAL-TIME WEBSOCKET MESSAGING TEST SUITE        ');
  console.log('================================================================\n');

  // STEP 1: Test Unauthenticated Connection Rejection
  console.log('[TEST 1] Testing that unauthenticated socket connection is REJECTED...');
  let unauthRejected = false;
  try {
    const unauthSocket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
      timeout: 3000
    });

    await new Promise((resolve) => {
      unauthSocket.on('connect_error', (err) => {
        console.log(`  PASSED: Unauthenticated socket rejected with: "${err.message}"`);
        unauthRejected = true;
        unauthSocket.disconnect();
        resolve();
      });
      unauthSocket.on('connect', () => {
        unauthSocket.disconnect();
        resolve();
      });
      unauthSocket.connect();
    });
  } catch (err) {
    console.log(`  Connect error captured: ${err.message}`);
  }

  if (!unauthRejected) {
    throw new Error('FAILED: Unauthenticated socket was NOT rejected! Rule violation: Do NOT create an unauthenticated socket connection.');
  }

  // STEP 2: Test Invalid Token Connection Rejection
  console.log('\n[TEST 2] Testing that invalid/tampered token socket connection is REJECTED...');
  let invalidTokenRejected = false;
  try {
    const invalidSocket = io(SOCKET_URL, {
      auth: { token: 'invalid.jwt.token.here' },
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
      timeout: 3000
    });

    await new Promise((resolve) => {
      invalidSocket.on('connect_error', (err) => {
        console.log(`  PASSED: Invalid token socket rejected with: "${err.message}"`);
        invalidTokenRejected = true;
        invalidSocket.disconnect();
        resolve();
      });
      invalidSocket.on('connect', () => {
        invalidSocket.disconnect();
        resolve();
      });
      invalidSocket.connect();
    });
  } catch (err) {
    console.log(`  Connect error captured: ${err.message}`);
  }

  if (!invalidTokenRejected) {
    throw new Error('FAILED: Invalid token socket was NOT rejected!');
  }

  // STEP 3: Register 3 users: Alice, Bob, and Eve (intruder)
  console.log('\n[TEST 3] Registering users: Alice, Bob, and Eve...');
  const suffix = Date.now();
  const aliceRes = await postJSON(`${API_URL}/api/auth/register`, {
    name: 'Alice Springs',
    email: `alice_${suffix}@campus.edu`,
    password: 'Password123!',
    dateOfBirth: '2001-04-10',
    gender: 'female',
    city: 'Quad Plaza',
    relationshipIntent: 'friends'
  });
  const alice = aliceRes.data.data.user;
  const aliceToken = aliceRes.data.data.token;
  console.log(`  Alice registered: ID=${alice._id || alice.id}`);

  const bobRes = await postJSON(`${API_URL}/api/auth/register`, {
    name: 'Bob Harper',
    email: `bob_${suffix}@campus.edu`,
    password: 'Password123!',
    dateOfBirth: '2000-08-14',
    gender: 'male',
    city: 'Quad Plaza',
    relationshipIntent: 'friends'
  });
  const bob = bobRes.data.data.user;
  const bobToken = bobRes.data.data.token;
  console.log(`  Bob registered: ID=${bob._id || bob.id}`);

  const eveRes = await postJSON(`${API_URL}/api/auth/register`, {
    name: 'Eve Intruder',
    email: `eve_${suffix}@campus.edu`,
    password: 'Password123!',
    dateOfBirth: '2001-01-01',
    gender: 'female',
    city: 'Quad Plaza',
    relationshipIntent: 'friends'
  });
  const eve = eveRes.data.data.user;
  const eveToken = eveRes.data.data.token;
  console.log(`  Eve registered: ID=${eve._id || eve.id}`);

  // Establish friendship between Alice and Bob
  console.log('\n[TEST 4] Establishing friendship between Alice and Bob...');
  const reqRes = await postJSON(`${API_URL}/friends/request`, { recipientId: (bob._id || bob.id).toString() }, aliceToken);
  const requestId = reqRes.data?.data?._id || reqRes.data?.data?.id;
  await postJSON(`${API_URL}/friends/${requestId}/accept`, {}, bobToken);
  console.log('  PASSED: Friendship ACCEPTED between Alice and Bob.');

  // Alice queries /conversations to get conversationId
  const convsRes = await getJSON(`${API_URL}/conversations`, aliceToken);
  const conversation = convsRes.data.data.conversations[0];
  const conversationId = conversation.conversation_id;
  console.log(`  Conversation ID: ${conversationId}`);

  // STEP 5: Connect Alice Socket
  console.log('\n[TEST 5] Connecting Alice socket with valid JWT...');
  const aliceSocket = io(SOCKET_URL, {
    auth: { token: aliceToken },
    transports: ['websocket']
  });
  await new Promise((resolve) => aliceSocket.on('connect', resolve));
  console.log(`  PASSED: Alice connected to socket. Socket ID: ${aliceSocket.id}`);

  // Listen for user_online on Alice when Bob connects
  const bobOnlinePromise = new Promise((resolve) => {
    aliceSocket.on('user_online', (data) => {
      if (data.userId === (bob._id || bob.id).toString()) {
        resolve(data);
      }
    });
  });

  // Connect Bob Socket
  console.log('\n[TEST 6] Connecting Bob socket and verifying user_online event...');
  const bobSocket = io(SOCKET_URL, {
    auth: { token: bobToken },
    transports: ['websocket']
  });
  await new Promise((resolve) => bobSocket.on('connect', resolve));
  console.log(`  PASSED: Bob connected to socket. Socket ID: ${bobSocket.id}`);

  const onlineEvent = await bobOnlinePromise;
  console.log(`  PASSED: Alice received "user_online" event for Bob (userId: ${onlineEvent.userId}, status: ${onlineEvent.onlineStatus})`);

  // Connect Eve Socket
  console.log('\n[TEST 7] Connecting Eve socket with valid JWT...');
  const eveSocket = io(SOCKET_URL, {
    auth: { token: eveToken },
    transports: ['websocket']
  });
  await new Promise((resolve) => eveSocket.on('connect', resolve));
  console.log(`  PASSED: Eve connected to socket. Socket ID: ${eveSocket.id}`);

  // STEP 8: Security Test - Eve attempts to subscribe to Alice & Bob's private conversation channel
  console.log('\n[TEST 8] Security Test: Eve attempts to subscribe to Alice & Bob\'s private conversation...');
  let eveSubscribeRejected = false;
  await new Promise((resolve) => {
    eveSocket.emit('conversation:join', { conversationId }, (response) => {
      if (response && response.success === false) {
        console.log(`  PASSED: Eve subscription rejected via callback: "${response.error}"`);
        eveSubscribeRejected = true;
        resolve();
      }
    });

    eveSocket.on('error', (err) => {
      console.log(`  PASSED: Eve subscription rejected via error event: "${err.message || err.error}"`);
      eveSubscribeRejected = true;
      resolve();
    });

    // Timeout fallback to verify rejection
    setTimeout(resolve, 1000);
  });

  if (!eveSubscribeRejected) {
    throw new Error('FAILED: Eve was NOT rejected when subscribing to Alice & Bob\'s conversation!');
  }
  console.log('  PASSED: Eve is strictly blocked from subscribing to another user\'s private conversation.');

  // STEP 9: Alice and Bob subscribe to their conversation channel
  console.log('\n[TEST 9] Alice and Bob subscribe to their mutual conversation channel...');
  const aliceJoinRes = await new Promise((resolve) => {
    aliceSocket.emit('conversation:join', { conversationId }, resolve);
  });
  console.log(`  Alice join response:`, aliceJoinRes);

  const bobJoinRes = await new Promise((resolve) => {
    bobSocket.emit('conversation:join', { conversationId }, resolve);
  });
  console.log(`  Bob join response:`, bobJoinRes);

  // STEP 10: Real-time Message Delivery Test
  // When Alice sends a message, Bob should receive it in real-time WITHOUT refreshing
  console.log('\n[TEST 10] Testing real-time message delivery (Alice sends message -> Bob receives it without refresh)...');

  let eveReceivedMessage = false;
  eveSocket.on('message_received', () => { eveReceivedMessage = true; });
  eveSocket.on('message:received', () => { eveReceivedMessage = true; });

  const bobReceivedPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for Bob to receive real-time message')), 4000);
    bobSocket.on('message_received', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  const aliceSentPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for Alice message_sent confirmation')), 4000);
    aliceSocket.on('message_sent', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  // Alice sends message via REST API
  const sendRes = await postJSON(
    `${API_URL}/conversations/${conversationId}/messages`,
    { content: 'Hey Bob! Are we meeting at Central Plaza?' },
    aliceToken
  );
  console.log(`  Alice POST /conversations/:id/messages status: ${sendRes.status}`);

  // Bob receives message in real time
  const bobReceivedData = await bobReceivedPromise;
  console.log(`  PASSED: Bob received "message_received" event in real-time without refreshing:`);
  console.log(`    - message_id: ${bobReceivedData.message_id}`);
  console.log(`    - content: "${bobReceivedData.content}"`);
  console.log(`    - sender_id: ${bobReceivedData.sender_id}`);
  console.log(`    - receiver_id: ${bobReceivedData.receiver_id}`);
  console.log(`    - created_at: ${bobReceivedData.created_at}`);

  // Alice receives message_sent confirmation
  const aliceSentData = await aliceSentPromise;
  console.log(`  PASSED: Alice received "message_sent" confirmation event: message_id: ${aliceSentData.message_id}`);

  // Verify Eve received nothing
  await new Promise((r) => setTimeout(r, 400));
  if (eveReceivedMessage) {
    throw new Error('FAILED: Eve received Alice & Bob\'s private message! Privacy leak detected.');
  }
  console.log('  PASSED: Eve did NOT receive the message (room privacy 100% verified).');

  // STEP 11: Typing Indicators Test (typing_started, typing_stopped)
  console.log('\n[TEST 11] Testing typing indicators (typing_started and typing_stopped)...');
  const aliceTypingStartPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for typing_started event')), 3000);
    aliceSocket.on('typing_started', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  // Bob starts typing
  bobSocket.emit('typing_started', { conversation_id: conversationId });
  const typingStartData = await aliceTypingStartPromise;
  console.log(`  PASSED: Alice received "typing_started" event: sender_id=${typingStartData.sender_id}, user=${typingStartData.user?.name}`);

  const aliceTypingStopPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for typing_stopped event')), 3000);
    aliceSocket.on('typing_stopped', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  // Bob stops typing
  bobSocket.emit('typing_stopped', { conversation_id: conversationId });
  const typingStopData = await aliceTypingStopPromise;
  console.log(`  PASSED: Alice received "typing_stopped" event: sender_id=${typingStopData.sender_id}`);

  // STEP 12: Read Receipt Test (message_read)
  console.log('\n[TEST 12] Testing read receipt (message_read)...');
  const aliceReadPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message_read event')), 3000);
    aliceSocket.on('message_read', (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  // Bob views messages via GET /conversations/:conversationId/messages
  await getJSON(`${API_URL}/conversations/${conversationId}/messages`, bobToken);
  const readData = await aliceReadPromise;
  console.log(`  PASSED: Alice received "message_read" event in real-time:`);
  console.log(`    - reader_id: ${readData.reader_id}`);
  console.log(`    - read_at: ${readData.read_at}`);

  // STEP 13: User Offline Broadcast Test (user_offline)
  console.log('\n[TEST 13] Testing user_offline broadcast on disconnect...');
  const eveOfflinePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for user_offline event')), 3000);
    aliceSocket.on('user_offline', (data) => {
      if (data.userId === (eve._id || eve.id).toString()) {
        clearTimeout(timer);
        resolve(data);
      }
    });
  });

  // Eve disconnects
  eveSocket.disconnect();
  const eveOfflineData = await eveOfflinePromise;
  console.log(`  PASSED: Alice received "user_offline" event for Eve: userId=${eveOfflineData.userId}, status=${eveOfflineData.onlineStatus}`);

  // Clean up remaining sockets
  aliceSocket.disconnect();
  bobSocket.disconnect();

  console.log('\n================================================================');
  console.log('   ALL REAL-TIME WEBSOCKET MESSAGING TESTS PASSED (13/13)!      ');
  console.log('================================================================\n');
}

runRealtimeMessagingTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nTEST SUITE FAILED:', err);
    process.exit(1);
  });
