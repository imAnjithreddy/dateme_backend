const {
  getUserGamificationSummary,
  awardParticipationXp,
  BADGES,
  LEVELS
} = require('../services/gamificationService');
const { successResponse, errorResponse } = require('../utils/apiResponse');

/**
 * Get current authenticated user's gamification status (level, XP, badges)
 * GET /api/gamification/summary
 */
const getMyGamificationSummary = async (req, res, next) => {
  try {
    const summary = await getUserGamificationSummary(req.user._id);
    return successResponse(res, { summary }, 'Gamification summary retrieved.');
  } catch (error) {
    next(error);
  }
};

/**
 * Get full badges catalog
 * GET /api/gamification/badges
 */
const getBadgesCatalog = async (req, res, next) => {
  try {
    const userBadges = Array.isArray(req.user.badges) ? req.user.badges : [];
    const catalog = BADGES.map((b) => ({
      ...b,
      isUnlocked: userBadges.includes(b.name) || userBadges.includes(b.id)
    }));

    return successResponse(res, { badges: catalog, levels: LEVELS }, 'Badges catalog retrieved.');
  } catch (error) {
    next(error);
  }
};

/**
 * Claim an eligible participation action (e.g. campus exploration, onboarding)
 * POST /api/gamification/action
 */
const claimAction = async (req, res, next) => {
  try {
    const { actionType, zoneId } = req.body;

    const VALID_ACTIONS = {
      explore_campus: {
        key: `explore_campus_${zoneId || 'plaza'}`,
        xp: 40,
        badgeId: 'campus_explorer',
        isRepeatable: false
      },
      complete_onboarding: {
        key: 'onboarding_completed',
        xp: 80,
        badgeId: 'first_step',
        isRepeatable: false
      }
    };

    const actionConfig = VALID_ACTIONS[actionType];
    if (!actionConfig) {
      return errorResponse(res, 'Invalid or unsupported gamification action.', 400);
    }

    const result = await awardParticipationXp(
      req.user._id,
      actionConfig.key,
      actionConfig.xp,
      {
        badgeId: actionConfig.badgeId,
        isRepeatable: actionConfig.isRepeatable
      }
    );

    if (!result?.awarded) {
      return successResponse(
        res,
        { alreadyClaimed: true },
        'Action has already been claimed.'
      );
    }

    return successResponse(
      res,
      result,
      `Action rewarded! +${result.xpGained} XP awarded.`
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get public gamification preview for another user (for profile display)
 * GET /api/gamification/user/:id
 */
const getUserGamification = async (req, res, next) => {
  try {
    const summary = await getUserGamificationSummary(req.params.id);
    if (!summary) {
      return errorResponse(res, 'User not found.', 404);
    }
    return successResponse(res, { summary }, 'User gamification retrieved.');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMyGamificationSummary,
  getBadgesCatalog,
  claimAction,
  getUserGamification
};
