/**
 * DateeHomesLobbyCollision.js (Backend Node.js CommonJS Module)
 * Authoritative Lobby Collision Map for Server-Side Movement Validation.
 * Exactly mirrors frontend DateeHomesLobbyCollision.js.
 */

const LOBBY_CONFIG = {
  WIDTH: 1200,
  HEIGHT: 800,
  BOUNDS: {
    minX: 140,
    maxX: 1060,
    minY: 170,
    maxY: 660
  }
};

const LOBBY_COLLIDERS = [
  // Stations
  { id: 'station_create', minX: 376, maxX: 484, minY: 256, maxY: 302 },
  { id: 'station_join', minX: 550, maxX: 650, minY: 256, maxY: 302 },
  { id: 'station_my_rooms', minX: 720, maxX: 820, minY: 256, maxY: 302 },

  // Fireplace
  { id: 'fireplace', minX: 866, maxX: 974, minY: 195, maxY: 268 },

  // Lounge A
  { id: 'sofa_a', minX: 258, maxX: 382, minY: 405, maxY: 442 },
  { id: 'armchair_a1', minX: 184, maxX: 232, minY: 395, maxY: 438 },
  { id: 'table_a', minX: 278, maxX: 362, minY: 476, maxY: 504 },
  { id: 'plant_a', minX: 144, maxX: 166, minY: 342, maxY: 362 },

  // Lounge B
  { id: 'sofa_b', minX: 818, maxX: 922, minY: 405, maxY: 442 },
  { id: 'armchair_b1', minX: 754, maxX: 802, minY: 395, maxY: 438 },
  { id: 'armchair_b2', minX: 984, maxX: 1032, minY: 395, maxY: 438 },
  { id: 'table_b', minX: 828, maxX: 912, minY: 476, maxY: 504 },

  // Hearth Nook
  { id: 'hearth_armchair', minX: 988, maxX: 1036, minY: 260, maxY: 302 },

  // Lounge C
  { id: 'sofa_c', minX: 258, maxX: 382, minY: 550, maxY: 586 },
  { id: 'armchair_c1', minX: 184, maxX: 232, minY: 545, maxY: 588 },
  { id: 'table_c', minX: 278, maxX: 362, minY: 606, maxY: 634 },
  { id: 'plant_c', minX: 144, maxX: 166, minY: 602, maxY: 622 },

  // Lounge D
  { id: 'sofa_d', minX: 818, maxX: 922, minY: 550, maxY: 586 },
  { id: 'armchair_d1', minX: 754, maxX: 802, minY: 545, maxY: 588 },
  { id: 'armchair_d2', minX: 984, maxX: 1032, minY: 545, maxY: 588 },
  { id: 'table_d', minX: 844, maxX: 906, minY: 606, maxY: 634 },
  { id: 'plant_d', minX: 1034, maxX: 1056, minY: 602, maxY: 622 }
];

function checkLobbyCollision(x, y, radius = 9) {
  if (
    x - radius < LOBBY_CONFIG.BOUNDS.minX ||
    x + radius > LOBBY_CONFIG.BOUNDS.maxX ||
    y - radius < LOBBY_CONFIG.BOUNDS.minY ||
    y + radius > LOBBY_CONFIG.BOUNDS.maxY
  ) {
    return true;
  }

  for (let i = 0; i < LOBBY_COLLIDERS.length; i++) {
    const c = LOBBY_COLLIDERS[i];
    if (
      x + radius > c.minX &&
      x - radius < c.maxX &&
      y + radius > c.minY &&
      y - radius < c.maxY
    ) {
      return true;
    }
  }

  return false;
}

function resolveLobbyMovement(currX, currY, targetX, targetY, radius = 9) {
  let nextX = Math.max(
    LOBBY_CONFIG.BOUNDS.minX + radius,
    Math.min(LOBBY_CONFIG.BOUNDS.maxX - radius, targetX)
  );
  let nextY = Math.max(
    LOBBY_CONFIG.BOUNDS.minY + radius,
    Math.min(LOBBY_CONFIG.BOUNDS.maxY - radius, targetY)
  );

  const currColliding = checkLobbyCollision(currX, currY, radius);
  if (currColliding) {
    if (!checkLobbyCollision(nextX, nextY, radius)) {
      return { x: nextX, y: nextY, collided: false };
    }
    if (!checkLobbyCollision(nextX, currY, radius)) {
      return { x: nextX, y: currY, collided: true };
    }
    if (!checkLobbyCollision(currX, nextY, radius)) {
      return { x: currX, y: nextY, collided: true };
    }
    return { x: nextX, y: nextY, collided: true };
  }

  let collided = false;

  if (checkLobbyCollision(nextX, currY, radius)) {
    collided = true;
    nextX = currX;
  }

  if (checkLobbyCollision(nextX, nextY, radius)) {
    collided = true;
    nextY = currY;
  }

  return { x: nextX, y: nextY, collided };
}

