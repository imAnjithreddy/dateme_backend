const mongoose = require('mongoose');

const directMessageSchema = new mongoose.Schema(
  {
    conversation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true
    },
    sender_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    receiver_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    content: {
      type: String,
      required: [true, 'Message content is required'],
      trim: true,
      maxlength: [4000, 'Message cannot exceed 4000 characters']
    },
    read_at: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

directMessageSchema.virtual('message_id').get(function () {
  return this._id ? this._id.toString() : null;
});

// Fast chronological sorting and indexing per conversation
directMessageSchema.index({ conversation_id: 1, created_at: 1 });
directMessageSchema.index({ receiver_id: 1, read_at: 1 });

module.exports = mongoose.model('DirectMessage', directMessageSchema);
