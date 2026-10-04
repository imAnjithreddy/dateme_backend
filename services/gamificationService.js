const User = require('../models/User');
const Notification = require('../models/Notification');
const notificationService = require('./notificationService');

const LEVELS = [
  { level: 1, title: 'Newcomer', minXp: 0, maxXp: 99 },
  { level: 2, title: 'Campus Fresher', minXp: 100, maxXp: 249 },
  { level: 3, title: 'Quad Wanderer', minXp: 250, maxXp: 449 },
  { level: 4, title: 'Socialite', minXp: 450, maxXp: 699 },
  { level: 5, title: 'Social Explorer', minXp: 700, maxXp: 999 },
  { level: 6, title: 'Vibe Curator', minXp: 1000, maxXp: 1399 },
  { level: 7, title: 'Campus Conversationalist', minXp: 1400, maxXp: 1899 },
  { level: 8, title: 'Lounge Insider', minXp: 1900, maxXp: 2499 },
  { level: 9, title: 'Society Keyholder', minXp: 2500, maxXp: 3199 },
  { level: 10, title: 'Campus Regular', minXp: 3200, maxXp: 3999 },
  { level: 15, title: 'Campus Influencer', minXp: 4000, maxXp: 6999 },
  { level: 20, title: 'Community Star', minXp: 7000, maxXp: 99999 }
];

const BADGES = [
  {
    id: 'first_step',
    name: 'First Step',
    icon: '🌱',
    description: 'Completed student onboarding and personal campus profile.',
    category: 'onboarding',
    xpReward: 100
  },
  {
    id: 'event_explorer',
    name: 'Event Explorer',
    icon: '🎉',
    description: 'RSVPed and attended a scheduled campus event or meetup.',
    category: 'events',
    xpReward: 75
  },
  {
    id: 'game_night',
    name: 'Game Night',
    icon: '🎮',
    description: 'Challenged a campus peer to a casual mini-game match.',
    category: 'games',
    xpReward: 60
  },
  {
    id: 'music_lover',
    name: 'Music Lover',
    icon: '🎵',
    description: 'Joined the campus Music Society or attended audio sessions.',
    category: 'clubs',
    xpReward: 50
  },
  {
    id: 'bookworm',
    name: 'Bookworm',
    icon: '📚',
    description: 'Joined the campus Books & Literature Society.',
    category: 'clubs',
    xpReward: 50
  },
  {
    id: 'campus_explorer',
    name: 'Explorer',
    icon: '🌍',
    description: 'Explored different virtual campus zones and lounges.',
    category: 'campus',
    xpReward: 40
  },
  {
    id: 'community_member',
    name: 'Community Member',
    icon: '🤝',
    description: 'Active member participating in student collective discussions.',
    category: 'clubs',
    xpReward: 50
  }
];

// Helper to calculate level details from XP
function calculateLevel(xp) {
  const currentXp = Math.max(0, Number(xp) || 0);
  let currentLevelObj = LEVELS[0];
  let nextLevelObj = LEVELS[1];

  for (let i = 0; i < LEVELS.length; i++) {
    if (currentXp >= LEVELS[i].minXp) {
      currentLevelObj = LEVELS[i];
      nextLevelObj = LEVELS[i + 1] || null;
    } else {
      break;
    }
  }

  const nextLevelXp = nextLevelObj ? nextLevelObj.minXp : currentLevelObj.maxXp;
  const progressBase = nextLevelObj
    ? (currentXp - currentLevelObj.minXp) / (nextLevelObj.minXp - currentLevelObj.minXp)
    : 1;
  const progressPercentage = Math.min(100, Math.max(0, Math.round(progressBase * 100)));

  return {
    level: currentLevelObj.level,
    title: currentLevelObj.title,
    currentXp,
    nextLevelXp,
    progressPercentage,
    nextLevelTitle: nextLevelObj?.title || null
  };
}

/**
 * Award XP and check for badges/level up
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {string} actionKey - Unique action key to prevent duplicate reward where applicable
 * @param {number} defaultXp - Default XP to grant
 * @param {object} options - Options including badgeId, isRepeatable
 */
