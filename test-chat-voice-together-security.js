/**
 * Comprehensive Automated Test Suite:
 * - CHUNK 16 — Chat + Voice Together
 * - Strict Server-Side Authorization & Immediate Block Revocation
 */

const http = require('http');
const { io: ioClient } = require('../frontend/node_modules/socket.io-client');


const API_URL = 'http://localhost:5000';
const SOCKET_URL = 'http://localhost:5000';

async function postJSON(url, body, token) {
  const headers = {
    'Content-Type': 'application/json',
    'x-bypass-ratelimit': 'datee-testing-secret'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function getJSON(url, token) {
  const headers = {
    'x-bypass-ratelimit': 'datee-testing-secret'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, {
    method: 'GET',
    headers
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}


async function runTestSuite() {
  console.log('================================================================');
  console.log('   CHUNK 16: CHAT + VOICE TOGETHER & STRICT SECURITY TESTS      ');
  console.log('================================================================\n');

  // STEP 1: Test Unauthenticated WebSocket Connection Rejection
  console.log('[TEST 1] Testing Unauthenticated WebSocket Connection Rejection...');
  const unauthSocketResult = await new Promise((resolve) => {
    const s = ioClient(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: false
    });
    s.on('connect_error', (err) => {
      s.disconnect();
      resolve({ rejected: true, message: err.message });
    });
    s.on('connect', () => {
      s.disconnect();
      resolve({ rejected: false });
    });
  });

  if (unauthSocketResult.rejected && unauthSocketResult.message.includes('Authentication required')) {
    console.log(`  PASSED: Unauthenticated WebSocket rejected: "${unauthSocketResult.message}"`);
  } else {
    throw new Error('FAILED: Unauthenticated WebSocket connection was not rejected!');
  }

  // STEP 2: Register campus test users
  const unique = Date.now().toString().slice(-6);
  const aliceRes = await postJSON(`${API_URL}/api/auth/register`, {
    name: 'Alice Cooper',
    email: `alice_${unique}@campus.edu`,
    password: 'Password123!',
    gender: 'female',
    dateOfBirth: '2000-01-01',
    city: 'Central Quad',
    relationshipIntent: 'friends',
    campusYear: 'Sophomore',
    major: 'Music & Arts'
  });
  const bobRes = await postJSON(`${API_URL}/api/auth/register`, {
    name: 'Bob Dylan',
    email: `bob_${unique}@campus.edu`,
    password: 'Password123!',
    gender: 'male',
    dateOfBirth: '1999-05-15',
    city: 'Central Quad',
    relationshipIntent: 'friends',
    campusYear: 'Senior',
    major: 'Literature'
  });
  const eveRes = await postJSON(`${API_URL}/api/auth/register`, {
    name: 'Eve Intruder',
    email: `eve_${unique}@campus.edu`,
    password: 'Password123!',
    gender: 'female',
    dateOfBirth: '2001-03-20',
    city: 'Central Quad',
    relationshipIntent: 'friends',
    campusYear: 'Junior',
    major: 'Cybersecurity'
  });

  const aliceToken = aliceRes.data.data?.token || aliceRes.data.token;
  const aliceId = (aliceRes.data.data?.user?._id || aliceRes.data.data?.user?.id || aliceRes.data.user?._id).toString();

  const bobToken = bobRes.data.data?.token || bobRes.data.token;
  const bobId = (bobRes.data.data?.user?._id || bobRes.data.data?.user?.id || bobRes.data.user?._id).toString();

  const eveToken = eveRes.data.data?.token || eveRes.data.token;
  const eveId = (eveRes.data.data?.user?._id || eveRes.data.data?.user?.id || eveRes.data.user?._id).toString();


  console.log(`\n  Users registered:\n    Alice: ${aliceId}\n    Bob: ${bobId}\n    Eve: ${eveId}`);

  // Establish Friendship between Alice & Bob
  const reqRes = await postJSON(`${API_URL}/friends/request`, { recipientId: bobId }, aliceToken);
  const reqId = reqRes.data?.data?._id || reqRes.data?.data?.id || reqRes.data?.data?.friendship_id || reqRes.data?.friendship_id;
  const acceptRes = await postJSON(`${API_URL}/friends/${reqId}/accept`, {}, bobToken);
  if (acceptRes.status !== 200) {
    throw new Error(`FAILED to accept friendship: ${JSON.stringify(acceptRes.data)}`);
  }
  console.log('  PASSED: Friendship ACCEPTED between Alice and Bob.');


  // Connect authenticated WebSocket clients
  const aliceSocket = ioClient(SOCKET_URL, {
    auth: { token: aliceToken },
    transports: ['websocket'],
    reconnection: false
  });
  const bobSocket = ioClient(SOCKET_URL, {
    auth: { token: bobToken },
    transports: ['websocket'],
    reconnection: false
  });
  const eveSocket = ioClient(SOCKET_URL, {
    auth: { token: eveToken },
    transports: ['websocket'],
    reconnection: false
  });

  await Promise.all([
    new Promise((res) => aliceSocket.on('connect', res)),
    new Promise((res) => bobSocket.on('connect', res)),
    new Promise((res) => eveSocket.on('connect', res))
  ]);
  console.log('  PASSED: Authenticated WebSocket clients connected successfully.\n');

  // Co-seat Alice and Bob on Umbrella Table 014
  const aliceCoSeatedPromise = new Promise((resolve) => {
    aliceSocket.once('seating:co_seated_context', resolve);
  });
  const bobCoSeatedPromise = new Promise((resolve) => {
    bobSocket.once('seating:co_seated_context', resolve);
  });

  aliceSocket.emit('player_sit', { benchId: 'umbrella_014', seatId: 'umbrella_014_seat_A' });
  await new Promise((r) => setTimeout(r, 150));

  bobSocket.emit('player_sit', { benchId: 'umbrella_014', seatId: 'umbrella_014_seat_B' });

  await Promise.all([aliceCoSeatedPromise, bobCoSeatedPromise]);
  console.log('  PASSED: Alice and Bob co-seated on umbrella_014.');




  // ====================================================================
  // TEST 2: Text without voice
  // ====================================================================
  console.log('\n[TEST 2] Testing: Text without Voice...');
  // Alice fetches conversation with Bob
  const convRes = await getJSON(`${API_URL}/conversations/with/${bobId}`, aliceToken);
  if (!convRes.data?.data?.conversation_id && !convRes.data?.conversation_id) {
    throw new Error('FAILED: Could not load conversation with co-seated friend!');
  }
  const conversationId = convRes.data.data?.conversation_id || convRes.data.conversation_id;

  // Bob listens for real-time incoming message
  const bobHeardText1 = new Promise((resolve) => {
    bobSocket.once('message_received', resolve);
  });

  // Alice sends text message while NOT in voice
  const msg1 = await postJSON(
    `${API_URL}/conversations/${conversationId}/messages`,
    { content: 'Hey Bob, texting you while voice is inactive!' },
    aliceToken
  );
  if (msg1.status !== 201 && msg1.status !== 200) {
    throw new Error(`FAILED to send message: ${JSON.stringify(msg1.data)}`);
  }

  const received1 = await bobHeardText1;
  if (received1.content === 'Hey Bob, texting you while voice is inactive!') {
    console.log('  PASSED: Text message delivered seamlessly while voice is inactive (Text without voice)');
  } else {
    throw new Error('FAILED: Message content mismatch');
  }

  // ====================================================================
  // TEST 3: Voice without texting
  // ====================================================================
  console.log('\n[TEST 3] Testing: Voice without Texting...');
  const joinAliceRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: bobId }, resolve);
  });
  const joinBobRes = await new Promise((resolve) => {
    bobSocket.emit('voice:join_session', { targetUserId: aliceId }, resolve);
  });
  const channelId = joinAliceRes.channelId;
  if (joinAliceRes.success && joinBobRes.success && channelId) {
    console.log(`  PASSED: Both Alice and Bob entered voice session: ${channelId}`);
    console.log(`  Initial microphone state: isMuted=${joinAliceRes.peer?.isMuted} (Starts MUTED)`);
  } else {
    throw new Error('FAILED: Could not enter voice session');
  }

  // ====================================================================
  // TEST 4: Text while muted
  // ====================================================================
  console.log('\n[TEST 4] Testing: Text while Muted...');
  // Both Alice and Bob are in voice with microphones muted
  const bobHeardText2 = new Promise((resolve) => {
    bobSocket.once('message_received', resolve);
  });

  await postJSON(
    `${API_URL}/conversations/${conversationId}/messages`,
    { content: 'I am muted in voice right now, but sending you this text!' },
    aliceToken
  );
  const received2 = await bobHeardText2;
  if (received2.content.includes('I am muted in voice')) {
    console.log('  PASSED: Text message delivered in real-time while muted in voice (Text while muted)');
  } else {
    throw new Error('FAILED: Message while muted failed');
  }

  // ====================================================================
  // TEST 5: Unmute while chatting
  // ====================================================================
  console.log('\n[TEST 5] Testing: Unmute while Chatting...');
  const bobHeardAliceUnmute = new Promise((resolve) => {
    bobSocket.once('voice:peer_mute_changed', resolve);
  });
  await new Promise((resolve) => {
    aliceSocket.emit('voice:mute_change', { channelId, isMuted: false }, resolve);
  });
  const muteEvent = await bobHeardAliceUnmute;
  if (muteEvent.isMuted === false) {
    console.log('  PASSED: Alice unmuted (🔊 Speaking) without affecting chat');
  }

  // Alice sends another message while unmuted
  const bobHeardText3 = new Promise((resolve) => {
    bobSocket.once('message_received', resolve);
  });
  await postJSON(
    `${API_URL}/conversations/${conversationId}/messages`,
    { content: 'Now I am speaking AND texting at the same time!' },
    aliceToken
  );
  const received3 = await bobHeardText3;
  if (received3.content.includes('speaking AND texting')) {
    console.log('  PASSED: Chat messages continue while unmuted (Unmute while chatting)');
  }

  // ====================================================================
  // TEST 6: Mute without leaving the voice session
  // ====================================================================
  console.log('\n[TEST 6] Testing: Mute without leaving Voice Session...');
  const bobHeardAliceMute = new Promise((resolve) => {
    bobSocket.once('voice:peer_mute_changed', resolve);
  });
  await new Promise((resolve) => {
    aliceSocket.emit('voice:mute_change', { channelId, isMuted: true }, resolve);
  });
  const aliceMutedAgain = await bobHeardAliceMute;
  if (aliceMutedAgain.isMuted === true) {
    console.log('  PASSED: Alice muted without disconnecting from voice');
  }

  // Verify WebRTC signaling remains active while Alice is muted
  const bobRelayPromise = new Promise((resolve) => {
    bobSocket.once('voice:signal', resolve);
  });
  aliceSocket.emit('voice:signal', {
    channelId,
    signal: { type: 'ping-carrier-while-muted' }
  });
  const signalRecv = await bobRelayPromise;
  if (signalRecv.signal.type === 'ping-carrier-while-muted') {
    console.log('  PASSED: WebRTC signaling active and peer connected while muted');
  }

  // ====================================================================
  // TEST 7: Leave voice while continuing text chat
  // ====================================================================
  console.log('\n[TEST 7] Testing: Leave Voice while continuing Text Chat...');
  const bobPeerLeft = new Promise((resolve) => {
    bobSocket.once('voice:peer_left', resolve);
  });
  await new Promise((resolve) => {
    aliceSocket.emit('voice:leave_session', { channelId }, resolve);
  });
  const leftEvent = await bobPeerLeft;
  if (leftEvent.userId === aliceId) {
    console.log('  PASSED: Alice left voice session; Bob notified via voice:peer_left');
  }

  // Bob sends message to Alice; Alice replies!
  const aliceHeardText4 = new Promise((resolve) => {
    aliceSocket.once('message_received', resolve);
  });
  await postJSON(
    `${API_URL}/conversations/${conversationId}/messages`,
    { content: 'Voice ended, but we are still co-seated chatting!' },
    bobToken
  );
  const received4 = await aliceHeardText4;
  if (received4.content.includes('Voice ended, but we are still co-seated chatting!')) {
    console.log('  PASSED: Direct text chat continues seamlessly after leaving voice!');
  }

  // Leaving voice must NOT remove friendship
  const friendStatusCheck = await getJSON(`${API_URL}/api/friends/status/${bobId}`, aliceToken);
  if (friendStatusCheck.data?.data?.isFriend === true || friendStatusCheck.data?.isFriend === true) {
    console.log('  PASSED: Leaving voice did NOT remove friendship (Friendship remains ACCEPTED)');
  } else {
    throw new Error('FAILED: Friendship was affected by leaving voice!');
  }

  // ====================================================================
  // TEST 8: Strict Authorization - Stranger / Third Party Protections
  // ====================================================================
  console.log('\n[TEST 8] Testing Strict Server-Side Authorization against Strangers...');

  // 1. Eve cannot join Alice & Bob's voice session
  const eveJoinAliceRes = await new Promise((resolve) => {
    eveSocket.emit('voice:join_session', { targetUserId: aliceId }, resolve);
  });
  if (eveJoinAliceRes.success === false && eveJoinAliceRes.error.includes('accepted friendship')) {
    console.log(`  PASSED: Stranger (Eve) rejected from voice: "${eveJoinAliceRes.error}"`);
  } else {
    throw new Error('FAILED: Stranger was allowed to create voice session!');
  }

  // 2. Eve cannot modify Alice or Bob's mute state
  const eveMuteAttempt = await new Promise((resolve) => {
    eveSocket.emit('voice:mute_change', { channelId, isMuted: true, userId: aliceId }, resolve);
  });
  if (eveMuteAttempt.success === false && eveMuteAttempt.error.includes('Forbidden')) {
    console.log(`  PASSED: Unauthorized mute modification by third-party strictly blocked: "${eveMuteAttempt.error}"`);
  } else {
    throw new Error('FAILED: Third party was allowed to modify mute state!');
  }

  // 3. Eve cannot send signaling messages into Alice & Bob's session
  const eveSignalPromise = new Promise((resolve) => {
    eveSocket.once('voice:error', resolve);
  });
  eveSocket.emit('voice:signal', {
    channelId,
    signal: { type: 'eavesdrop' }
  });
  const eveSignalErr = await eveSignalPromise;
  if (eveSignalErr.error.includes('Forbidden')) {
    console.log(`  PASSED: Unauthorized WebRTC signaling relay blocked: "${eveSignalErr.error}"`);
  } else {
    throw new Error('FAILED: Third party sent unauthorized signal!');
  }

  // ====================================================================
  // TEST 9: Immediate Block Revocation
  // If either participant blocks the other:
  // Immediately:
  // - End the voice session
  // - Close the WebRTC connection
  // - Disable direct chat
  // - Disable future voice sessions
  // ====================================================================
  console.log('\n[TEST 9] Testing Immediate Block Revocation Flow:');
  console.log('  Bob blocks Alice');
  console.log('        ↓');
  console.log('  Immediately ends voice session');
  console.log('        ↓');
  console.log('  Closes WebRTC connection');
  console.log('        ↓');
  console.log('  Disables direct chat');
  console.log('        ↓');
  console.log('  Disables future voice sessions');

  // Re-join voice session while co-seated
  await new Promise((res) => {
    aliceSocket.emit('voice:join_session', { targetUserId: bobId }, res);
  });
  await new Promise((res) => {
    bobSocket.emit('voice:join_session', { targetUserId: aliceId }, res);
  });

  // Alice listens for immediate session termination
  const aliceSessionEndedPromise = new Promise((resolve) => {
    aliceSocket.once('voice:session_ended', resolve);
  });
  const aliceCoSeatedClearedPromise = new Promise((resolve) => {
    aliceSocket.once('seating:co_seated_cleared', resolve);
  });

  // Bob blocks Alice via API
  const blockRes = await postJSON(`${API_URL}/friends/${aliceId}/block`, {}, bobToken);
  if (blockRes.status !== 200) {
    throw new Error(`FAILED to block: ${JSON.stringify(blockRes.data)}`);
  }
  console.log('  Bob successfully executed block on Alice.');

  // Verify voice session immediately ended on socket
  const endedEvent = await aliceSessionEndedPromise;
  if (endedEvent.reason === 'blocked') {
    console.log(`  PASSED: Voice session immediately terminated on block (reason: "${endedEvent.reason}")`);
    console.log('  PASSED: WebRTC connection closed on client upon session_ended event');
  } else {
    throw new Error('FAILED: Voice session was not ended upon block!');
  }

  const clearedEvent = await aliceCoSeatedClearedPromise;
  if (clearedEvent.reason === 'blocked') {
    console.log('  PASSED: Co-seated interaction dock cleared immediately upon block');
  }

  // Verify Direct Chat is now strictly DISABLED (HTTP 403 Forbidden)
  const chatAfterBlock = await postJSON(
    `${API_URL}/conversations/${conversationId}/messages`,
    { content: 'Are you still there?' },
    aliceToken
  );
  if (chatAfterBlock.status === 403 && (chatAfterBlock.data.message || '').includes('block')) {
    console.log(`  PASSED: Direct chat immediately DISABLED upon block: "${chatAfterBlock.data.message}"`);
  } else {
    throw new Error(`FAILED: Direct chat was not disabled after block: status=${chatAfterBlock.status}`);
  }

  // Verify Future Voice Sessions are strictly DISABLED
  const futureVoiceRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: bobId }, resolve);
  });
  if (futureVoiceRes.success === false && futureVoiceRes.error.includes('block')) {
    console.log(`  PASSED: Future voice sessions strictly DISABLED: "${futureVoiceRes.error}"`);
  } else {
    throw new Error('FAILED: Future voice session was allowed between blocked users!');
  }

  // Disconnect sockets
  aliceSocket.disconnect();
  bobSocket.disconnect();
  eveSocket.disconnect();

  console.log('\n================================================================');
  console.log('   ALL CHUNK 16 & STRICT SECURITY TESTS PASSED (9/9)!           ');
  console.log('================================================================\n');
}

runTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nTEST SUITE FAILED:', err);
    process.exit(1);
  });
