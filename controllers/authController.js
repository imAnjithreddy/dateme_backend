const User = require('../models/User');
const { signToken } = require('../utils/jwt');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { ROLES, RELATIONSHIP_INTENTS, GENDERS, ONLINE_STATUS } = require('../config/constants');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

const CLEAR_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
};

/**
 * Calculate age accurately from date of birth
 */
const calculateAge = (dobString) => {
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }

  return age;
};

/**
 * Register a new 18+ member
 * POST /api/auth/register
 */
const register = async (req, res, next) => {
  try {
    const {
      name,
      displayName,
      email,
      password,
      dateOfBirth,
      gender,
      city,
      relationshipIntent
    } = req.body;

    const chosenName = (name || displayName || '').trim();

    // 1. Basic field presence
    if (!chosenName || !email || !password || !dateOfBirth) {
      return errorResponse(res, 'Please provide name, email, password, and date of birth.', 400);
    }

    // 2. Email format validation
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email.trim())) {
      return errorResponse(res, 'Please provide a valid email address.', 400);
    }

    // 3. Password length
    if (password.length < 6) {
      return errorResponse(res, 'Password must be at least 6 characters long.', 400);
    }

    // 4. Strict 18+ age verification
    const age = calculateAge(dateOfBirth);
    if (age === null) {
      return errorResponse(res, 'Please provide a valid date of birth.', 400);
    }
    if (age < 18) {
      return errorResponse(
        res,
        'You must be at least 18 years old to join The Quad. Registration cannot proceed.',
        400,
        { code: 'UNDER_18', calculatedAge: age }
      );
    }

    // 5. Gender validation
    const sanitizedGender = GENDERS.includes(gender) ? gender : 'prefer_not_to_say';

    // 6. Relationship intent validation
    const sanitizedIntent = RELATIONSHIP_INTENTS.includes(relationshipIntent)
      ? relationshipIntent
      : 'dating';

    // 7. Check duplicate email
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return errorResponse(res, 'An account with this email already exists.', 409);
    }

// Canonical Default 2D Avatars for Registration
const DEFAULT_GIRL_AVATAR = {
  gender: 'female',
  skinTone: '#f8d7b8',
  eyeColor: '#1e293b',
  hairStyle: 'ponytails',
  hairColor: '#e85d75',
  mouthExpression: 'smile',
  blush: true,
  topStyle: 'crop-top',
  topColor: '#ffffff',
  bottomStyle: 'pleated-skirt',
  bottomColor: '#f43f5e',
  dressStyle: 'none',
  dressColor: '#f43f5e',
  shoesStyle: 'sneakers',
  shoesColor: '#ffffff',
  headwear: 'ribbon-clip',
  headwearColor: '#f43f5e',
  accessory: 'necklace',
  accessoryColor: '#facc15',
  specialItem: 'campus-pin'
};

