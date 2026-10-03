const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    type: {
      type: String,
      enum: [
        'connection_request',
        'connection_accepted',
        'friend_request',
        'friend_accepted',
        'new_message',
        'event_invitation',
        'club_activity',
        'system'
      ],
      required: true
    },
    title: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    data: {
      connectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Connection' },
      friendshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Friendship' },
      eventId: { type: String },
      clubId: { type: String },
      actionUrl: { type: String }
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Notification', notificationSchema);
