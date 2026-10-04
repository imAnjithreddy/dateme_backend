const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { RELATIONSHIP_INTENTS } = require('../config/constants');
const { awardParticipationXp } = require('../services/gamificationService');

/**
 * Complete user onboarding flow
 * POST /api/users/onboarding
 */
const completeOnboarding = async (req, res, next) => {
  try {
    const {
      profilePhoto,
      bio,
      interests,
      hobbies,
      musicPreferences,
      moviePreferences,
      relationshipIntent,
      languages,
      education,
      occupation,
      discoveryPreferences,
      avatar,
      gender
    } = req.body;

    const updates = {
      onboardingCompleted: true
    };

    if (avatar && typeof avatar === 'object') updates.avatar = avatar;
    if (gender && ['male', 'female', 'non-binary', 'prefer_not_to_say'].includes(gender)) {
      updates.gender = gender;
    }

    if (profilePhoto !== undefined) updates.profilePhoto = profilePhoto;
    if (bio !== undefined) updates.bio = String(bio).trim().substring(0, 500);
    if (Array.isArray(interests)) updates.interests = interests.slice(0, 20);
    if (Array.isArray(hobbies)) updates.hobbies = hobbies.slice(0, 20);
    if (Array.isArray(musicPreferences)) updates.musicPreferences = musicPreferences.slice(0, 20);
    if (Array.isArray(moviePreferences)) updates.moviePreferences = moviePreferences.slice(0, 20);
    if (Array.isArray(languages)) updates.languages = languages.slice(0, 10);
    if (education !== undefined) updates.education = String(education).trim().substring(0, 120);
    if (occupation !== undefined) updates.occupation = String(occupation).trim().substring(0, 120);

    if (relationshipIntent && RELATIONSHIP_INTENTS.includes(relationshipIntent)) {
      updates.relationshipIntent = relationshipIntent;
    }

    if (discoveryPreferences && typeof discoveryPreferences === 'object') {
      updates.discoveryPreferences = {
        minAge: Number(discoveryPreferences.minAge) || 18,
        maxAge: Number(discoveryPreferences.maxAge) || 40,
        preferredGender: Array.isArray(discoveryPreferences.preferredGender)
          ? discoveryPreferences.preferredGender
          : ['everyone'],
        preferredRelationshipIntent: Array.isArray(discoveryPreferences.preferredRelationshipIntent)
          ? discoveryPreferences.preferredRelationshipIntent
          : [updates.relationshipIntent || 'dating'],
        locationPreference: String(discoveryPreferences.locationPreference || 'Campus Area').substring(0, 100)
      };
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    // Award Onboarding XP & First Step Badge
    await awardParticipationXp(req.user._id, 'onboarding_completed', 80, { badgeId: 'first_step' });

    return successResponse(
      res,
      { user: updatedUser.toSafeJSON() },
      'Onboarding completed! Welcome to The Quad campus community.'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Update authenticated user's profile
 * PUT /api/users/profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const allowed = [
      'name',
      'bio',
      'city',
      'profilePhoto',
      'interests',
      'hobbies',
      'musicPreferences',
      'moviePreferences',
      'languages',
      'education',
      'occupation',
      'relationshipIntent',
      'privacySettings',
      'avatar'
    ];

    const updates = {};
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) {
        if (field === 'avatar' && typeof req.body.avatar === 'object') {
          updates.avatar = {
            ...(req.user.avatar || {}),
            ...req.body.avatar
          };
        } else if (field === 'privacySettings' && typeof req.body.privacySettings === 'object') {
          updates.privacySettings = {
            ...(req.user.privacySettings || {}),
            ...req.body.privacySettings
          };
        } else {
          updates[field] = req.body[field];
        }
      }
    });

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    // Award Profile Completion XP if profile contains meaningful info
    if (updatedUser.bio && updatedUser.interests?.length > 0) {
      await awardParticipationXp(req.user._id, 'profile_completed', 100, { badgeId: 'first_step' });
    }

    return successResponse(res, { user: updatedUser.toSafeJSON() }, 'Profile updated successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * Update discovery preferences
 * PUT /api/users/discovery-preferences
 */
const updateDiscoveryPreferences = async (req, res, next) => {
  try {
    const { minAge, maxAge, preferredGender, preferredRelationshipIntent, locationPreference } = req.body;

    const currentPreferences = req.user.discoveryPreferences || {};
    const newPreferences = {
      minAge: minAge !== undefined ? Math.max(18, Number(minAge)) : currentPreferences.minAge || 18,
      maxAge: maxAge !== undefined ? Math.min(120, Number(maxAge)) : currentPreferences.maxAge || 35,
      preferredGender: Array.isArray(preferredGender) ? preferredGender : currentPreferences.preferredGender || ['everyone'],
      preferredRelationshipIntent: Array.isArray(preferredRelationshipIntent)
        ? preferredRelationshipIntent
        : currentPreferences.preferredRelationshipIntent || ['dating'],
      locationPreference: locationPreference !== undefined
        ? String(locationPreference).trim().substring(0, 100)
        : currentPreferences.locationPreference || 'Campus Area'
    };

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { discoveryPreferences: newPreferences } },
      { new: true }
    );

    return successResponse(
      res,
      { discoveryPreferences: updatedUser.discoveryPreferences },
      'Discovery preferences updated successfully.'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Update 2D/3D Avatar appearance
 * PUT /api/users/avatar
 */
const updateAvatar = async (req, res, next) => {
  try {
    const avatarPayload = req.body || {};
    const currentAvatar = req.user.avatar || {};

    const updatedAvatar = {
      ...currentAvatar,
      ...avatarPayload
    };

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { avatar: updatedAvatar } },
      { new: true }
    );

    // Award XP for personalizing student avatar
    await awardParticipationXp(req.user._id, 'avatar_customized', 40);

    return successResponse(res, { avatar: updatedUser.avatar }, 'Avatar updated successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * Get safe profile of another user
 * GET /api/users/:id
 */
const getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.isSuspended || user.isBlocked) {
      return errorResponse(res, 'User profile not found or unavailable.', 404);
    }

    return successResponse(res, { user: user.toSafeJSON() }, 'User profile retrieved.');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  completeOnboarding,
  updateProfile,
  updateDiscoveryPreferences,
  updateAvatar,
  getUserById
};
