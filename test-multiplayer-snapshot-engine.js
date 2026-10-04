/**
 * Automated Verification Test Suite for Multiplayer Snapshot Engine & Remote Player Interpolation
 * Datee_me 2D Campus World
 */

const assert = require('assert');
const snapshotEngine = require('./socket/snapshotEngine');

console.log('🧪 Starting Multiplayer Snapshot Engine Verification Suite...\n');

// Mock socket.io server
class MockIO {
  constructor() {
    this.emittedEvents = [];
  }

  to(room) {
    return {
      emit: (event, payload) => {
        this.emittedEvents.push({ room, event, payload, timestamp: Date.now() });
      }
    };
  }

  emit(event, payload) {
    this.emittedEvents.push({ room: 'broadcast', event, payload, timestamp: Date.now() });
  }

  clear() {
    this.emittedEvents = [];
  }
}

async function runTests() {
  const mockIo = new MockIO();

  // Test 1: Player registration and validation
  console.log('Test 1: Player Registration and Coordinate Initialization');
  snapshotEngine.registerPlayer('p1', {
    x: 1000,
    y: 1000,
    userId: 'u1',
    campusArea: 'main-plaza'
  });

  const p1State = snapshotEngine.getPlayer('p1');
  assert(p1State !== null, 'Player p1 must be registered');
  assert.strictEqual(p1State.x, 1000, 'Player p1 initial X must be 1000');
  assert.strictEqual(p1State.y, 1000, 'Player p1 initial Y must be 1000');
  console.log('  ✅ Player registered correctly.\n');

  // Test 2: Monotonic Sequence Number and Speed Validation
  console.log('Test 2: Monotonic Sequence Tracking & Speed Limit Enforcement');
  
  // Normal valid movement (walk: 1000 -> 1050 over 300ms = 166px/sec <= 240px/sec)
  p1State.lastUpdateTimestamp = Date.now() - 300;
  const validMove = snapshotEngine.processMovementInput('p1', {
    x: 1050,
    y: 1000,
    isMoving: true,
    animationState: 'walk',
    sequence: 1,
    campusArea: 'main-plaza',
    timestamp: Date.now()
  });

  assert(validMove !== null, 'Valid move should be processed');
  assert.strictEqual(Math.round(validMove.x), 1050, 'X position should update to 1050');
  assert.strictEqual(validMove.lastInputSeq, 1, 'Input sequence should be 1');

  // Discard older sequence number (e.g., sequence 1 arrives after sequence 2)
  p1State.lastUpdateTimestamp = Date.now() - 300;
  snapshotEngine.processMovementInput('p1', {
    x: 1080,
    y: 1000,
    sequence: 3,
    timestamp: Date.now()
  });

  const outdatedMove = snapshotEngine.processMovementInput('p1', {
    x: 1020,
    y: 1000,
    sequence: 2, // Out of order!
    timestamp: Date.now()
  });

  assert.strictEqual(outdatedMove, null, 'Out of order sequence number must be discarded');
  console.log('  ✅ Out-of-order sequence rejection verified.\n');

  // Test 3: Teleport & Speed Clamp Validation
  console.log('Test 3: Teleport and Speed Clamping');
  // Attempt invalid instant jump across map (1080 -> 3500 within 50ms)
  const jumpMove = snapshotEngine.processMovementInput('p1', {
    x: 3500,
    y: 1000,
    sequence: 4,
    timestamp: Date.now()
  });

  // Engine clamps speed to max permissible displacement rather than teleporting
  assert(jumpMove.x < 3500, 'Speed must be validated and clamped against teleporting');
  console.log(`  ✅ Speed validation clamped displacement correctly to x=${Math.round(jumpMove.x)}.\n`);

  // Test 4: Seating State Preservation
  console.log('Test 4: Seating State Synchronization');
  snapshotEngine.setPlayerSeated('p1', {
    chairId: 'bench-north-1',
    chairX: 1200,
    chairY: 1250,
    facing: 'south'
  });

  const seatedPlayer = snapshotEngine.getPlayer('p1');
  assert.strictEqual(seatedPlayer.isSeated, true, 'Player must be marked seated');
  assert.strictEqual(seatedPlayer.chairId, 'bench-north-1', 'Chair ID must be preserved');
  console.log('  ✅ Seating state integrated properly.\n');

  // Test 5: Snapshot Loop Tick Generation (15 Hz)
  console.log('Test 5: Snapshot Generation Tick Rate (15 Hz)');
  snapshotEngine.start(mockIo);
  
  // Wait for 350ms (should produce ~5 ticks: 350ms / 66.7ms = 5.2)
  await new Promise((res) => setTimeout(res, 350));
  snapshotEngine.stop();

  const snapshotEvents = mockIo.emittedEvents.filter(e => e.event === 'world:snapshot' && e.room === 'campus:world');
  console.log(`  Emitted ${snapshotEvents.length} global world ticks in ~350ms`);
  assert(snapshotEvents.length >= 3 && snapshotEvents.length <= 8, 'Snapshot tick rate should be ~15 Hz');

  // Check snapshot structure
  const firstSnapshot = snapshotEvents[0].payload;
  assert(firstSnapshot.serverTimestamp > 0, 'Snapshot must include serverTimestamp');
  assert(typeof firstSnapshot.seq === 'number', 'Snapshot must include monotonic seq');
  assert(Array.isArray(firstSnapshot.players), 'Snapshot must contain players array');
  
  // Verify monotonic seq
  for (let i = 1; i < snapshotEvents.length; i++) {
    assert(
      snapshotEvents[i].payload.seq > snapshotEvents[i - 1].payload.seq,
      'Snapshot sequence numbers must be monotonically increasing'
    );
  }
  console.log('  ✅ Monotonically increasing sequence numbers verified across snapshots.\n');

  // Test 6: Multi-client Crowd Simulation (20 concurrent players)
  console.log('Test 6: Multi-client Crowd Simulation (20 players)');
  mockIo.clear();
  snapshotEngine.start(mockIo);

  for (let i = 0; i < 20; i++) {
    snapshotEngine.registerPlayer(`bot_${i}`, {
      x: 1000 + i * 50,
      y: 1200 + (i % 5) * 40,
      userId: `user_bot_${i}`,
      campusArea: i % 2 === 0 ? 'main-plaza' : 'sports-complex'
    });
  }

  // Simulate movement updates from bots
  for (let frame = 1; frame <= 5; frame++) {
    for (let i = 0; i < 20; i++) {
      snapshotEngine.processMovementInput(`bot_${i}`, {
        x: 1000 + i * 50 + frame * 5,
        y: 1200 + (i % 5) * 40,
        isMoving: true,
        animationState: 'walk',
        sequence: frame,
        timestamp: Date.now()
      });
    }
    await new Promise((res) => setTimeout(res, 30));
  }

  await new Promise((res) => setTimeout(res, 100));
  snapshotEngine.stop();

  const multiSnapshots = mockIo.emittedEvents.filter(e => e.event === 'world:snapshot');
  assert(multiSnapshots.length > 0, 'Must emit snapshots during multi-client test');
  console.log(`  ✅ Successfully simulated 20 players producing smooth snapshots across rooms.\n`);

  console.log('🎉 ALL MULTIPLAYER MOVEMENT SNAPSHOT TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
