const mongoose = require('mongoose');

const campusAreaSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['open', 'restricted', 'maintenance', 'event_exclusive'],
    default: 'open'
  },
  capacity: {
    type: Number,
    default: 100
  },
  description: {
    type: String,
    default: ''
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  ambientTrack: {
    type: String,
    default: 'Lofi Campus Quad'
  },
  announcement: {
    type: String,
    default: ''
  }
});

const platformSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'default_config',
      unique: true
    },
    // Campus Area Management
    campusAreas: {
      type: [campusAreaSchema],
      default: [
        {
          id: 'main-plaza',
          name: 'Main Plaza',
          status: 'open',
          capacity: 150,
          description: 'The vibrant heart of campus life where students gather, socialize, and relax under the trees.',
          isFeatured: true,
          ambientTrack: 'Sunlit Quad Fountain Lofi',
          announcement: 'Welcome to The Quad! Meet new friends near the center stone fountain.'
        },
        {
          id: 'cafe',
          name: 'Café & Lounge',
          status: 'open',
          capacity: 80,
          description: 'Warm espresso bar and cozy booth seating designed for intimate, late-afternoon conversations.',
          isFeatured: false,
          ambientTrack: 'Warm Espresso & Vinyl Jazz',
          announcement: 'Fresh brew special today: Cold Brew Vanilla Sweet Cream.'
        },
        {
          id: 'game-zone',
          name: 'Game Zone',
          status: 'open',
          capacity: 90,
          description: 'Retro arcade cabinets, table mini-games, and friendly multiplayer challenges.',
          isFeatured: true,
          ambientTrack: '8-Bit Synth Beats & Arcade Echoes',
          announcement: 'Tic-Tac-Toe & Trivia open for friendly matches!'
        },
        {
          id: 'event-area',
          name: 'Event Amphitheater',
          status: 'open',
          capacity: 250,
          description: 'Open-air collegiate amphitheater hosting live music, discussions, and campus mixers.',
          isFeatured: false,
          ambientTrack: 'Acoustic Soundstage Ambient',
          announcement: 'Next campus meetup scheduled for Friday 8:00 PM.'
        },
        {
          id: 'club-house',
          name: 'Club House',
          status: 'open',
          capacity: 120,
          description: 'Special interest guild halls, creative studio spaces, and student organization rooms.',
          isFeatured: false,
          ambientTrack: 'Creative Studio Downtempo',
          announcement: 'Join any of our 9 student societies to earn unique participation XP.'
        }
      ]
    },
    // Platform Safety & Rules
    minAgeRequirement: {
      type: Number,
      default: 18
    },
    maintenanceMode: {
      type: Boolean,
      default: false
    },
    maintenanceMessage: {
      type: String,
      default: 'The Quad is undergoing scheduled campus maintenance. Check back shortly!'
    },
    registrationStatus: {
      type: String,
      enum: ['open', 'invite_only', 'paused'],
      default: 'open'
    },
    maxCampusCapacity: {
      type: Number,
      default: 1000
    },
    allowDirectWhispers: {
      type: Boolean,
      default: true
    },
    contentAutoFilter: {
      type: Boolean,
      default: true
    },
    flaggedKeywords: {
      type: [String],
      default: ['spam', 'venmo', 'cashapp', 'telegram', 'crypto', 'whatsapp', 'onlyfans']
    },
    // Subscriptions Config
    subscriptionTiers: {
      type: Array,
      default: [
        {
          id: 'free',
          name: 'Free Campus Pass',
          priceMonthly: 0,
          features: [
            'Full 3D Campus access',
            'Connect & chat with mutual matches',
            'Access all 9 student clubs & events',
            'Standard cartoon avatar customizer'
          ]
        },
        {
          id: 'premium_rose',
          name: 'Quad Rose VIP',
          priceMonthly: 14.99,
          features: [
            'All Free features',
            'Exclusive golden and rose avatar accessories',
            'Priority campus placement and glowing nameplate',
            'Unlimited mini-game challenge invites',
            'Read receipts & extended profile visitors'
          ]
        }
      ]
    }
  },
  {
    timestamps: true
  }
);

// Helper to get or create singleton platform configuration
platformSettingSchema.statics.getOrCreateDefault = async function () {
  let settings = await this.findOne({ key: 'default_config' });
  if (!settings) {
    settings = await this.create({ key: 'default_config' });
  }
  return settings;
};

module.exports = mongoose.model('PlatformSetting', platformSettingSchema);
