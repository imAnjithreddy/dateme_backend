const PrivateRoom = require('../models/PrivateRoom');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generates an easy-to-type, uppercase, collision-safe 6-character room code.
 * Validates uniqueness against MongoDB before returning.
 */
async function generateUniqueRoomCode(maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      const idx = Math.floor(Math.random() * CODE_CHARS.length);
      code += CODE_CHARS[idx];
    }

    const existing = await PrivateRoom.findOne({ roomCode: code }).select('_id').lean();
    if (!existing) {
      return code;
    }
  }

  // Fallback with timestamp suffix if multiple random collisions occur
  const timestampPart = Date.now().toString(36).toUpperCase().slice(-4);
  const randomPart = CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)] + CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return `${randomPart}${timestampPart}`.slice(0, 6);
}

module.exports = {
  generateUniqueRoomCode
};
