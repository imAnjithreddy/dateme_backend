const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const {
  ROLES,
  SUBSCRIPTION_STATUS,
  RELATIONSHIP_INTENTS,
  GENDERS,
  ONLINE_STATUS
} = require('../config/constants');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long'],
      maxlength: [50, 'Name cannot exceed 50 characters']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters long'],
      select: false
    },
    dateOfBirth: {
      type: Date,
      required: [true, 'Date of birth is required for 18+ age verification']
    },
    gender: {
      type: String,
      enum: GENDERS,
      default: 'prefer_not_to_say'
    },
    city: {
      type: String,
      trim: true,
      default: '',
      maxlength: [100, 'City cannot exceed 100 characters']
    },
    bio: {
      type: String,
      default: '',
      maxlength: [500, 'Bio cannot exceed 500 characters']
    },
    profilePhoto: {
      type: String,
      default: ''
    },
    avatar: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        gender: 'unisex',
        avatarStyle: 'chill-scholar',
        hairStyle: 'undercut',
        hairColor: '#111827',
        faceExpression: 'friendly-smile',
        mouthExpression: 'smile',
        blush: true,
        eyeColor: '#1e293b',
        skinTone: '#e0ac69',
        topStyle: 'hoodie',
        topColor: '#f43f5e',
        bottomStyle: 'jeans',
        bottomColor: '#1e293b',
        dressStyle: 'none',
        dressColor: '#f43f5e',
        outfitStyle: 'varsity-jacket',
        outfitColor: '#f43f5e',
        primaryColor: '#f43f5e',
        secondaryColor: '#35151D',
        shoesStyle: 'sneakers',
        shoesColor: '#ffffff',
        headwear: 'none',
        headwearColor: '#f43f5e',
        accessory: 'none',
        accessoryColor: '#facc15',
        specialItem: 'none'
      })
    },
    interests: {
      type: [String],
      default: []
    },
    hobbies: {
      type: [String],
      default: []
    },
    languages: {
      type: [String],
      default: ['English']
    },
    relationshipIntent: {
      type: String,
      enum: [...RELATIONSHIP_INTENTS, ''],
      default: 'dating'
    },
    musicPreferences: {
      type: [String],
      default: []
    },
    moviePreferences: {
      type: [String],
      default: []
    },
    education: {
      type: String,
      default: '',
      maxlength: [120, 'Education cannot exceed 120 characters']
    },
    occupation: {
      type: String,
      default: '',
      maxlength: [120, 'Occupation cannot exceed 120 characters']
    },
    level: {
      type: Number,
      default: 1
    },
    levelTitle: {
      type: String,
      default: 'Newcomer'
    },
    xp: {
      type: Number,
      default: 100
    },
    campusXp: {
      type: Number,
      default: 100
    },
    badges: {
      type: [String],
      default: ['Verified 18+', 'First Step']
    },
    completedGamificationActions: {
      type: [String],
      default: []
    },
    privacySettings: {
      showOnlineStatus: {
        type: Boolean,
        default: true
      },
      showAge: {
        type: Boolean,
        default: true
      },
      showLocation: {
        type: Boolean,
        default: true
      },
      allowWhispers: {
        type: Boolean,
        default: true
      }
    },
    discoveryPreferences: {
      minAge: {
        type: Number,
        min: 18,
        default: 18
      },
      maxAge: {
        type: Number,
        max: 120,
        default: 35
      },
      preferredGender: {
        type: [String],
        default: ['everyone']
      },
      preferredRelationshipIntent: {
        type: [String],
        default: ['dating', 'open_to_anything']
      },
      locationPreference: {
        type: String,
        default: 'Campus & Surrounding Area'
      }
    },
    onlineStatus: {
      type: String,
      enum: Object.values(ONLINE_STATUS),
      default: ONLINE_STATUS.OFFLINE
    },
    lastActive: {
      type: Date,
      default: Date.now
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    isBlocked: {
      type: Boolean,
      default: false
    },
    isSuspended: {
      type: Boolean,
      default: false
    },
    suspendedUntil: {
      type: Date,
      default: null
    },
    suspendReason: {
      type: String,
      default: ''
    },
    isBanned: {
      type: Boolean,
      default: false
    },
    banReason: {
      type: String,
      default: ''
    },
    restrictions: {
      canChat: {
        type: Boolean,
        default: true
      },
      canSendRequests: {
        type: Boolean,
        default: true
      },
      canUseVoice: {
        type: Boolean,
        default: true
      }
    },
    warningCount: {
      type: Number,
      default: 0
    },
    warnings: [
      {
        reason: { type: String, required: true },
        issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        issuedAt: { type: Date, default: Date.now }
      }
    ],
    role: {
      type: String,
      enum: [ROLES.USER, ROLES.PLATFORM_ADMIN],
      default: ROLES.USER
    },
    subscriptionStatus: {
      type: String,
      enum: Object.values(SUBSCRIPTION_STATUS),
      default: SUBSCRIPTION_STATUS.FREE
    },
    onboardingCompleted: {
      type: Boolean,
      default: false
    },
    currentCampusZone: {
      type: String,
      default: 'central-quad'
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual field: calculated Age
userSchema.virtual('age').get(function () {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  const dob = new Date(this.dateOfBirth);
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
});

// Virtual field for backwards compatibility with displayName
userSchema.virtual('displayName').get(function () {
  return this.name;
});

// Hash password before saving if modified
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword) return false;
  const isMatch = await bcrypt.compare(candidatePassword, this.password);
  if (isMatch) return true;

  // In development, also accept common dev passwords or email to prevent lockout on in-memory restarts
  if (process.env.NODE_ENV === 'development') {
    if (
      candidatePassword === 'password123' ||
      candidatePassword === 'Password123!' ||
      candidatePassword === 'Password123' ||
      candidatePassword === '123456' ||
      candidatePassword === this.email
    ) {
      return true;
    }
  }

  return false;
};

// Safe JSON serialization
userSchema.methods.toSafeJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.password;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
