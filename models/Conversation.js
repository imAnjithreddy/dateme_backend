const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      }
    ],
    friendship: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Friendship',
      required: true
    },
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DirectMessage',
      default: null
    },
    lastMessageContent: {
      type: String,
      default: ''
    },
    lastMessageSender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    lastMessageAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

conversationSchema.virtual('conversation_id').get(function () {
  return this._id ? this._id.toString() : null;
});

// Fast lookup by participant user IDs
conversationSchema.index({ participants: 1 });
conversationSchema.index({ friendship: 1 }, { unique: true });

module.exports = mongoose.model('Conversation', conversationSchema);