const LOBBY_SEATING_ZONES = [
  // --- LOUNGE A (3-seat sofa + 1 armchair) ---
  {
    seatId: 'lounge_a_sofa_1',
    seatKey: 'S1',
    groupId: 'lounge_a_sofa',
    zone: 'Lounge A',
    name: 'Lounge A Sofa (Left)',
    anchorX: 285,
    anchorY: 440,
    standX: 285,
    standY: 459,
    facing: 'down',
    radius: 38
  },
  {
    seatId: 'lounge_a_sofa_2',
    seatKey: 'S2',
    groupId: 'lounge_a_sofa',
    zone: 'Lounge A',
    name: 'Lounge A Sofa (Center)',
    anchorX: 320,
    anchorY: 440,
    standX: 320,
    standY: 459,
    facing: 'down',
    radius: 38
  },
  {
    seatId: 'lounge_a_sofa_3',
    seatKey: 'S3',
    groupId: 'lounge_a_sofa',
    zone: 'Lounge A',
    name: 'Lounge A Sofa (Right)',
    anchorX: 355,
    anchorY: 440,
    standX: 355,
    standY: 459,
    facing: 'down',
    radius: 38
  },
  {
    seatId: 'lounge_a_chair',
    seatKey: 'C1',
    groupId: 'lounge_a_chair',
    zone: 'Lounge A',
    name: 'Lounge A Armchair',
    anchorX: 208,
    anchorY: 418,
    standX: 208,
    standY: 458,
    facing: 'right',
    radius: 38
  },

  // --- LOUNGE B (2-seat sofa + 2 armchairs) ---
  {
    seatId: 'lounge_b_sofa_1',
    seatKey: 'S1',
    groupId: 'lounge_b_sofa',
    zone: 'Lounge B',
    name: 'Lounge B Sofa (Left)',
    anchorX: 845,
    anchorY: 440,
    standX: 845,
    standY: 459,
    facing: 'down',
    radius: 38
  },
  {
    seatId: 'lounge_b_sofa_2',
    seatKey: 'S2',
    groupId: 'lounge_b_sofa',
    zone: 'Lounge B',
    name: 'Lounge B Sofa (Right)',
    anchorX: 895,
    anchorY: 440,
    standX: 895,
    standY: 459,
    facing: 'down',
    radius: 38
  },
  {
    seatId: 'lounge_b_chair_1',
    seatKey: 'C1',
    groupId: 'lounge_b_chair_w',
    zone: 'Lounge B',
    name: 'Lounge B West Chair',
    anchorX: 778,
    anchorY: 418,
    standX: 730,
    standY: 418,
    facing: 'right',
    radius: 38
  },
  {
    seatId: 'lounge_b_chair_2',
    seatKey: 'C2',
    groupId: 'lounge_b_chair_e',
    zone: 'Lounge B',
    name: 'Lounge B East Chair',
    anchorX: 1008,
    anchorY: 418,
    standX: 1008,
    standY: 458,
    facing: 'left',
    radius: 38
  },

  // --- HEARTH NOOK (Fireside armchair) ---
  {
    seatId: 'hearth_chair',
    seatKey: 'H1',
    groupId: 'hearth_chair',
    zone: 'Hearth',
    name: 'Fireside Armchair',
    anchorX: 1012,
    anchorY: 282,
    standX: 1012,
    standY: 330,
    facing: 'left',
    radius: 38
  },

  // --- LOUNGE C (3-seat sofa + 1 armchair) ---
  {
    seatId: 'lounge_c_sofa_1',
    seatKey: 'S1',
    groupId: 'lounge_c_sofa',
    zone: 'Lounge C',
    name: 'Lounge C Sofa (Left)',
    anchorX: 285,
    anchorY: 575,
    standX: 285,
    standY: 528,
    facing: 'down',
    radius: 38
  },
  {
    seatId: 'lounge_c_sofa_2',
    seatKey: 'S2',
    groupId: 'lounge_c_sofa',
    zone: 'Lounge C',
    name: 'Lounge C Sofa (Center)',
    anchorX: 320,
    anchorY: 575,
    standX: 320,
    standY: 528,
    facing: 'down',
    radius: 38
  },
  {
    seatId: 'lounge_c_sofa_3',
    seatKey: 'S3',
    groupId: 'lounge_c_sofa',
    zone: 'Lounge C',
    name: 'Lounge C Sofa (Right)',
    anchorX: 355,
    anchorY: 575,
    standX: 355,
    standY: 528,
    facing: 'down',
    radius: 38
  },
  {
    seatId: 'lounge_c_chair',
    seatKey: 'C1',
    groupId: 'lounge_c_chair',
    zone: 'Lounge C',
    name: 'Lounge C Armchair',
    anchorX: 208,
    anchorY: 568,
    standX: 208,
    standY: 522,
    facing: 'right',
    radius: 38
  },

  // --- LOUNGE D (2-seat sofa + 2 club chairs) ---
  {
    seatId: 'lounge_d_sofa_1',
    seatKey: 'S1',
    groupId: 'lounge_d_sofa',
    zone: 'Lounge D',
    name: 'Lounge D Sofa (Left)',
    anchorX: 845,
    anchorY: 575,
    standX: 845,
    standY: 528,
    facing: 'down',
    radius: 38
  },
  {
    seatId: 'lounge_d_sofa_2',
    seatKey: 'S2',
    groupId: 'lounge_d_sofa',
    zone: 'Lounge D',
    name: 'Lounge D Sofa (Right)',
    anchorX: 895,
    anchorY: 575,
    standX: 895,
    standY: 528,
    facing: 'down',
    radius: 38
  },
  {
    seatId: 'lounge_d_chair_1',
    seatKey: 'C1',
    groupId: 'lounge_d_chair_w',
    zone: 'Lounge D',
    name: 'Lounge D West Chair',
    anchorX: 778,
    anchorY: 568,
    standX: 730,
    standY: 568,
    facing: 'right',
    radius: 38
  },
  {
    seatId: 'lounge_d_chair_2',
    seatKey: 'C2',
    groupId: 'lounge_d_chair_e',
    zone: 'Lounge D',
    name: 'Lounge D East Chair',
    anchorX: 1008,
    anchorY: 568,
    standX: 1008,
    standY: 522,
    facing: 'left',
    radius: 38
  }
];

module.exports = {
  LOBBY_CONFIG,
  LOBBY_COLLIDERS,
  LOBBY_SEATING_ZONES,
  checkLobbyCollision,
  resolveLobbyMovement
};

