/**
 * The Quad - Platform Constants and Enums
 */

const ROLES = {
  USER: 'USER',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN'
};

const SUBSCRIPTION_STATUS = {
  FREE: 'free',
  PLUS: 'plus',
  VIP: 'vip'
};

const RELATIONSHIP_INTENTS = [
  'dating',
  'long_term',
  'casual',
  'study_buddy',
  'campus_friends',
  'open_to_anything'
];

const GENDERS = [
  'male',
  'female',
  'non-binary',
  'other',
  'prefer_not_to_say'
];

const ONLINE_STATUS = {
  ONLINE: 'online',
  AWAY: 'away',
  OFFLINE: 'offline'
};

const CAMPUS_ZONES = [
  {
    id: 'central-quad',
    name: 'Central Quad & Fountain Lawn',
    description: 'The vibrant heart of the campus. Open lawns, central fountain, and live meetups.',
    accentColor: '#6366f1',
    maxCapacity: 200
  },
  {
    id: 'study-commons',
    name: 'Campus Study Commons',
    description: 'Cozy ambient lighting, lo-fi beats, and quiet intellectual connection.',
    accentColor: '#10b981',
    maxCapacity: 100
  },
  {
    id: 'sunset-lounge',
    name: 'Sunset Lounge & 1-on-1 Booths',
    description: 'Cocktails, warm twilight sky, and intimate 1-on-1 conversations.',
    accentColor: '#f59e0b',
    maxCapacity: 80
  },
  {
    id: 'event-hall',
    name: 'Event Amphitheater & Stage',
    description: 'Under the night sky, live music, open mic, and spontaneous sparks.',
    accentColor: '#8b5cf6',
    maxCapacity: 150
  }
];

module.exports = {
  ROLES,
  SUBSCRIPTION_STATUS,
  RELATIONSHIP_INTENTS,
  GENDERS,
  ONLINE_STATUS,
  CAMPUS_ZONES
};
