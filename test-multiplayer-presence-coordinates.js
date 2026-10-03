/**
 * test-multiplayer-presence-coordinates.js
 * Verification of 2D Campus Multiplayer Presence & Coordinate Synchronization
 */

const { io: ioClient } = require('../frontend/node_modules/socket.io-client');

const API_URL = 'http://localhost:5000';
const SOCKET_URL = 'http://localhost:5000';

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bypass-ratelimit': 'datee-testing-secret'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function run() {
  console.log('================================================================');
  console.log('   2D CAMPUS MULTIPLAYER PRESENCE & COORDINATE VERIFICATION     ');
  console.log('================================================================\n');

  const unique = Date.now().toString().slice(-6);

  // 1. Register Tanush Saha and Saha 5
  console.log('[STEP 1] Registering test accounts via API...');
  const tanushRes = await postJSON(`${API_URL}/api/auth/register`, {
    name: 'Tanush Saha',
    email: `tanush_${unique}@campus.edu`,
    password: 'Password123!',
    gender: 'male',
    dateOfBirth: '2000-01-01',
    city: 'Campus Grounds',
    relationshipIntent: 'dating'
  });

  const saha5Res = await postJSON(`${API_URL}/api/auth/register`, {
    name: 'Saha 5',
    email: `saha5_${unique}@campus.edu`,
    password: 'Password123!',
    gender: 'female',
    dateOfBirth: '2001-05-15',
    city: 'Campus Grounds',
    relationshipIntent: 'dating'
  });

  const tokenTanush = tanushRes.data?.data?.token || tanushRes.data?.token;
  const userTanush = tanushRes.data?.data?.user || tanushRes.data?.user;
  const tanushId = (userTanush?._id || userTanush?.id).toString();

  const tokenSaha5 = saha5Res.data?.data?.token || saha5Res.data?.token;
  const userSaha5 = saha5Res.data?.data?.user || saha5Res.data?.user;
  const saha5Id = (userSaha5?._id || userSaha5?.id).toString();

  assert(Boolean(tokenTanush && tokenSaha5), 'Both accounts registered and issued JWT tokens');
  console.log(`  Tanush: ${userTanush.name} (${tanushId})`);
  console.log(`  Saha 5: ${userSaha5.name} (${saha5Id})\n`);

  // 2. Connect Tanush socket and join at (1800, 1900)
  console.log('[STEP 2] Connecting Tanush socket...');
  const socketTanush = ioClient(SOCKET_URL, {
    auth: { token: tokenTanush },
    transports: ['websocket'],
    reconnection: false
  });

  await new Promise((resolve, reject) => {
    socketTanush.on('connect', resolve);
    socketTanush.on('connect_error', reject);
  });
  console.log(`  Tanush connected: ${socketTanush.id}`);

  const tanushInitPromise = new Promise((resolve) => {
    socketTanush.once('campus:init', (data) => resolve(data));
  });

  socketTanush.emit('campus:join', {
    campusArea: 'main-plaza',
    x: 1800,
    z: 1900
  });

  const tanushInit = await tanushInitPromise;
  assert(
    tanushInit.self.position[0] === 1800 && tanushInit.self.position[2] === 1900,
    `Tanush initial position is [1800, 0, 1900] (NOT clamped to 26!)`
  );

  // 3. Connect Saha 5 socket and join at (1850, 1920)
  console.log('\n[STEP 3] Connecting Saha 5 socket...');
  const socketSaha5 = ioClient(SOCKET_URL, {
    auth: { token: tokenSaha5 },
    transports: ['websocket'],
    reconnection: false
  });

  await new Promise((resolve, reject) => {
    socketSaha5.on('connect', resolve);
    socketSaha5.on('connect_error', reject);
  });
  console.log(`  Saha 5 connected: ${socketSaha5.id}`);

  const tanushSeesSaha5JoinedPromise = new Promise((resolve) => {
    socketTanush.on('player:joined', (player) => {
      if (player.userId === saha5Id) {
        resolve(player);
      }
    });
  });

  const saha5InitPromise = new Promise((resolve) => {
    socketSaha5.once('campus:init', (data) => resolve(data));
  });

  socketSaha5.emit('campus:join', {
    campusArea: 'main-plaza',
    x: 1850,
    z: 1920
  });

  const [saha5JoinedData, saha5InitData] = await Promise.all([
    tanushSeesSaha5JoinedPromise,
    saha5InitPromise
  ]);

  // 4. Verify Tanush sees Saha 5 joined with full coordinates
  console.log('\n[STEP 4] Verifying cross-player join visibility...');
  assert(
    saha5JoinedData.position[0] === 1850 && saha5JoinedData.position[2] === 1920,
    `Tanush receives player:joined with Saha 5 at (${saha5JoinedData.position[0]}, ${saha5JoinedData.position[2]})`
  );

  // 5. Verify Saha 5 initial campus:init contains Tanush at (1800, 1900)
  const tanushInSaha5List = saha5InitData.players.find((p) => p.userId === tanushId);
  assert(Boolean(tanushInSaha5List), 'Saha 5 receives Tanush in initial campus players list');
  assert(
    tanushInSaha5List.position[0] === 1800 && tanushInSaha5List.position[2] === 1900,
    `Saha 5 sees Tanush at (${tanushInSaha5List.position[0]}, ${tanushInSaha5List.position[2]}) in campus:init`
  );

  // 6. Test movement from Saha 5 to (1820, 1890)
  console.log('\n[STEP 5] Testing Saha 5 movement synchronization...');
  const tanushSeesSaha5MovePromise = new Promise((resolve) => {
    socketTanush.on('player:moved', (data) => {
      if (data.userId === saha5Id) {
        resolve(data);
      }
    });
  });

  socketSaha5.emit('player:move', {
    x: 1820,
    y: 0,
    z: 1890,
    campusArea: 'main-plaza',
    animationState: 'walk'
  });

  const saha5MovedData = await tanushSeesSaha5MovePromise;
  assert(
    saha5MovedData.position[0] === 1820 && saha5MovedData.position[2] === 1890,
    `Tanush receives player:moved with Saha 5 position at (${saha5MovedData.position[0]}, ${saha5MovedData.position[2]})`
  );

  // 7. Test movement from Tanush to (1790, 1880)
  console.log('\n[STEP 6] Testing Tanush movement synchronization...');
  const saha5SeesTanushMovePromise = new Promise((resolve) => {
    socketSaha5.on('player:moved', (data) => {
      if (data.userId === tanushId) {
        resolve(data);
      }
    });
  });

  socketTanush.emit('player:move', {
    x: 1790,
    y: 0,
    z: 1880,
    campusArea: 'main-plaza',
    animationState: 'walk'
  });

  const tanushMovedData = await saha5SeesTanushMovePromise;
  assert(
    tanushMovedData.position[0] === 1790 && tanushMovedData.position[2] === 1880,
    `Saha 5 receives player:moved with Tanush position at (${tanushMovedData.position[0]}, ${tanushMovedData.position[2]})`
  );

  // Clean up
  socketTanush.disconnect();
  socketSaha5.disconnect();

  console.log('\n================================================================');
  console.log('🎉 ALL 2D CAMPUS MULTIPLAYER PRESENCE TESTS PASSED (100%)!');
  console.log('================================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Test Error:', err);
  process.exit(1);
});
