const mongoose = require('mongoose');
const { INVITATION_STATUS } = require('../config/privateRoomConfig');

const roomInvitationSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PrivateRoom',
      required: true,
      index: true
    },
    inviterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    inviteeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: Object.values(INVITATION_STATUS),
      default: INVITATION_STATUS.PENDING,
      index: true
    },
    expiresAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

// Optimize query for active invitations between a user and a room
roomInvitationSchema.index({ roomId: 1, inviteeId: 1, status: 1 });

module.exports = mongoose.model('RoomInvitation', roomInvitationSchema);
