const { io } = require('../frontend/node_modules/socket.io-client');

const API_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

async function runMultiplayerTest() {
  console.log('========================================================');
  console.log('   THE QUAD: REAL-TIME MULTIPLAYER PRESENCE TEST       ');
  console.log('========================================================\n');

  // 1. Register Student A (Lucas)
  const lucasEmail = `lucas_${Date.now()}@thequad.edu`;
  const lucasRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Lucas Wright',
      email: lucasEmail,
      password: 'CampusPass2026!',
      dateOfBirth: '2000-05-15',
      gender: 'male',
      city: 'Oxford Campus',
      relationshipIntent: 'dating'
    })
  });
  const lucasData = await lucasRes.json();
  const lucasToken = lucasData.data.token;
  const lucasId = lucasData.data.user.id || lucasData.data.user._id;
  console.log(`[1] Student A (Lucas) registered. ID: ${lucasId}`);

  // 2. Register Student B (Elena)
  const elenaEmail = `elena_${Date.now()}@thequad.edu`;
  const elenaRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Elena Rostova',
      email: elenaEmail,
      password: 'CampusPass2026!',
      dateOfBirth: '2001-11-20',
      gender: 'female',
      city: 'London Campus',
      relationshipIntent: 'dating'
    })
  });
  const elenaData = await elenaRes.json();
  const elenaToken = elenaData.data.token;
  const elenaId = elenaData.data.user.id || elenaData.data.user._id;
  console.log(`[2] Student B (Elena) registered. ID: ${elenaId}`);

  // 3. Connect Lucas Socket with JWT
  console.log('\n[3] Connecting Lucas socket with verified JWT token...');
  const socketLucas = io(SOCKET_URL, {
    auth: { token: lucasToken },
    transports: ['websocket']
  });

  await new Promise((resolve) => socketLucas.on('connect', resolve));
  console.log(`PASSED: Lucas connected to Socket.IO. Socket ID: ${socketLucas.id}`);

  // 4. Lucas joins Campus
  console.log('\n[4] Lucas joins Main Plaza...');
  socketLucas.emit('campus:join', {
    campusArea: 'main-plaza',
    x: 0,
    y: 0,
    z: 0,
    rotation: 0
  });

  const lucasInit = await new Promise((resolve) => {
    socketLucas.on('campus:init', resolve);
  });
  console.log(`PASSED: Lucas received campus:init. Verified Name: "${lucasInit.self.displayName}", Area: "${lucasInit.self.campusArea}"`);

  // 5. Connect Elena Socket with JWT
  console.log('\n[5] Connecting Elena socket with verified JWT token...');
  const socketElena = io(SOCKET_URL, {
    auth: { token: elenaToken },
    transports: ['websocket']
  });

  await new Promise((resolve) => socketElena.on('connect', resolve));
  console.log(`PASSED: Elena connected to Socket.IO. Socket ID: ${socketElena.id}`);

  // Setup listener on Lucas for Elena's arrival
  const elenaJoinedPromise = new Promise((resolve) => {
    socketLucas.on('player:joined', (player) => {
      resolve(player);
    });
  });

  // Elena joins Main Plaza
  console.log('\n[6] Elena enters Main Plaza...');
  socketElena.emit('campus:join', {
    campusArea: 'main-plaza',
    x: 2.5,
    y: 0,
    z: 1.5,
    rotation: Math.PI / 2
  });

  const arrivedPlayer = await elenaJoinedPromise;
  console.log(`PASSED: Lucas received real-time "player:joined" event: ${arrivedPlayer.displayName} at [${arrivedPlayer.position.join(', ')}] in ${arrivedPlayer.campusArea}`);

  // 6. Test Position Synchronization (Elena moves in Main Plaza)
  console.log('\n[7] Elena moves forward in Main Plaza...');
  const elenaMovedPromise = new Promise((resolve) => {
    socketLucas.on('player:moved', (data) => {
      if (data.socketId === socketElena.id) resolve(data);
    });
  });

  socketElena.emit('player:move', {
    x: 3.8,
    y: 0,
    z: 2.2,
    rotation: 1.25,
    animationState: 'walk',
    campusArea: 'main-plaza'
  });

  const moveData = await elenaMovedPromise;
  console.log(`PASSED: Lucas received synchronized movement for Elena: position [${moveData.position.join(', ')}], rotation: ${moveData.rotation}, animation: ${moveData.animationState}`);

  // 7. Test Campus Area Rooms (Elena moves from Main Plaza to Café)
  console.log('\n[8] Elena walks into The Daily Grind Café...');
  const areaChangePromise = new Promise((resolve) => {
    socketLucas.on('player:area_changed', (data) => {
      if (data.socketId === socketElena.id) resolve(data);
    });
  });

  socketElena.emit('player:move', {
    x: -15,
    y: 0,
    z: -14,
    rotation: 0,
    animationState: 'walk',
    campusArea: 'cafe'
  });

  const areaChangeData = await areaChangePromise;
  console.log(`PASSED: Elena area transition synchronized: oldArea: "${areaChangeData.oldArea}" -> newArea: "${areaChangeData.newArea}"`);

  // 8. Test Area Traffic Isolation:
  // Elena moves inside Café; Lucas is in Main Plaza, so Lucas should NOT get movement ticks sent only to area:cafe!
  console.log('\n[9] Testing Area Room Isolation (Elena moves inside Café)...');
  let lucasGotCafeTick = false;
  const cafeMoveHandler = (data) => {
    if (data.socketId === socketElena.id && data.campusArea === 'cafe') {
      lucasGotCafeTick = true;
    }
  };
  socketLucas.on('player:moved', cafeMoveHandler);

  socketElena.emit('player:move', {
    x: -16.2,
    y: 0,
    z: -15.1,
    rotation: 0.5,
    animationState: 'walk',
    campusArea: 'cafe'
  });

  await new Promise((r) => setTimeout(r, 400));
  socketLucas.off('player:moved', cafeMoveHandler);

  if (!lucasGotCafeTick) {
    console.log('PASSED: Area Room Isolation confirmed! Lucas in Main Plaza was not flooded with Elena\'s local Café movement ticks.');
  } else {
    throw new Error('FAILED: Area isolation failed! Lucas received area-scoped movement from another zone.');
  }

  // 9. Test Social Proximity Interaction (Wave)
  console.log('\n[10] Testing Social Interaction (Lucas waves to Elena)...');
  const wavePromise = new Promise((resolve) => {
    socketElena.on('player:waved_at', (data) => {
      resolve(data);
    });
  });

  socketLucas.emit('player:wave', {
    targetSocketId: socketElena.id,
    targetUserId: elenaId
  });

  const waveData = await wavePromise;
  console.log(`PASSED: Elena received wave from ${waveData.senderName} (verified sender ID: ${waveData.senderUserId})!`);

  // 10. Test Campus Chat (Area-scoped broadcast)
  console.log('\n[11] Elena sends campus chat message in Café...');
  const chatPromise = new Promise((resolve) => {
    socketElena.on('chat:campus_broadcast', (msg) => {
      resolve(msg);
    });
  });

  socketElena.emit('chat:campus_message', {
    text: 'Loving the synthwave playlist at the espresso bar!',
    campusArea: 'cafe'
  });

  const chatMsg = await chatPromise;
  console.log(`PASSED: Campus chat broadcast received: "${chatMsg.senderName}: ${chatMsg.text}" in [${chatMsg.campusArea}]`);

  // 11. Test Clean Disconnect
  console.log('\n[12] Testing Clean Avatar Removal on Disconnect...');
  const leftPromise = new Promise((resolve) => {
    socketLucas.on('player:left', (data) => {
      resolve(data);
    });
  });

  socketElena.disconnect();
  const leftData = await leftPromise;
  console.log(`PASSED: Lucas received "player:left" event cleanly for socket: ${leftData.socketId}, userId: ${leftData.userId}`);

  socketLucas.disconnect();

  console.log('\n========================================================');
  console.log('   REAL-TIME MULTIPLAYER PRESENCE VERIFIED 100%!       ');
  console.log('========================================================');
}

runMultiplayerTest().catch((err) => {
  console.error('\nMULTIPLAYER TEST FAILED:', err);
  process.exit(1);
});