async function awardParticipationXp(userId, actionKey, defaultXp = 50, options = {}) {
  try {
    const user = await User.findById(userId);
    if (!user) return null;

    const { badgeId, isRepeatable = false, notify = true } = options;

    // Check if one-time action has already been rewarded
    const completedActions = user.completedGamificationActions || [];
    if (!isRepeatable && completedActions.includes(actionKey)) {
      return { awarded: false, reason: 'Action already completed' };
    }

    const previousXp = user.campusXp || user.xp || 0;
    const previousLevelInfo = calculateLevel(previousXp);

    const newXp = previousXp + defaultXp;
    const newLevelInfo = calculateLevel(newXp);

    const newBadgesUnlocked = [];
    const currentBadges = Array.isArray(user.badges) ? user.badges : [];

    // Check if specific badge should be awarded
    if (badgeId) {
      const badgeDef = BADGES.find((b) => b.id === badgeId);
      if (badgeDef && !currentBadges.includes(badgeDef.name) && !currentBadges.includes(badgeDef.id)) {
        currentBadges.push(badgeDef.name);
        newBadgesUnlocked.push(badgeDef);
      }
    }

    // Auto-check badges based on actions
    if (actionKey.startsWith('joined_club_music') || actionKey.startsWith('club_music')) {
      const b = BADGES.find((x) => x.id === 'music_lover');
      if (b && !currentBadges.includes(b.name)) {
        currentBadges.push(b.name);
        newBadgesUnlocked.push(b);
      }
    }

    if (actionKey.startsWith('joined_club_books') || actionKey.startsWith('club_books')) {
      const b = BADGES.find((x) => x.id === 'bookworm');
      if (b && !currentBadges.includes(b.name)) {
        currentBadges.push(b.name);
        newBadgesUnlocked.push(b);
      }
    }

    // Update user record
    if (!completedActions.includes(actionKey)) {
      completedActions.push(actionKey);
    }

    user.campusXp = newXp;
    user.xp = newXp;
    user.level = newLevelInfo.level;
    user.levelTitle = newLevelInfo.title;
    user.badges = currentBadges;
    user.completedGamificationActions = completedActions;

    await user.save();

    // Send notifications if leveled up or unlocked badge
    if (notify) {
      if (newLevelInfo.level > previousLevelInfo.level) {
        await notificationService.createAndEmitNotification({
          recipient: user._id,
          sender: user._id,
          type: 'campus_event',
          title: `Level Up! Level ${newLevelInfo.level} 🎉`,
          message: `Congratulations! You unlocked the "${newLevelInfo.title}" title on campus.`,
          data: { level: newLevelInfo.level, title: newLevelInfo.title, actionUrl: '/profile' }
        }).catch(() => {});
      }

      for (const badge of newBadgesUnlocked) {
        await notificationService.createAndEmitNotification({
          recipient: user._id,
          sender: user._id,
          type: 'campus_event',
          title: `New Badge: ${badge.icon} ${badge.name}`,
          message: badge.description,
          data: { badgeId: badge.id, badgeName: badge.name, actionUrl: '/profile' }
        }).catch(() => {});
      }
    }

    return {
      awarded: true,
      xpGained: defaultXp,
      totalXp: newXp,
      levelInfo: newLevelInfo,
      leveledUp: newLevelInfo.level > previousLevelInfo.level,
      newBadgesUnlocked
    };
  } catch (error) {
    console.error('[GamificationService] awardParticipationXp error:', error);
    return null;
  }
}

/**
 * Get full gamification summary for a user
 */
async function getUserGamificationSummary(userId) {
  const user = await User.findById(userId);
  if (!user) return null;

  const currentXp = user.campusXp || user.xp || 0;
  const levelInfo = calculateLevel(currentXp);
  const userBadges = Array.isArray(user.badges) ? user.badges : [];

  const badgesWithStatus = BADGES.map((b) => ({
    ...b,
    isUnlocked: userBadges.includes(b.name) || userBadges.includes(b.id)
  }));

  return {
    ...levelInfo,
    badges: badgesWithStatus,
    completedActionsCount: (user.completedGamificationActions || []).length
  };
}

module.exports = {
  LEVELS,
  BADGES,
  calculateLevel,
  awardParticipationXp,
  getUserGamificationSummary
};
