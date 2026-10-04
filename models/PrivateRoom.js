const mongoose = require('mongoose');
const {
  PRIVATE_ROOM_TYPES,
  PRIVATE_ROOM_PRIVACY,
  PRIVATE_ROOM_STATUS
} = require('../config/privateRoomConfig');

const privateRoomSchema = new mongoose.Schema(
  {
    roomCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60
    },
    type: {
      type: String,
      enum: Object.values(PRIVATE_ROOM_TYPES),
      default: PRIVATE_ROOM_TYPES.COUPLE,
      index: true
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    maxPlayers: {
      type: Number,
      required: true,
      min: 1,
      max: 6
    },
    privacy: {
      type: String,
      enum: Object.values(PRIVATE_ROOM_PRIVACY),
      default: PRIVATE_ROOM_PRIVACY.INVITE_ONLY,
      index: true
    },
    status: {
      type: String,
      enum: Object.values(PRIVATE_ROOM_STATUS),
      default: PRIVATE_ROOM_STATUS.ACTIVE,
      index: true
    },
    theme: {
      type: String,
      default: 'DEFAULT'
    },
    state: {
      theme: { type: String, default: 'DEFAULT' },
      furniture: { type: Array, default: [] },
      decorations: { type: Array, default: [] },
      layout: { type: String, default: 'DEFAULT' }
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('PrivateRoom', privateRoomSchema);
