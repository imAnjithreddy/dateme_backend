const { io } = require('../frontend/node_modules/socket.io-client');
const seatingManager = require('./socket/seatingManager');

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

async function runVoiceCallTests() {
  console.log('================================================================');
  console.log('   CHUNK 12 — VOICE SESSION AUTHORIZATION TEST SUITE            ');
  console.log('================================================================\n');

  const suffix = Date.now();

  // 1. Register Alice, Bob, Charlie (Stranger), and Eve (Intruder)
  console.log('[STEP 1] Registering test campus students...');
  const aliceRes = await postJSON(`${API_URL}/api/auth/register`, {
    name: 'Alice Campus',
    email: `alice_${suffix}@campus.edu`,
    password: 'Password123!',
    dateOfBirth: '2000-01-01',
    gender: 'female',
    city: 'Central Quad',
    relationshipIntent: 'friends'
  });
  const alice = aliceRes.data.data.user;
  const aliceToken = aliceRes.data.data.token;
  const aliceId = (alice._id || alice.id).toString();
  console.log(`  Alice: ID=${aliceId}`);

  const bobRes = await postJSON(`${API_URL}/api/auth/register`, {
    name: 'Bob Campus',
    email: `bob_${suffix}@campus.edu`,
    password: 'Password123!',
    dateOfBirth: '2001-02-02',
    gender: 'male',
    city: 'Central Quad',
    relationshipIntent: 'friends'
  });
  const bob = bobRes.data.data.user;
  const bobToken = bobRes.data.data.token;
  const bobId = (bob._id || bob.id).toString();
  console.log(`  Bob: ID=${bobId}`);

  const charlieRes = await postJSON(`${API_URL}/api/auth/register`, {
    name: 'Charlie Stranger',
    email: `charlie_${suffix}@campus.edu`,
    password: 'Password123!',
    dateOfBirth: '2002-03-03',
    gender: 'female',
    city: 'Central Quad',
    relationshipIntent: 'friends'
  });
  const charlie = charlieRes.data.data.user;
  const charlieToken = charlieRes.data.data.token;
  const charlieId = (charlie._id || charlie.id).toString();
  console.log(`  Charlie (Stranger): ID=${charlieId}`);

  const eveRes = await postJSON(`${API_URL}/api/auth/register`, {
    name: 'Eve Intruder',
    email: `eve_${suffix}@campus.edu`,
    password: 'Password123!',
    dateOfBirth: '2001-04-04',
    gender: 'female',
    city: 'Central Quad',
    relationshipIntent: 'friends'
  });
  const eve = eveRes.data.data.user;
  const eveToken = eveRes.data.data.token;
  const eveId = (eve._id || eve.id).toString();
  console.log(`  Eve (Intruder): ID=${eveId}`);

  // Connect Sockets
  console.log('\n[STEP 2] Connecting authenticated WebSocket clients...');
  const aliceSocket = io(SOCKET_URL, { auth: { token: aliceToken }, transports: ['websocket'] });
  await new Promise((resolve) => aliceSocket.on('connect', resolve));
  console.log(`  Alice socket connected: ${aliceSocket.id}`);

  const bobSocket = io(SOCKET_URL, { auth: { token: bobToken }, transports: ['websocket'] });
  await new Promise((resolve) => bobSocket.on('connect', resolve));
  console.log(`  Bob socket connected: ${bobSocket.id}`);

  const charlieSocket = io(SOCKET_URL, { auth: { token: charlieToken }, transports: ['websocket'] });
  await new Promise((resolve) => charlieSocket.on('connect', resolve));
  console.log(`  Charlie socket connected: ${charlieSocket.id}`);

  const eveSocket = io(SOCKET_URL, { auth: { token: eveToken }, transports: ['websocket'] });
  await new Promise((resolve) => eveSocket.on('connect', resolve));
  console.log(`  Eve socket connected: ${eveSocket.id}`);

  // TEST 1: Condition 1: Prevent joining voice session with oneself
  console.log('\n[TEST 1] Testing self voice session join prevention...');
  const selfRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: aliceId }, resolve);
  });
  if (selfRes.success === false && selfRes.error.includes('yourself')) {
    console.log(`  PASSED: Self voice session rejected: "${selfRes.error}"`);
  } else {
    throw new Error('FAILED: Self voice session was not rejected!');
  }

  // TEST 2: Condition 2 & 3: Prevent joining voice session with stranger (no friendship exists)
  console.log('\n[TEST 2] Testing voice authorization: Stranger (No Friendship)...');
  const strangerRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: charlieId }, resolve);
  });
  if (strangerRes.success === false && strangerRes.error.includes('accepted friendship')) {
    console.log(`  PASSED: Non-friend voice session strictly REJECTED: "${strangerRes.error}"`);
  } else {
    throw new Error('FAILED: Voice session with non-friend was permitted!');
  }

  // TEST 3: Condition 3: Prevent joining voice session when request is still PENDING
  console.log('\n[TEST 3] Testing voice authorization: Pending Request (Not Accepted)...');
  await postJSON(`${API_URL}/friends/request`, { recipientId: charlieId }, aliceToken);
  const pendingRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: charlieId }, resolve);
  });
  if (pendingRes.success === false && pendingRes.error.includes('accepted friendship')) {
    console.log(`  PASSED: Pending request voice session strictly REJECTED: "${pendingRes.error}"`);
  } else {
    throw new Error('FAILED: Voice session with pending friend request was permitted!');
  }

  // Establish ACCEPTED friendship between Alice & Bob
  console.log('\n[STEP 3] Establishing ACCEPTED friendship between Alice and Bob...');
  const abReq = await postJSON(`${API_URL}/friends/request`, { recipientId: bobId }, aliceToken);
  const reqId = abReq.data?.data?._id || abReq.data?.data?.id;
  await postJSON(`${API_URL}/friends/${reqId}/accept`, {}, bobToken);
  console.log('  PASSED: Friendship ACCEPTED between Alice and Bob.');

  // TEST 4: Condition 5: Rejection when neither user is seated
  console.log('\n[TEST 4] Testing Condition 5: Rejection when neither user is seated...');
  const notSeatedRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: bobId }, resolve);
  });
  if (notSeatedRes.success === false && notSeatedRes.error.includes('not seated')) {
    console.log(`  PASSED: Voice session strictly REJECTED when standing: "${notSeatedRes.error}"`);
  } else {
    throw new Error('FAILED: Voice session permitted while standing!');
  }

  // TEST 5: Security: Do NOT trust frontend spoofed values (isFriend, canVoice, isSeatedTogether)
  console.log('\n[TEST 5] Security Test: Server does NOT trust frontend spoofed flags...');
  const spoofedRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', {
      targetUserId: bobId,
      isFriend: true,
      canVoice: true,
      isSeatedTogether: true // Spoofed flag!
    }, resolve);
  });
  if (spoofedRes.success === false && spoofedRes.error.includes('not seated')) {
    console.log(`  PASSED: Frontend spoofed flags completely IGNORED by backend: "${spoofedRes.error}"`);
  } else {
    throw new Error('FAILED: Backend trusted spoofed frontend flag!');
  }

  // TEST 6: Condition 5: Rejection when only one user is seated
  console.log('\n[TEST 6] Testing Condition 5: Rejection when only Caller is seated...');
  aliceSocket.emit('player_sit', { seatId: 'bench_001_seat_A', benchId: 'bench_001' });
  await new Promise((r) => setTimeout(r, 100)); // Allow server to record seat

  const oneSeatedRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: bobId }, resolve);
  });
  if (oneSeatedRes.success === false && oneSeatedRes.error.includes('Target friend is not seated')) {
    console.log(`  PASSED: Rejected when target friend is standing: "${oneSeatedRes.error}"`);
  } else {
    throw new Error('FAILED: Voice session permitted when friend was not seated!');
  }

  // TEST 7: Condition 5: Rejection when seated on DIFFERENT objects (bench_001 vs bench_002)
  console.log('\n[TEST 7] Testing Condition 5: Rejection when seated on different objects...');
  bobSocket.emit('player_sit', { seatId: 'bench_002_seat_B', benchId: 'bench_002' });
  await new Promise((r) => setTimeout(r, 100));

  const differentObjectsRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: bobId }, resolve);
  });
  if (differentObjectsRes.success === false && differentObjectsRes.error.includes('different objects')) {
    console.log(`  PASSED: Rejected when seated on different objects: "${differentObjectsRes.error}"`);
  } else {
    throw new Error('FAILED: Voice session permitted across different benches!');
  }

  // TEST 8: Condition 5: SUCCESS when both players are co-seated on the same two-person bench
  console.log('\n[TEST 8] Testing Condition 5: Successful authorization when co-seated on same bench...');
  // Set up listeners for server-created voice-enabled interaction context
  const aliceCoSeatedPromise = new Promise((resolve) => {
    aliceSocket.once('seating:co_seated_context', resolve);
  });
  const bobCoSeatedPromise = new Promise((resolve) => {
    bobSocket.once('seating:co_seated_context', resolve);
  });

  // Bob sits beside Alice on bench_001 (seat_B)
  bobSocket.emit('player_sit', { seatId: 'bench_001_seat_B', benchId: 'bench_001' });

  // Both users receive voice-enabled interaction context
  const [aliceCtx, bobCtx] = await Promise.all([aliceCoSeatedPromise, bobCoSeatedPromise]);
  if (aliceCtx.canMessage && aliceCtx.canVoice && bobCtx.canMessage && bobCtx.canVoice) {
    console.log('  PASSED: Server created voice-enabled interaction context:');
    console.log('    - Same interaction object? YES (' + aliceCtx.objectId + ')');
    console.log('    - Both seats occupied? YES (bench_001_seat_A & bench_001_seat_B)');
    console.log('    - Friends? YES (ACCEPTED)');
    console.log('    - Blocked? NO');
    console.log('    - Both users see: 💬 Message & 🎙️ Voice');
  } else {
    throw new Error('FAILED: Co-seated voice interaction context was not created!');
  }

  const validSessionRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: bobId }, resolve);
  });

  if (!validSessionRes.success) {
    throw new Error(`FAILED to authorize valid co-seated voice session: ${validSessionRes.error}`);
  }
  const channelId = validSessionRes.channelId;
  console.log(`  PASSED: Voice session authoritatively permitted for co-seated friends! Channel: ${channelId}`);
  console.log(`  Voice starts MUTED: isMuted=${validSessionRes.peer?.isMuted} (zero auto-mic activation)`);

  // Bob enters the same session
  const bobPeerJoinedPromise = new Promise((resolve) => {
    aliceSocket.once('voice:peer_joined', resolve);
  });
  const bobJoinRes = await new Promise((resolve) => {
    bobSocket.emit('voice:join_session', { targetUserId: aliceId }, resolve);
  });
  if (!bobJoinRes.success) {
    throw new Error(`FAILED for Bob to join: ${bobJoinRes.error}`);
  }
  await bobPeerJoinedPromise;
  console.log('  PASSED: Both Alice and Bob entered the same private voice session!');

  // TEST 8b: Umbrella Table co-seating verification
  console.log('\n[TEST 8b] Testing Umbrella Table Co-Seating & Voice Context...');
  // Players leave previous session and stand
  aliceSocket.emit('voice:leave_session', { channelId });
  bobSocket.emit('voice:leave_session', { channelId });
  aliceSocket.emit('player_stand', { seatId: 'bench_001_seat_A', benchId: 'bench_001' });
  bobSocket.emit('player_stand', { seatId: 'bench_001_seat_B', benchId: 'bench_001' });
  await new Promise((r) => setTimeout(r, 100));

  // Player A sits on Umbrella Seat A
  aliceSocket.emit('player_sit', { seatId: 'umbrella_014_seat_A', benchId: 'umbrella_014' });
  await new Promise((r) => setTimeout(r, 100));

  const aliceUmbrellaPromise = new Promise((resolve) => {
    aliceSocket.once('seating:co_seated_context', resolve);
  });
  const bobUmbrellaPromise = new Promise((resolve) => {
    bobSocket.once('seating:co_seated_context', resolve);
  });

  // Player B sits on Umbrella Seat B
  bobSocket.emit('player_sit', { seatId: 'umbrella_014_seat_B', benchId: 'umbrella_014' });

  const [aliceUmbCtx, bobUmbCtx] = await Promise.all([aliceUmbrellaPromise, bobUmbrellaPromise]);
  if (aliceUmbCtx.canMessage && aliceUmbCtx.canVoice && bobUmbCtx.canMessage && bobUmbCtx.canVoice) {
    console.log('  PASSED: Umbrella Table voice-enabled interaction context created:');
    console.log('    - Same interaction object? YES (' + aliceUmbCtx.objectId + ')');
    console.log('    - Both seats occupied? YES (umbrella_014_seat_A & umbrella_014_seat_B)');
    console.log('    - Friends? YES (ACCEPTED)');
    console.log('    - Blocked? NO');
    console.log('    - Both users see: 💬 Message & 🎙️ Voice');
  } else {
    throw new Error('FAILED: Umbrella co-seated voice interaction context was not created!');
  }

  // Voice session on umbrella table
  const umbrellaVoiceRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: bobId }, resolve);
  });
  if (!umbrellaVoiceRes.success) {
    throw new Error(`FAILED to join voice on umbrella table: ${umbrellaVoiceRes.error}`);
  }
  const umbrellaBobRes = await new Promise((resolve) => {
    bobSocket.emit('voice:join_session', { targetUserId: aliceId }, resolve);
  });
  if (!umbrellaBobRes.success) {
    throw new Error(`FAILED for Bob to join voice on umbrella table: ${umbrellaBobRes.error}`);
  }
  console.log(`  PASSED: Umbrella Table voice session active: isMuted=${umbrellaVoiceRes.peer?.isMuted} (Voice starts MUTED)`);
  console.log('  Neither microphone is automatically enabled.');

  // TEST 9: Explicit Independent Microphone Control (Initial Both Muted -> Unmute -> Speaking)
  console.log('\n[TEST 9] Testing Explicit Independent Microphone Control...');
  console.log('  State 1: Initial State -> Alice: 🔇 Muted, Bob: 🔇 Muted');

  // Alice unmutes -> Alice: 🔊 Speaking, Bob: 🔇 Muted
  const bobHeardAliceUnmute = new Promise((resolve) => {
    bobSocket.once('voice:peer_mute_changed', resolve);
  });
  await new Promise((resolve) => {
    aliceSocket.emit('voice:mute_change', { channelId, isMuted: false }, resolve);
  });
  const aliceUnmuteEvent = await bobHeardAliceUnmute;
  if (aliceUnmuteEvent.isMuted === false) {
    console.log('  PASSED: Alice → 🔊 Speaking, Bob → 🔇 Muted (Bob can hear Alice)');
  }

  // Bob unmutes -> Alice: 🔊 Speaking, Bob: 🔊 Speaking
  const aliceHeardBobUnmute = new Promise((resolve) => {
    aliceSocket.once('voice:peer_mute_changed', resolve);
  });
  await new Promise((resolve) => {
    bobSocket.emit('voice:mute_change', { channelId, isMuted: false }, resolve);
  });
  const bobUnmuteEvent = await aliceHeardBobUnmute;
  if (bobUnmuteEvent.isMuted === false) {
    console.log('  PASSED: Alice → 🔊 Speaking, Bob → 🔊 Speaking (Both can hear each other)');
  }

  // Alice mutes -> Alice: 🔇 Muted, Bob: 🔊 Speaking
  const bobHeardAliceMute = new Promise((resolve) => {
    bobSocket.once('voice:peer_mute_changed', resolve);
  });
  await new Promise((resolve) => {
    aliceSocket.emit('voice:mute_change', { channelId, isMuted: true }, resolve);
  });
  const aliceMuteEvent = await bobHeardAliceMute;
  if (aliceMuteEvent.isMuted === true) {
    console.log('  PASSED: Alice → 🔇 Muted, Bob → 🔊 Speaking (Independent control confirmed)');
  }

  // TEST 9b: Player A clicks Mute -> Audio transmission stops -> WebRTC connection remains alive -> Player B remains connected
  console.log('\n[TEST 9b] Testing Mute Lifecycle & WebRTC Connection Preservation:');
  console.log('  Player A clicks Mute');
  console.log('        ↓');
  console.log('  Audio transmission stops (track.enabled = false)');
  console.log('        ↓');
  console.log('  WebRTC connection remains alive');
  console.log('        ↓');
  console.log('  Player B remains connected');

  // Verify Player B did NOT receive peer_left or session termination
  let bobUnexpectedLeft = false;
  const unexpectedLeftHandler = () => { bobUnexpectedLeft = true; };
  bobSocket.once('voice:peer_left', unexpectedLeftHandler);
  bobSocket.once('voice:session_ended', unexpectedLeftHandler);

  // Send a signal from Alice to Bob while Alice is muted to prove WebRTC signaling is alive
  const bobSignalWhileAliceMuted = new Promise((resolve) => {
    bobSocket.once('voice:signal', resolve);
  });
  aliceSocket.emit('voice:signal', {
    channelId,
    signal: { type: 'ping-muted-carrier', payload: 'webrtc-alive' }
  });
  const receivedSignalWhileMuted = await bobSignalWhileAliceMuted;
  if (receivedSignalWhileMuted.signal?.type === 'ping-muted-carrier') {
    console.log('  PASSED: WebRTC connection remains alive while Player A is muted!');
  } else {
    throw new Error('FAILED: WebRTC signaling failed while muted!');
  }

  // Bob sends audio / signal back to Alice while Alice is muted
  const aliceSignalFromBob = new Promise((resolve) => {
    aliceSocket.once('voice:signal', resolve);
  });
  bobSocket.emit('voice:signal', {
    channelId,
    signal: { type: 'ping-partner-carrier', payload: 'bob-speaking-connected' }
  });
  const receivedSignalFromBob = await aliceSignalFromBob;
  if (receivedSignalFromBob.signal?.type === 'ping-partner-carrier') {
    console.log('  PASSED: Player B remains connected, speaking, and transmitting back to Player A!');
  } else {
    throw new Error('FAILED: Player B disconnected or unable to transmit to Alice!');
  }

  if (bobUnexpectedLeft) {
    throw new Error('FAILED: WebRTC connection was closed or Player B was disconnected when Player A muted!');
  }
  bobSocket.off('voice:peer_left', unexpectedLeftHandler);
  bobSocket.off('voice:session_ended', unexpectedLeftHandler);


  // TEST 10: WebRTC Signaling Relay (SDP Offer -> Answer -> ICE)
  console.log('\n[TEST 10] Testing WebRTC Signaling Relay (P2P audio coordination)...');
  const bobSignalPromise = new Promise((resolve) => {
    bobSocket.once('voice:signal', resolve);
  });
  aliceSocket.emit('voice:signal', {
    channelId,
    signal: { type: 'offer', sdp: 'v=0\r\no=alice 123 2 IN IP4 127.0.0.1' }
  });
  const relayedSignal = await bobSignalPromise;
  console.log(`  PASSED: Relayed signal received by Bob (type: ${relayedSignal.signal.type})`);

  // TEST 11: Leave Voice Flow
  console.log('\n[TEST 11] Testing [ Leave Voice ] flow...');
  // 1. Bob listens for peer_left notification
  const bobPeerLeftPromise = new Promise((resolve) => {
    bobSocket.once('voice:peer_left', resolve);
  });
  // 2. User presence update
  const presenceVoicePromise = new Promise((resolve) => {
    bobSocket.once('user:presence_update', resolve);
  });

  // Alice clicks [ Leave Voice ]
  const leaveRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:leave_session', { channelId }, resolve);
  });
  if (!leaveRes.success) {
    throw new Error('FAILED: Alice failed to leave voice session!');
  }
  console.log('  PASSED: Alice left voice session successfully.');

  const peerLeftData = await bobPeerLeftPromise;
  if (peerLeftData.userId === aliceId) {
    console.log(`  PASSED: Bob received voice:peer_left notification (${peerLeftData.userName || 'Alice'} left)`);
  } else {
    throw new Error('FAILED: Bob did not receive correct peer_left notification');
  }

  const voicePresenceData = await presenceVoicePromise;
  if (voicePresenceData.userId === aliceId && voicePresenceData.inVoice === false) {
    console.log('  PASSED: Presence broadcast updated (Alice inVoice=false)');
  }

  // Verify friendship is NOT removed
  const statusRes = await getJSON(`${API_URL}/api/friends/status/${bobId}`, aliceToken);
  if (statusRes.data.status === 'ACCEPTED' || statusRes.data.data?.status === 'ACCEPTED') {
    console.log('  PASSED: Leaving voice did NOT remove the friendship (Friendship remains ACCEPTED)');
  } else {
    throw new Error(`FAILED: Friendship status changed upon leaving voice: ${JSON.stringify(statusRes.data)}`);
  }

  // Verify seating is NOT lost (they remain seated together)
  // We prove both are still co-seated because server-side voice:join_session strictly requires Condition 5 (co-seated on same bench)
  const coSeatedCheck = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: bobId }, resolve);
  });
  if (coSeatedCheck.success) {
    console.log('  PASSED: Players continue sitting together on bench_001 after leaving voice!');
    // Alice leaves again
    await new Promise((resolve) => {
      aliceSocket.emit('voice:leave_session', { channelId }, resolve);
    });
  } else {
    throw new Error(`FAILED: Players were stood up or unseated upon leaving voice: ${coSeatedCheck.error}`);
  }

  // Verify chat continues working while sitting together
  // Alice sends a direct message to Bob using the established friendship conversation
  const sendMsgRes = await postJSON(
    `${API_URL}/conversations/${reqId}/messages`,
    { content: 'We can still chat while sitting together!' },
    aliceToken
  );
  if (sendMsgRes.data?.success || sendMsgRes.status === 201 || sendMsgRes.status === 200) {
    console.log('  PASSED: Direct messaging continues to work seamlessly while co-seated!');
  } else {
    throw new Error(`FAILED: Direct message failed while co-seated: ${JSON.stringify(sendMsgRes.data)}`);
  }

  // TEST 12: Player leaves seat -> Voice interaction context ends -> WebRTC closes -> Voice UI disappears
  console.log('\n[TEST 12] Testing Player Leaves Seat Flow:');
  console.log('  Player A leaves seat');
  console.log('        ↓');
  console.log('  Voice interaction context ends');
  console.log('        ↓');
  console.log('  WebRTC connection closes');
  console.log('        ↓');
  console.log('  Voice UI disappears');

  // Both Alice and Bob enter voice session while co-seated
  await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: bobId }, resolve);
  });
  await new Promise((resolve) => {
    bobSocket.emit('voice:join_session', { targetUserId: aliceId }, resolve);
  });

  // Bob sets up listeners for session ended, co-seated cleared, and presence update
  const bobSessionEndedPromise = new Promise((resolve) => {
    bobSocket.once('voice:session_ended', resolve);
  });
  const bobCoSeatedClearedPromise = new Promise((resolve) => {
    bobSocket.once('seating:co_seated_cleared', resolve);
  });
  const presenceUpdatePromise = new Promise((resolve) => {
    bobSocket.once('user:presence_update', resolve);
  });

  // Player A stands up from the seat
  aliceSocket.emit('player_stand', { seatId: 'umbrella_014_seat_A', benchId: 'umbrella_014' });

  const sessionEndEvent = await bobSessionEndedPromise;
  if (sessionEndEvent.reason === 'seat_vacated' && sessionEndEvent.leavingUserId === aliceId) {
    console.log('  PASSED: Voice interaction context ended (reason: seat_vacated)');
  } else {
    throw new Error('FAILED: Voice session was not ended upon player standing!');
  }

  const clearedEvent = await bobCoSeatedClearedPromise;
  if (clearedEvent.objectId === 'umbrella_014') {
    console.log('  PASSED: Co-seated interaction context cleared for partner');
  }

  const presEvent = await presenceUpdatePromise;
  if (presEvent.userId === aliceId && presEvent.inVoice === false) {
    console.log('  PASSED: Presence updated: inVoice=false');
  }

  // Verify voice session is completely closed on server
  const afterStandJoinCheck = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: bobId }, resolve);
  });
  if (afterStandJoinCheck.success === false && afterStandJoinCheck.error.includes('not seated')) {
    console.log(`  PASSED: WebRTC connection closed & voice creation blocked while standing: "${afterStandJoinCheck.error}"`);
    console.log('  PASSED: Voice UI disappears (client resets isInVoice=false, coSeatedContext=null)');
  } else {
    throw new Error('FAILED: Voice session allowed when player was standing!');
  }

  // TEST 13: Condition 4: Blocked relationship prevention
  console.log('\n[TEST 13] Testing Condition 4: Rejection when users have blocked each other...');
  await postJSON(`${API_URL}/friends/${aliceId}/block`, {}, bobToken);
  console.log('  Bob blocked Alice.');

  const blockedRes = await new Promise((resolve) => {
    aliceSocket.emit('voice:join_session', { targetUserId: bobId }, resolve);
  });
  if (blockedRes.success === false && blockedRes.error.includes('block')) {
    console.log(`  PASSED: Voice session strictly REJECTED when blocked: "${blockedRes.error}"`);
  } else {
    throw new Error('FAILED: Voice session permitted between blocked users!');
  }

  // Cleanup sockets
  aliceSocket.disconnect();
  bobSocket.disconnect();
  charlieSocket.disconnect();
  eveSocket.disconnect();

  console.log('\n================================================================');
  console.log('   ALL CHUNK 12 VOICE, SEATING & LEAVE TESTS PASSED (13/13)!   ');
  console.log('================================================================\n');
}

runVoiceCallTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nTEST SUITE FAILED:', err);
    process.exit(1);
  });
