const mongoose = require('mongoose');

const clubSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    icon: {
      type: String,
      default: '👥'
    },
    tagline: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    category: {
      type: String,
      enum: ['gaming', 'music', 'art', 'technology', 'books', 'travel', 'fitness', 'movies', 'cooking', 'other'],
      default: 'gaming'
    },
    virtualArea: {
      type: String,
      enum: ['main-plaza', 'cafe', 'game-zone', 'event-area', 'club-house'],
      default: 'club-house'
    },
    zoneAffiliation: {
      type: String,
      default: 'club-house'
    },
    accentColor: {
      type: String,
      default: '#E85D75'
    },
    image: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active'
    },
    memberCount: {
      type: Number,
      default: 0
    },
    members: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    memberIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  {
    timestamps: true
  }
);

// Keep memberIds in sync with members
clubSchema.pre('save', function (next) {
  if (this.members && (!this.memberIds || this.memberIds.length !== this.members.length)) {
    this.memberIds = this.members;
  }
  if (this.members) {
    this.memberCount = this.members.length;
  }
  next();
});

module.exports = mongoose.model('Club', clubSchema);
