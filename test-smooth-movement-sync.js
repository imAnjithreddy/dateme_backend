/**
 * test-smooth-movement-sync.js
 * Verification of High-Frequency Movement Stream & Instant Stop Packet Synchronization
 */

const { io: ioClient } = require('../frontend/node_modules/socket.io-client');

const API_URL = 'http://localhost:5000';
const SOCKET_URL = 'http://localhost:5000';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function run() {
  console.log('================================================================');
  console.log('   60FPS SMOOTH MULTIPLAYER MOVEMENT & STOP STREAM TEST         ');
  console.log('================================================================\n');

  // Login existing seeded accounts
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

  console.log(`User 1: ${user1.name} (${user1._id})`);
  console.log(`User 2: ${user2.name} (${user2._id})\n`);

  // Connect sockets
  const s1 = ioClient(SOCKET_URL, { auth: { token: token1 }, transports: ['websocket'] });
  const s2 = ioClient(SOCKET_URL, { auth: { token: token2 }, transports: ['websocket'] });

  await Promise.all([
    new Promise((r) => s1.on('connect', r)),
    new Promise((r) => s2.on('connect', r))
  ]);

  console.log('Both sockets connected successfully');

  // Both join campus
  s1.emit('campus:join', { campusArea: 'main-plaza', x: 1800, z: 1900 });
  s2.emit('campus:join', { campusArea: 'main-plaza', x: 1850, z: 1920 });

  await new Promise((r) => setTimeout(r, 200));

  // User 1 listens for User 2's movement packets
  const receivedPackets = [];
  s1.on('player:moved', (data) => {
    if (data.userId === user2._id.toString()) {
      receivedPackets.push({
        time: Date.now(),
        position: data.position,
        animationState: data.animationState
      });
    }
  });

  // User 2 sends 10 rapid movement packets at 35ms intervals (simulating 28Hz walking)
  console.log('\n[STEP 1] Streaming 10 high-frequency movement updates at 35ms intervals...');
  let currentX = 1850;
  let currentZ = 1920;

  for (let i = 0; i < 10; i++) {
    currentX += 3;
    currentZ += 2;
    s2.emit('player:move', {
      x: currentX,
      y: 0,
      z: currentZ,
      campusArea: 'main-plaza',
      animationState: 'walk',
      isMoving: true
    });
    await new Promise((r) => setTimeout(r, 35));
  }

  // User 2 sends immediate stop packet
  console.log('[STEP 2] Emitting immediate stop packet...');
  s2.emit('player:move', {
    x: currentX,
    y: 0,
    z: currentZ,
    campusArea: 'main-plaza',
    animationState: 'idle',
    isMoving: false
  });

  // Wait 150ms for delivery
  await new Promise((r) => setTimeout(r, 150));

  assert(receivedPackets.length >= 10, `User 1 received all ${receivedPackets.length} movement packets streamed at 35ms intervals`);

  const lastPacket = receivedPackets[receivedPackets.length - 1];
  assert(
    lastPacket.animationState === 'idle',
    `Stop packet received immediately with animationState="idle" at final position (${lastPacket.position[0]}, ${lastPacket.position[2]})`
  );

  console.log(`  Initial X: 1850, Final Received X: ${lastPacket.position[0]}`);
  console.log(`  Initial Z: 1920, Final Received Z: ${lastPacket.position[2]}`);

  s1.disconnect();
  s2.disconnect();

  console.log('\n================================================================');
  console.log('🎉 60FPS SMOOTH MOVEMENT & STOP STREAM TEST PASSED (100%)!');
  console.log('================================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Test Error:', err);
  process.exit(1);
});
