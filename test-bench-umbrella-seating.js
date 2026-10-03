/**
 * test-bench-umbrella-seating.js
 * Verification of Bench and Two-Person Umbrella Seating with Friendship System
 *
 * Rules:
 * 1. A bench may have exactly 2 seats (seat_A and seat_B).
 * 2. A two-person umbrella table may have exactly 2 seats (seat_A and seat_B).
 * 3. Players can sit only when an actual sittable object/seat exists.
 *    Do NOT allow arbitrary sitting on the ground.
 * 4. Do NOT allow players to occupy the same seat.
 * 5. Each seat must have a unique seat ID (e.g. bench_001_seat_A, umbrella_014_seat_B).
 * 6. When both players are seated:
 *    If they are friends: Show Message and Voice actions.
 *    If they are not friends: Show Add Friend.
 *    Do NOT automatically open chat or voice simply because two players are sitting together.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Friendship = require('./models/Friendship');
const Connection = require('./models/Connection');
const {
  sendFriendRequest,
  acceptFriendRequest,
  getFriendshipStatus
} = require('./controllers/friendController');

const assert = (condition, description) => {
  if (condition) {
    console.log(`  ✓ PASS: ${description}`);
  } else {
    console.error(`  ✗ FAIL: ${description}`);
    throw new Error(`Assertion failed: ${description}`);
  }
};

const createMockReqRes = (user, params = {}, body = {}) => {
  let statusCode = 200;
  let responseData = null;

  const req = { user, params, body, query: {}, headers: {} };
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

// Simulation of 2D Seating Layer in node test environment
class MockSittableObject {
  constructor({ id, type, name, x, y }) {
    this.id = id;
    this.type = type;
    this.name = name;
    this.x = x;
    this.y = y;

    // Both benches and 2-person umbrella tables have exactly 2 seats
    this.seats = [
      {
        seatId: `${id}_seat_A`,
        seatKey: 'A',
        seatName: `${name} (Left)`,
        seatType: type === 'umbrella-table' ? 'couple-seat' : 'bench-seat',
        groupId: id,
        anchorX: x - (type === 'umbrella-table' ? 36 : 14),
        anchorY: y + 8,
        occupied: false,
        occupiedBy: null
      },
      {
        seatId: `${id}_seat_B`,
        seatKey: 'B',
        seatName: `${name} (Right)`,
        seatType: type === 'umbrella-table' ? 'couple-seat' : 'bench-seat',
        groupId: id,
        anchorX: x + (type === 'umbrella-table' ? 36 : 14),
        anchorY: y + 8,
        occupied: false,
        occupiedBy: null
      }
    ];
  }

  occupy(seatId, userId) {
    const seat = this.seats.find((s) => s.seatId === seatId);
    if (!seat) return false;
    if (seat.occupied && seat.occupiedBy !== userId) {
      return false; // Already occupied by someone else!
    }
    seat.occupied = true;
    seat.occupiedBy = userId;
    return true;
  }

  vacate(seatId) {
    const seat = this.seats.find((s) => s.seatId === seatId);
    if (!seat) return false;
    seat.occupied = false;
    seat.occupiedBy = null;
    return true;
  }
}

class MockInteractionLayer {
  constructor() {
    this.sittableObjects = new Map();
    this.occupiedSeats = new Map(); // seatId -> userId
  }

  registerObject(obj) {
    this.sittableObjects.set(obj.id, obj);
  }

  occupySeat(seatId, userId) {
    if (!seatId) return false;
    const existing = this.occupiedSeats.get(seatId);
    if (existing && existing !== userId) {
      return false; // Reject duplicate seat occupancy
    }
    this.occupiedSeats.set(seatId, userId);
    for (const [, obj] of this.sittableObjects) {
      obj.occupy(seatId, userId);
    }
    return true;
  }

  vacateSeat(seatId) {
    if (!seatId) return false;
    this.occupiedSeats.delete(seatId);
    for (const [, obj] of this.sittableObjects) {
      obj.vacate(seatId);
    }
    return true;
  }

  isSeatOccupied(seatId) {
    return this.occupiedSeats.has(seatId);
  }

  getCoSeatedPartner(seatId) {
    if (!seatId) return { hasPartner: false, partnerSeatId: null, partnerUserId: null };
    for (const [, obj] of this.sittableObjects) {
      const seat = obj.seats.find((s) => s.seatId === seatId);
      if (seat) {
        const sibling = obj.seats.find((s) => s.seatId !== seatId);
        if (sibling) {
          const partnerUserId = this.occupiedSeats.get(sibling.seatId) || null;
          return {
            hasPartner: Boolean(partnerUserId),
            partnerSeatId: sibling.seatId,
            partnerUserId,
            sittableObject: obj
          };
        }
      }
    }
    return { hasPartner: false, partnerSeatId: null, partnerUserId: null };
  }

  findNearestAvailableSeat(playerX, playerY, maxDist = 34) {
    let nearest = null;
    let minDist = Infinity;

    for (const [, obj] of this.sittableObjects) {
      for (const seat of obj.seats) {
        if (this.occupiedSeats.has(seat.seatId)) continue;
        const dist = Math.hypot(playerX - seat.anchorX, playerY - seat.anchorY);
        if (dist <= maxDist && dist < minDist) {
          minDist = dist;
          nearest = seat;
        }
      }
    }
    return nearest;
  }
}

const { connectDB, disconnectDB } = require('./config/db');

async function runTests() {
  console.log('\n========================================================');
  console.log('   BENCH & UMBRELLA SEATING + FRIENDSHIP INTEGRATION    ');
  console.log('========================================================\n');

  await connectDB();

  const timestamp = Date.now();
  const playerA = await User.create({
    name: `Alice_${timestamp}`,
    email: `alice_${timestamp}@campus.edu`,
    password: 'password123',
    dateOfBirth: new Date('2002-04-10'),
    isVerified: true,
    campusYear: 'Junior',
    major: 'Architecture'
  });

  const playerB = await User.create({
    name: `Bob_${timestamp}`,
    email: `bob_${timestamp}@campus.edu`,
    password: 'password123',
    dateOfBirth: new Date('2001-11-20'),
    isVerified: true,
    campusYear: 'Senior',
    major: 'Computer Science'
  });

  const layer = new MockInteractionLayer();

  // Test 1: Bench has exactly 2 seats with unique IDs
  console.log('Test 1: A bench must have exactly 2 seats with unique IDs');
  const bench = new MockSittableObject({
    id: 'bench_001',
    type: 'plaza-bench',
    name: 'Plaza Bench',
    x: 1800,
    y: 1620
  });
  layer.registerObject(bench);

  assert(bench.seats.length === 2, 'Bench has exactly 2 seats');
  assert(bench.seats[0].seatId === 'bench_001_seat_A', 'Seat A has unique ID bench_001_seat_A');
  assert(bench.seats[1].seatId === 'bench_001_seat_B', 'Seat B has unique ID bench_001_seat_B');
  assert(bench.seats[0].seatId !== bench.seats[1].seatId, 'Seats have distinct IDs');

  // Test 2: Two-person umbrella table has exactly 2 seats with unique IDs
  console.log('\nTest 2: A two-person umbrella table must have exactly 2 seats with unique IDs');
  const umbrella = new MockSittableObject({
    id: 'umbrella_014',
    type: 'umbrella-table',
    name: 'Love Garden Umbrella Table',
    x: 740,
    y: 860
  });
  layer.registerObject(umbrella);

  assert(umbrella.seats.length === 2, 'Umbrella table has exactly 2 seats');
  assert(umbrella.seats[0].seatId === 'umbrella_014_seat_A', 'Seat A has unique ID umbrella_014_seat_A');
  assert(umbrella.seats[1].seatId === 'umbrella_014_seat_B', 'Seat B has unique ID umbrella_014_seat_B');
  assert(umbrella.seats[0].seatId !== umbrella.seats[1].seatId, 'Seats have distinct IDs');

  // Test 3: Do NOT allow arbitrary sitting on the ground
  console.log('\nTest 3: Players can sit ONLY when an actual sittable object exists (no ground sitting)');
  const openGroundSeat = layer.findNearestAvailableSeat(2000, 2000, 34); // open lawn far from seats
  assert(openGroundSeat === null, 'No seat found on arbitrary ground; ground sitting is prevented');

  // Test 4: Do NOT allow players to occupy the same seat
  console.log('\nTest 4: Players cannot occupy the same seat');
  const sitA1 = layer.occupySeat('bench_001_seat_A', playerA._id.toString());
  assert(sitA1 === true, 'Player A sits in bench_001_seat_A');
  assert(layer.isSeatOccupied('bench_001_seat_A') === true, 'bench_001_seat_A is now occupied');

  // Player B attempts to sit in the exact same seat
  const sitA2 = layer.occupySeat('bench_001_seat_A', playerB._id.toString());
  assert(sitA2 === false, 'Player B cannot sit in already-occupied bench_001_seat_A');

  // Test 5: Player B sits in seat_B of the same bench -> Both players are seated
  console.log('\nTest 5: Player B sits in bench_001_seat_B -> Co-seating detected');
  const sitB = layer.occupySeat('bench_001_seat_B', playerB._id.toString());
  assert(sitB === true, 'Player B sits in bench_001_seat_B');

  const coSeatedA = layer.getCoSeatedPartner('bench_001_seat_A');
  assert(coSeatedA.hasPartner === true, 'Player A detects co-seated partner');
  assert(coSeatedA.partnerUserId === playerB._id.toString(), 'Partner user ID matches Player B');

  const coSeatedB = layer.getCoSeatedPartner('bench_001_seat_B');
  assert(coSeatedB.hasPartner === true, 'Player B detects co-seated partner');
  assert(coSeatedB.partnerUserId === playerA._id.toString(), 'Partner user ID matches Player A');

  // Test 6: When both are seated and are NOT friends -> Show Add Friend, NOT Message/Voice
  console.log('\nTest 6: When both are seated and NOT friends -> Only Add Friend action');
  const mockReqRes1 = createMockReqRes(playerA, { targetUserId: playerB._id.toString() });
  await getFriendshipStatus(mockReqRes1.req, mockReqRes1.res, mockReqRes1.next);
  const statusNotFriends = mockReqRes1.res.getResponse()?.data;

  assert(statusNotFriends.isFriend === false, 'Status confirms NOT friends');
  assert(statusNotFriends.canMessage === false, 'canMessage is FALSE despite sitting together');
  assert(statusNotFriends.canVoice === false, 'canVoice is FALSE despite sitting together');
  assert(statusNotFriends.canAddFriend === true, 'canAddFriend is TRUE -> UI shows Add Friend action');

  // Test 7: Become friends and check permissions while seated together
  console.log('\nTest 7: When both are seated and ARE friends -> Show Message and Voice actions');
  // Player A sends friend request to Player B
  const reqResSend = createMockReqRes(playerA, {}, { targetUserId: playerB._id.toString(), note: 'Hey seatmate!' });
  await sendFriendRequest(reqResSend.req, reqResSend.res, reqResSend.next);
  const reqData = reqResSend.res.getResponse()?.data;
  const requestId = reqData?._id || reqData?.requestId;

  // Player B accepts request
  const reqResAccept = createMockReqRes(playerB, { requestId });
  await acceptFriendRequest(reqResAccept.req, reqResAccept.res, reqResAccept.next);

  // Re-verify status while still seated together
  const mockReqRes2 = createMockReqRes(playerA, { targetUserId: playerB._id.toString() });
  await getFriendshipStatus(mockReqRes2.req, mockReqRes2.res, mockReqRes2.next);
  const statusFriends = mockReqRes2.res.getResponse()?.data;

  assert(statusFriends.isFriend === true, 'Status confirms ARE friends');
  assert(statusFriends.canMessage === true, 'canMessage is TRUE -> UI shows Message action');
  assert(statusFriends.canVoice === true, 'canVoice is TRUE -> UI shows Voice action');
  assert(statusFriends.canAddFriend === false, 'canAddFriend is FALSE');

  // Test 8: Umbrella seating co-sitting and standing up
  console.log('\nTest 8: Umbrella table seating and seat vacating');
  layer.vacateSeat('bench_001_seat_A');
  layer.vacateSeat('bench_001_seat_B');
  assert(layer.isSeatOccupied('bench_001_seat_A') === false, 'bench_001_seat_A is vacated');
  assert(layer.isSeatOccupied('bench_001_seat_B') === false, 'bench_001_seat_B is vacated');

  // Sit at umbrella table
  layer.occupySeat('umbrella_014_seat_A', playerA._id.toString());
  layer.occupySeat('umbrella_014_seat_B', playerB._id.toString());

  const coUmbrella = layer.getCoSeatedPartner('umbrella_014_seat_A');
  assert(coUmbrella.hasPartner === true, 'Co-seated at umbrella table');
  assert(coUmbrella.partnerSeatId === 'umbrella_014_seat_B', 'Partner seat is umbrella_014_seat_B');

  // Stand up from umbrella seat
  layer.vacateSeat('umbrella_014_seat_A');
  const coUmbrellaAfterStand = layer.getCoSeatedPartner('umbrella_014_seat_B');
  assert(coUmbrellaAfterStand.hasPartner === false, 'After standing, partner is no longer seated');

  // Cleanup test users
  await Friendship.deleteMany({
    $or: [
      { user1: playerA._id }, { user2: playerA._id },
      { user1: playerB._id }, { user2: playerB._id }
    ]
  });
  await Connection.deleteMany({
    $or: [
      { requester: playerA._id }, { recipient: playerA._id },
      { requester: playerB._id }, { recipient: playerB._id }
    ]
  });
  await User.deleteMany({ _id: { $in: [playerA._id, playerB._id] } });

  console.log('\n========================================================');
  console.log('   ALL 8 BENCH & UMBRELLA SEATING TESTS PASSED (100%)   ');
  console.log('========================================================\n');

  await disconnectDB();
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
