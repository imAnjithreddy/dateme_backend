/**
 * seatingManager.js
 * Server-side authoritative seating and interaction context manager.
 *
 * CHUNK 12 REQUIREMENT:
 * - A voice session can only be created when both users are currently in an allowed shared interaction context.
 * - Allowed context: Both players are sitting together on the same valid two-person seat/interaction point (bench or umbrella table).
 * - The server MUST verify these conditions itself and NEVER trust frontend flags.
 * - Do NOT allow arbitrary sitting on the ground or arbitrary strangers to create voice sessions.
 * - Do NOT allow players to occupy the same seat.
 */

// userId -> { seatId, objectId, seatKey, socketId, seatedAt }
const userSeats = new Map();

// seatId -> userId
const seatUsers = new Map();

/**
 * Validate and parse a two-person seat ID into its parent interaction object and seat key.
 *
 * Valid examples:
 * - bench_001_seat_A / bench_001_seat_B
 * - umbrella_014_seat_A / umbrella_014_seat_B
 * - f_bench_01_seat_A / f_bench_01_seat_B
 * - love-bench-1_seat_A / love-bench-1_seat_B
 */
const parseSeatId = (seatId) => {
  if (!seatId || typeof seatId !== 'string') return null;

  const trimmed = seatId.trim();
  const match = trimmed.match(/^(.*)_(seat_[A-Za-z0-9]+)$/);
  if (!match) return null;

  const objectId = match[1];
  const seatKey = match[2].toLowerCase();

  return {
    objectId,
    seatKey
  };
};

/**
 * Authoritatively record that a user is seated in a specific seat.
 */
const occupySeat = (userId, seatId, socketId = null) => {
  if (!userId || !seatId) {
    return { success: false, error: 'User ID and Seat ID are required.' };
  }

  const userIdStr = userId.toString();
  const parsed = parseSeatId(seatId);

  if (!parsed) {
    return {
      success: false,
      error: `Invalid seat ID format: "${seatId}". Must belong to a valid sittable object (e.g. bench_001_seat_A).`
    };
  }

  // Check if seat is already occupied by a different player
  const currentOccupant = seatUsers.get(seatId);
  if (currentOccupant && currentOccupant !== userIdStr) {
    return {
      success: false,
      error: `Seat ${seatId} is already occupied by another student.`
    };
  }

  // Vacate any existing seat occupied by this user
  vacateUser(userIdStr);

  const record = {
    userId: userIdStr,
    seatId,
    objectId: parsed.objectId,
    seatKey: parsed.seatKey,
    socketId: socketId || null,
    seatedAt: Date.now()
  };

  userSeats.set(userIdStr, record);
  seatUsers.set(seatId, userIdStr);

  return { success: true, seat: record };
};

/**
 * Vacate a specific seat for a user.
 */
const vacateSeat = (userId, seatId = null) => {
  if (!userId) return;
  const userIdStr = userId.toString();
  const existing = userSeats.get(userIdStr);

  if (existing) {
    seatUsers.delete(existing.seatId);
    userSeats.delete(userIdStr);
  }

  if (seatId) {
    const occupant = seatUsers.get(seatId);
    if (occupant === userIdStr) {
      seatUsers.delete(seatId);
    }
  }
};

/**
 * Vacate any seat occupied by a user (e.g. on disconnect or standing up).
 */
const vacateUser = (userId) => {
  if (!userId) return;
  const userIdStr = userId.toString();
  const existing = userSeats.get(userIdStr);
  if (existing) {
    seatUsers.delete(existing.seatId);
    userSeats.delete(userIdStr);
  }
};

/**
 * Get current seat record for a user.
 */
const getPlayerSeat = (userId) => {
  if (!userId) return null;
  return userSeats.get(userId.toString()) || null;
};

/**
 * Authoritatively verify whether two users are currently sitting together
 * on the exact same valid two-person bench or umbrella table.
 *
 * Conditions:
 * 1. Both users have active seats tracked by the server.
 * 2. Neither user is sitting on the ground or standing.
 * 3. Both seats belong to the exact same parent interaction object (objectIdA === objectIdB).
 * 4. The users do NOT occupy the exact same seat (seatA !== seatB).
 */
const areCoSeated = (userIdA, userIdB) => {
  if (!userIdA || !userIdB) {
    return { coSeated: false, reason: 'Both user IDs are required.' };
  }

  const idA = userIdA.toString();
  const idB = userIdB.toString();

  if (idA === idB) {
    return { coSeated: false, reason: 'Cannot co-seat with oneself.' };
  }

  const seatA = getPlayerSeat(idA);
  const seatB = getPlayerSeat(idB);

  if (!seatA) {
    return { coSeated: false, reason: 'Calling player is not seated on a valid bench or table.' };
  }

  if (!seatB) {
    return { coSeated: false, reason: 'Target friend is not seated on a valid bench or table.' };
  }

  // Do NOT allow players to occupy the same seat
  if (seatA.seatId === seatB.seatId) {
    return { coSeated: false, reason: 'Invalid seating: both players cannot occupy the same seat.' };
  }

  // Must belong to the exact same valid two-person interaction point (bench or couple umbrella table)
  if (seatA.objectId !== seatB.objectId) {
    return {
      coSeated: false,
      reason: `Players are seated on different objects (${seatA.objectId} vs ${seatB.objectId}). Voice requires sitting together.`
    };
  }

  return {
    coSeated: true,
    objectId: seatA.objectId,
    seatA: seatA.seatId,
    seatB: seatB.seatId
  };
};

/**
 * Find the co-seated partner for a given user on the same bench or umbrella table.
 * Returns { partnerUserId, userSeat, partnerSeat, objectId } if another user is seated on the same object.
 */
const getCoSeatedPartner = (userId) => {
  if (!userId) return null;
  const userSeat = getPlayerSeat(userId);
  if (!userSeat) return null;

  for (const [otherUserId, otherSeat] of userSeats) {
    if (
      otherUserId !== userId.toString() &&
      otherSeat.objectId === userSeat.objectId &&
      otherSeat.seatId !== userSeat.seatId
    ) {
      return {
        partnerUserId: otherUserId,
        userSeat,
        partnerSeat: otherSeat,
        objectId: userSeat.objectId
      };
    }
  }

  return null;
};

/**
 * Reset all seating data (useful for test suites)
 */
const resetSeating = () => {
  userSeats.clear();
  seatUsers.clear();
};

module.exports = {
  parseSeatId,
  occupySeat,
  vacateSeat,
  vacateUser,
  getPlayerSeat,
  areCoSeated,
  getCoSeatedPartner,
  resetSeating
};
