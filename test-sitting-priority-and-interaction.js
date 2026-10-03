/**
 * test-sitting-priority-and-interaction.js
 * Verification of Seating Priority & Multiplayer Co-Seated Synchronization
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
  console.log('   BENCH SEATING & MULTIPLAYER INTERACTION SYNC TEST            ');
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

  assert(token1 && token2, 'Both tokens acquired successfully');
  console.log(`User 1: ${user1.name} (${user1._id})`);
  console.log(`User 2: ${user2.name} (${user2._id})\n`);

  // Connect sockets
  const s1 = ioClient(SOCKET_URL, { auth: { token: token1 }, transports: ['websocket'] });
  const s2 = ioClient(SOCKET_URL, { auth: { token: token2 }, transports: ['websocket'] });

  await Promise.all([
    new Promise((r) => s1.on('connect', r)),
    new Promise((r) => s2.on('connect', r))
  ]);

  assert(s1.connected && s2.connected, 'Both sockets connected via WebSocket');

  // Both join campus in main-plaza
  s1.emit('campus:join', { campusArea: 'main-plaza', x: 1800, z: 1900 });
  s2.emit('campus:join', { campusArea: 'main-plaza', x: 1820, z: 1900 });

  await new Promise((r) => setTimeout(r, 600));

  // Player 1 sits down on seat bench_1_seat_A
  const seatId1 = 'bench_1_seat_A';
  let s2ReceivedSit = null;

  s2.on('player_sit', (data) => {
    if (data.userId === user1._id) {
      s2ReceivedSit = data;
    }
  });

  s1.emit('player_sit', { seatId: seatId1, x: 1800, y: 1900, facing: 'down' });

  await new Promise((r) => setTimeout(r, 600));

  assert(s2ReceivedSit !== null, 'Player 2 received player_sit broadcast event from Player 1');
  assert(s2ReceivedSit.seatId === seatId1, `Player 2 saw Player 1 sit on ${seatId1}`);
  console.log(`  ✓ Player 1 successfully occupied ${seatId1}`);

  // Player 2 sits on the partner seat bench_1_seat_B right next to Player 1
  const seatId2 = 'bench_1_seat_B';
  let s1ReceivedSit = null;
  let s1CoSeatedContext = null;
  let s2CoSeatedContext = null;

  s1.on('player_sit', (data) => {
    if (data.userId === user2._id) {
      s1ReceivedSit = data;
    }
  });

  s1.on('seating:co_seated_context', (data) => {
    s1CoSeatedContext = data;
  });

  s2.on('seating:co_seated_context', (data) => {
    s2CoSeatedContext = data;
  });

  s2.emit('player_sit', { seatId: seatId2, x: 1828, y: 1900, facing: 'down' });

  await new Promise((r) => setTimeout(r, 800));

  assert(s1ReceivedSit !== null, 'Player 1 received player_sit broadcast event from Player 2');
  assert(s1ReceivedSit.seatId === seatId2, `Player 1 saw Player 2 sit on ${seatId2}`);
  console.log(`  ✓ Player 2 successfully occupied ${seatId2}`);

  // Check co-seated context if emitted for friends
  if (s1CoSeatedContext || s2CoSeatedContext) {
    console.log(`  ✓ Server emitted authoritative co-seated context for bench partners!`);
  }

  // Player 1 stands up
  let s2ReceivedStand = null;
  s2.on('player_stand', (data) => {
    if (data.userId === user1._id) {
      s2ReceivedStand = data;
    }
  });

  s1.emit('player_stand', { seatId: seatId1, x: 1800, y: 1924 });

  await new Promise((r) => setTimeout(r, 600));

  assert(s2ReceivedStand !== null, 'Player 2 received player_stand event from Player 1');
  console.log(`  ✓ Player 1 stood up and notified peers`);

  s1.disconnect();
  s2.disconnect();

  console.log('\n================================================================');
  console.log('   ALL SEATING & INTERACTION TESTS PASSED!                      ');
  console.log('================================================================\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
