/**
 * Centralized Private Room Configuration (Shared between Backend & Frontend)
 * Datee Homes Private Residences
 */

const PRIVATE_ROOM_TYPES = {
  COUPLE: 'COUPLE',
  FRIENDS: 'FRIENDS'
};

const PRIVATE_ROOM_PRIVACY = {
  INVITE_ONLY: 'INVITE_ONLY',
  PUBLIC: 'PUBLIC'
};

const PRIVATE_ROOM_STATUS = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
  DELETED: 'DELETED'
};

const PRIVATE_ROOM_ROLES = {
  OWNER: 'OWNER',
  MEMBER: 'MEMBER'
};

const INVITATION_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED'
};

const ROOM_TYPE_CONFIGS = {
  COUPLE: {
    id: 'COUPLE',
    type: 'COUPLE',
    name: 'Couple Suite',
    icon: '💕',
    defaultName: 'Our Romantic Suite',
    maxPlayers: 2,
    badgeColor: 'bg-rose-100 text-rose-700 border-rose-200',
    description: 'Intimate private sanctuary for 2 with couple seating and romantic ambiance'
  },
  FRIENDS: {
    id: 'FRIENDS',
    type: 'FRIENDS',
    name: 'Friends Lounge',
    icon: '👥',
    defaultName: 'Chai & Chill Hangout',
    maxPlayers: 6,
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
    description: 'Relaxed hangout for up to 6 friends to chat, play games, and connect'
  }
};

const MAX_ROOMS_PER_USER_PER_WEEK = 3;
const WEEKLY_LIMIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = {
  PRIVATE_ROOM_TYPES,
  PRIVATE_ROOM_PRIVACY,
  PRIVATE_ROOM_STATUS,
  PRIVATE_ROOM_ROLES,
  INVITATION_STATUS,
  ROOM_TYPE_CONFIGS,
  MAX_ROOMS_PER_USER_PER_WEEK,
  WEEKLY_LIMIT_WINDOW_MS
};
