const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    reportedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ['profile', 'message', 'behavior', 'other'],
      default: 'profile',
      index: true
    },
    reason: {
      type: String,
      enum: [
        'harassment',
        'spam',
        'scam',
        'inappropriate_content',
        'fake_profile',
        'other'
      ],
      required: true,
      index: true
    },
    details: {
      type: String,
      maxlength: [1000, 'Details cannot exceed 1000 characters'],
      default: ''
    },
    messageContext: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    status: {
      type: String,
      enum: ['pending', 'investigating', 'reviewed', 'resolved', 'dismissed', 'action_taken'],
      default: 'pending',
      index: true
    },
    adminNotes: {
      type: String,
      default: ''
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

reportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
