const mongoose = require('mongoose');

const connectionSchema = new mongoose.Schema(
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
      enum: ['pending', 'accepted', 'declined', 'passed', 'cancelled'],
      default: 'pending',
      index: true
    },
    connectionOrigin: {
      type: String,
      enum: ['discovery_feed', 'virtual_campus', 'event', 'club'],
      default: 'discovery_feed'
    },
    campusZone: {
      type: String,
      default: 'central-quad'
    },
    declinedAt: {
      type: Date,
      default: null
    },
    cooldownUntil: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Prevent duplicate connections between same pair
connectionSchema.index({ requester: 1, recipient: 1 }, { unique: true });

module.exports = mongoose.model('Connection', connectionSchema);