const DEFAULT_BOY_AVATAR = {
  gender: 'male',
  skinTone: '#f8d7b8',
  eyeColor: '#1e293b',
  hairStyle: 'short-messy',
  hairColor: '#111827',
  mouthExpression: 'smirk',
  blush: false,
  topStyle: 'hoodie',
  topColor: '#f43f5e',
  bottomStyle: 'cargo-pants',
  bottomColor: '#334155',
  dressStyle: 'none',
  dressColor: '#f43f5e',
  shoesStyle: 'sneakers',
  shoesColor: '#ffffff',
  headwear: 'baseball-cap',
  headwearColor: '#1e293b',
  accessory: 'backpack',
  accessoryColor: '#18181b',
  specialItem: 'campus-pin'
};

    // 8. Create user with onboarding pending and default character avatar
    const initialAvatar = sanitizedGender === 'female'
      ? DEFAULT_GIRL_AVATAR
      : (sanitizedGender === 'male' ? DEFAULT_BOY_AVATAR : DEFAULT_GIRL_AVATAR);

    const newUser = await User.create({
      name: chosenName,
      email: email.toLowerCase().trim(),
      password,
      dateOfBirth: new Date(dateOfBirth),
      gender: sanitizedGender,
      city: (city || '').trim(),
      avatar: initialAvatar,
      relationshipIntent: sanitizedIntent,
      onlineStatus: ONLINE_STATUS.ONLINE,
      lastActive: new Date(),
      onboardingCompleted: false,
      discoveryPreferences: {
        minAge: Math.max(18, age - 4),
        maxAge: age + 8,
        preferredGender: ['everyone'],
        preferredRelationshipIntent: [sanitizedIntent],
        locationPreference: (city || '').trim() || 'Campus & Surrounding Area'
      }
    });

    const token = signToken({ id: newUser._id, role: newUser.role });

    res.cookie('token', token, COOKIE_OPTIONS);

    return successResponse(
      res,
      {
        user: newUser.toSafeJSON(),
        token,
        requiresOnboarding: true
      },
      'Welcome to The Quad! Please complete your campus onboarding.',
      201
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Login existing user
 * POST /api/auth/login
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return errorResponse(res, 'Please enter your email and password.', 400);
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');

    if (!user) {
      return errorResponse(res, 'Invalid email or password.', 401);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return errorResponse(res, 'Invalid email or password.', 401);
    }

    if (user.isSuspended || user.isBlocked) {
      return errorResponse(
        res,
        'Your account has been suspended for safety and policy compliance.',
        403
      );
    }

    // Update active status
    user.onlineStatus = ONLINE_STATUS.ONLINE;
    user.lastActive = new Date();
    await user.save({ validateBeforeSave: false });

    const token = signToken({ id: user._id, role: user.role });

    res.cookie('token', token, COOKIE_OPTIONS);

    return successResponse(
      res,
      {
        user: user.toSafeJSON(),
        token,
        requiresOnboarding: !user.onboardingCompleted
      },
      'Welcome back to The Quad!'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Current user profile
 * GET /api/auth/me
 */
const getMe = async (req, res, next) => {
  try {
    return successResponse(
      res,
      {
        user: req.user.toSafeJSON(),
        requiresOnboarding: !req.user.onboardingCompleted
      },
      'Current user profile retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Logout
 * POST /api/auth/logout
 */
const logout = async (req, res, next) => {
  try {
    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, {
        onlineStatus: ONLINE_STATUS.OFFLINE,
        lastActive: new Date()
      });
    }

    res.clearCookie('token', CLEAR_COOKIE_OPTIONS);
    return successResponse(res, null, 'Signed out of The Quad successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * Secure development-only bootstrap endpoint for creating the first PLATFORM_ADMIN
 * POST /api/auth/bootstrap-admin
 */
const bootstrapAdmin = async (req, res, next) => {
  try {
    const bootstrapSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
    const providedSecret = req.body?.secret || req.headers['x-bootstrap-secret'];

    if (!bootstrapSecret || providedSecret !== bootstrapSecret) {
      return errorResponse(res, 'Unauthorized access to admin bootstrap utility.', 403);
    }

    const adminEmail = (req.body?.email || process.env.INITIAL_ADMIN_EMAIL || 'admin@thequad.edu').toLowerCase().trim();
    const adminPassword = req.body?.password || process.env.INITIAL_ADMIN_PASSWORD || 'QuadAdminPass2026!';
    const adminName = req.body?.name || process.env.INITIAL_ADMIN_NAME || 'Platform Administrator';

    let admin = await User.findOne({ email: adminEmail }).select('+password');

    if (admin) {
      admin.role = ROLES.PLATFORM_ADMIN;
      admin.password = adminPassword;
      admin.onboardingCompleted = true;
      admin.isVerified = true;
      await admin.save();

      return successResponse(
        res,
        { admin: admin.toSafeJSON() },
        'Platform admin account updated successfully.'
      );
    }

    // Create new admin
    const dob = new Date('1998-01-01');
    admin = await User.create({
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      dateOfBirth: dob,
      gender: 'prefer_not_to_say',
      city: 'Campus Headquarters',
      bio: 'Official Quad Platform Administrator & Trust Safety Guide.',
      role: ROLES.PLATFORM_ADMIN,
      isVerified: true,
      onboardingCompleted: true,
      onlineStatus: ONLINE_STATUS.ONLINE
    });

    const token = signToken({ id: admin._id, role: admin.role });

    return successResponse(
      res,
      {
        admin: admin.toSafeJSON(),
        token
      },
      'Initial PLATFORM_ADMIN created successfully.',
      201
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  getMe,
  logout,
  bootstrapAdmin
};
