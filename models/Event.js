const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: true
    },
    date: {
      type: String,
      required: true,
      default: 'Friday, Oct 9'
    },
    time: {
      type: String,
      required: true,
      default: '8:00 PM'
    },
    location: {
      type: String,
      required: true,
      default: 'Campus Arcade & Lounge'
    },
    virtualArea: {
      type: String,
      enum: ['main-plaza', 'cafe', 'game-zone', 'event-area', 'club-house'],
      default: 'event-area'
    },
    zoneId: {
      type: String,
      default: 'event-area'
    },
    zoneName: {
      type: String,
      default: 'Event Area'
    },
    image: {
      type: String,
      default: ''
    },
    category: {
      type: String,
      default: 'social'
    },
    status: {
      type: String,
      enum: ['upcoming', 'active', 'completed', 'cancelled'],
      default: 'upcoming'
    },
    club: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Club'
    },
    hostName: {
      type: String,
      default: 'The Quad Campus Guild'
    },
    participants: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    attendeeIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    attendeesCount: {
      type: Number,
      default: 0
    },
    accentColor: {
      type: String,
      default: '#E85D75'
    },
    startTime: {
      type: Date,
      default: () => new Date(Date.now() + 2 * 60 * 60 * 1000)
    }
  },
  {
    timestamps: true
  }
);

// Keep participants and attendeeIds in sync
eventSchema.pre('save', function (next) {
  if (this.participants && (!this.attendeeIds || this.attendeeIds.length !== this.participants.length)) {
    this.attendeeIds = this.participants;
  }
  if (this.participants) {
    this.attendeesCount = this.participants.length;
  }
  if (this.virtualArea) {
    this.zoneId = this.virtualArea;
  }
  next();
});

module.exports = mongoose.model('Event', eventSchema);
