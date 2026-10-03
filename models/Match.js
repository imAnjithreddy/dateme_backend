const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema(
  {
    users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      }
    ],
    connection: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Connection',
      index: true
    },
    status: {
      type: String,
      enum: ['active', 'unmatched', 'blocked'],
      default: 'active',
      index: true
    },
    lastInteraction: {
      type: Date,
      default: Date.now,
      index: true
    },
    unmatchedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    unmatchedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

// Compound index to quickly find matches between two users
matchSchema.index({ users: 1 });

module.exports = mongoose.model('Match', matchSchema);
