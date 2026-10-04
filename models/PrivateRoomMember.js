const mongoose = require('mongoose');
const { PRIVATE_ROOM_ROLES } = require('../config/privateRoomConfig');

const privateRoomMemberSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PrivateRoom',
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    role: {
      type: String,
      enum: Object.values(PRIVATE_ROOM_ROLES),
      default: PRIVATE_ROOM_ROLES.MEMBER
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Prevent duplicate membership records for the same user in a room
privateRoomMemberSchema.index({ roomId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('PrivateRoomMember', privateRoomMemberSchema);
