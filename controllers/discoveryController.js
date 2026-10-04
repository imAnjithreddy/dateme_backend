const User = require('../models/User');
const Connection = require('../models/Connection');
const { successResponse } = require('../utils/apiResponse');

/**
 * Get people discovery feed tailored to user preferences
 * GET /api/discovery
 */
const getDiscoveryFeed = async (req, res, next) => {
  try {
    const currentUser = req.user;
    const prefs = currentUser.discoveryPreferences || {};

    const existingConnections = await Connection.find({
      $or: [{ requester: currentUser._id }, { recipient: currentUser._id }]
    });

    // Check blocks
    const Block = require('../models/Block');
    const blocks = await Block.find({
      $or: [{ blocker: currentUser._id }, { blocked: currentUser._id }]
    });

    // Exclude current user, accepted connections, active pending requests, and blocked users
    const excludedIds = new Set([currentUser._id.toString()]);
    // Declined connections should reappear in discovery subject to the 1-week cooldown limit
    const declinedMap = new Map(); // partnerId -> declinedAt

    existingConnections.forEach((conn) => {
      const isReq = conn.requester.toString() === currentUser._id.toString();
      const partnerId = isReq ? conn.recipient.toString() : conn.requester.toString();

      if (conn.status === 'accepted' || conn.status === 'pending') {
        excludedIds.add(partnerId);
      } else if (conn.status === 'passed' && isReq) {
        excludedIds.add(partnerId);
      } else if (conn.status === 'declined') {
        declinedMap.set(partnerId, conn.declinedAt || conn.updatedAt);
      }
    });

    blocks.forEach((b) => {
      excludedIds.add(b.blocker.toString());
      excludedIds.add(b.blocked.toString());
    });

    // 2. Query candidates
    const query = {
      _id: { $nin: Array.from(excludedIds) },
      isSuspended: false,
      isBlocked: false,
      role: 'USER'
    };

    // Filter by preferred gender if not 'everyone'
    if (prefs.preferredGender && !prefs.preferredGender.includes('everyone') && prefs.preferredGender.length > 0) {
      query.gender = { $in: prefs.preferredGender };
    }

    const candidates = await User.find(query)
      .limit(30)
      .sort({ lastActive: -1 });

    // 3. Annotate with shared interests & age filtering in memory for virtual age getter
    const userInterests = new Set(currentUser.interests || []);

    const defaultInterestFallbacks = ['Campus Life', 'Coffee', 'Music', 'Photography', 'Design', 'Reading', 'Gaming'];

    const feed = candidates
      .map((c) => {
        const candidateObj = c.toSafeJSON();
        const candidateAge = c.age;

        // Check age range
        if (prefs.minAge && candidateAge < prefs.minAge) return null;
        if (prefs.maxAge && candidateAge > prefs.maxAge) return null;

        const candidateInterests =
          c.interests && c.interests.length > 0
            ? c.interests
            : c.hobbies && c.hobbies.length > 0
            ? c.hobbies
            : defaultInterestFallbacks.slice(0, 4);

        const shared = candidateInterests.filter((i) => userInterests.has(i));
        const sharedHobbies = (c.hobbies || []).filter((h) => (currentUser.hobbies || []).includes(h));

        // Check 7-Day cooldown if connection was declined
        let cooldownDaysLeft = 0;
        let isCooldownActive = false;
        const cid = c._id.toString();
        if (declinedMap.has(cid)) {
          const declinedTime = new Date(declinedMap.get(cid)).getTime();
          const cooldownMs = 7 * 24 * 60 * 60 * 1000;
          const elapsed = Date.now() - declinedTime;
          if (elapsed < cooldownMs) {
            isCooldownActive = true;
            cooldownDaysLeft = Math.ceil((cooldownMs - elapsed) / (24 * 60 * 60 * 1000));
          }
        }

        return {
          ...candidateObj,
          interests: candidateInterests,
          age: candidateAge,
          sharedInterests: shared,
          sharedHobbies,
          hasCooldown: isCooldownActive,
          cooldownDaysLeft: cooldownDaysLeft,
          compatibilityScore: Math.min(98, 60 + shared.length * 10 + sharedHobbies.length * 8)
        };
      })
      .filter(Boolean);

    return successResponse(
      res,
      {
        feed,
        count: feed.length,
        userPreferences: prefs
      },
      'Discovery feed retrieved'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDiscoveryFeed
};
