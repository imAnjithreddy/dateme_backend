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

    const excludedIds = new Set();
    excludedIds.add(currentUser._id.toString());

    existingConnections.forEach((conn) => {
      excludedIds.add(conn.requester.toString());
      excludedIds.add(conn.recipient.toString());
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

    const feed = candidates
      .map((c) => {
        const candidateObj = c.toSafeJSON();
        const candidateAge = c.age;

        // Check age range
        if (prefs.minAge && candidateAge < prefs.minAge) return null;
        if (prefs.maxAge && candidateAge > prefs.maxAge) return null;

        const shared = (c.interests || []).filter((i) => userInterests.has(i));
        const sharedHobbies = (c.hobbies || []).filter((h) => (currentUser.hobbies || []).includes(h));

        return {
          ...candidateObj,
          age: candidateAge,
          sharedInterests: shared,
          sharedHobbies,
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
