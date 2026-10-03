const mongoose = require('mongoose');

const FRIENDSHIP_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'REMOVED', 'BLOCKED'];

const friendshipSchema = new mongoose.Schema(
  {
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: FRIENDSHIP_STATUSES,
      default: 'PENDING',
      required: true,
      index: true
    },
    actionUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },
    message: {
      type: String,
      trim: true,
      maxlength: [280, 'Friend request message cannot exceed 280 characters'],
      default: ''
    },
    // Timestamps corresponding to life cycle events
    accepted_at: {
      type: Date,
      default: null
    },
    declined_at: {
      type: Date,
      default: null
    },
    cancelled_at: {
      type: Date,
      default: null
    },
    removed_at: {
      type: Date,
      default: null
    },
    blocked_at: {
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

// Virtual aliases for camelCase compatibility
friendshipSchema.virtual('createdAt').get(function () {
  return this.created_at;
});
friendshipSchema.virtual('updatedAt').get(function () {
  return this.updated_at;
});
friendshipSchema.virtual('acceptedAt').get(function () {
  return this.accepted_at;
});
friendshipSchema.virtual('declinedAt').get(function () {
  return this.declined_at;
});
friendshipSchema.virtual('cancelledAt').get(function () {
  return this.cancelled_at;
});
friendshipSchema.virtual('removedAt').get(function () {
  return this.removed_at;
});
friendshipSchema.virtual('blockedAt').get(function () {
  return this.blocked_at;
});

// Compound indexing for fast query resolution
friendshipSchema.index({ requester: 1, recipient: 1 });
friendshipSchema.index({ recipient: 1, requester: 1 });
friendshipSchema.index({ requester: 1, status: 1 });
friendshipSchema.index({ recipient: 1, status: 1 });

module.exports = mongoose.model('Friendship', friendshipSchema);
module.exports.FRIENDSHIP_STATUSES = FRIENDSHIP_STATUSES;
