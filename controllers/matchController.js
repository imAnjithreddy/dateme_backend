const Match = require('../models/Match');
const Connection = require('../models/Connection');
const { successResponse, errorResponse } = require('../utils/apiResponse');

/**
 * Get all active matches for the authenticated user
 * GET /api/matches
 */
const getMatches = async (req, res, next) => {
  try {
    const matches = await Match.find({
      users: req.user._id,
      status: 'active'
    })
      .populate('users', 'name displayName avatar age city bio onlineStatus interests relationshipIntent faculty')
      .sort({ lastInteraction: -1 });

    const formatted = matches.map((m) => {
      const partner = m.users.find((u) => u._id.toString() !== req.user._id.toString());
      return {
        _id: m._id,
        matchId: m._id,
        connectionId: m.connection,
        status: m.status,
        createdAt: m.createdAt,
        lastInteraction: m.lastInteraction,
        partner: partner || null
      };
    });

    return successResponse(
      res,
      { matches: formatted, count: formatted.length },
      'Matches retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get match details by ID
 * GET /api/matches/:id
 */
const getMatchById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const match = await Match.findById(id).populate(
      'users',
      'name displayName avatar age city bio onlineStatus interests relationshipIntent faculty'
    );

    if (!match) {
      return errorResponse(res, 'Match not found.', 404);
    }

    const isMember = match.users.some((u) => u._id.toString() === req.user._id.toString());
    if (!isMember) {
      return errorResponse(res, 'You are not a member of this match.', 403);
    }

    const partner = match.users.find((u) => u._id.toString() !== req.user._id.toString());

    return successResponse(
      res,
      {
        match: {
          _id: match._id,
          matchId: match._id,
          status: match.status,
          createdAt: match.createdAt,
          lastInteraction: match.lastInteraction,
          partner
        }
      },
      'Match retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Unmatch a user (accepts /:id/unmatch or POST /unmatch with targetUserId / matchId in body)
 */
const unmatch = async (req, res, next) => {
  try {
    const targetMatchId = req.params.id || req.body.matchId;
    const targetUserId = req.body.targetUserId;

    let match = null;
    if (targetMatchId) {
      match = await Match.findById(targetMatchId);
    } else if (targetUserId) {
      match = await Match.findOne({
        users: { $all: [req.user._id, targetUserId] }
      });
    }

    if (!match) {
      return errorResponse(res, 'Match not found.', 404);
    }

    const isMember = match.users.some((u) => u.toString() === req.user._id.toString());
    if (!isMember) {
      return errorResponse(res, 'You are not authorized to unmatch this connection.', 403);
    }

    match.status = 'unmatched';
    match.unmatchedBy = req.user._id;
    match.unmatchedAt = new Date();
    await match.save();

    // Also update connection status if exists
    if (match.connection) {
      await Connection.findByIdAndUpdate(match.connection, { status: 'cancelled' });
    }

    return successResponse(res, { match }, 'Connection unmatched successfully.');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMatches,
  getMatchById,
  unmatch
};
