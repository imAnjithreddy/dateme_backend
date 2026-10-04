const Block = require('../models/Block');
const Report = require('../models/Report');
const User = require('../models/User');
const Match = require('../models/Match');
const Connection = require('../models/Connection');
const { successResponse, errorResponse } = require('../utils/apiResponse');

/**
 * Block a user
 * POST /api/moderation/block
 */
const blockUser = async (req, res, next) => {
  try {
    const { targetUserId, reason = 'User requested block' } = req.body;

    if (!targetUserId) {
      return errorResponse(res, 'Target user ID is required.', 400);
    }

    if (targetUserId === req.user._id.toString()) {
      return errorResponse(res, 'You cannot block yourself.', 400);
    }

    const target = await User.findById(targetUserId);
    if (!target) {
      return errorResponse(res, 'Target user not found.', 404);
    }

    const block = await Block.findOneAndUpdate(
      { blocker: req.user._id, blocked: targetUserId },
      { blocker: req.user._id, blocked: targetUserId, reason },
      { upsert: true, new: true }
    );

    // Update matches between them to blocked
    await Match.updateMany(
      { users: { $all: [req.user._id, targetUserId] } },
      { status: 'blocked', unmatchedAt: new Date() }
    );

    // Update connection between them
    await Connection.updateMany(
      {
        $or: [
          { requester: req.user._id, recipient: targetUserId },
          { requester: targetUserId, recipient: req.user._id }
        ]
      },
      { status: 'declined' }
    );

    // Update Friendship to BLOCKED
    try {
      const Friendship = require('../models/Friendship');
      await Friendship.updateMany(
        {
          $or: [
            { requester: req.user._id, recipient: targetUserId },
            { requester: targetUserId, recipient: req.user._id }
          ]
        },
        { status: 'BLOCKED', actionUserId: req.user._id, blocked_at: new Date() }
      );
    } catch (fErr) {
      console.warn('[Moderation] Friendship block sync warning:', fErr.message);
    }

    // STRICT SECURITY: Immediately terminate voice session, close WebRTC, and clear co-seated context on block
    try {
      const { revokeVoiceSessionOnAuthLoss } = require('../socket/voiceHandler');
      const { getIO } = require('../socket');
      const io = req.app?.get('io') || getIO();
      if (io) {
        revokeVoiceSessionOnAuthLoss(req.user._id, targetUserId, io, 'blocked');
        io.to(`user:${req.user._id.toString()}`).emit('user:blocked', { targetUserId: targetUserId.toString() });
        io.to(`user:${targetUserId.toString()}`).emit('user:blocked', { targetUserId: req.user._id.toString() });
      }
    } catch (vErr) {
      console.warn('[Moderation] Error revoking voice session on block:', vErr.message);
    }

    return successResponse(res, { block }, `Successfully blocked ${target.name}.`);
  } catch (error) {
    next(error);
  }
};

/**
 * Unblock a user
 * POST /api/moderation/unblock
 */
const unblockUser = async (req, res, next) => {
  try {
    const { targetUserId } = req.body;

    if (!targetUserId) {
      return errorResponse(res, 'Target user ID is required.', 400);
    }

    await Block.findOneAndDelete({ blocker: req.user._id, blocked: targetUserId });

    return successResponse(res, null, 'User unblocked.');
  } catch (error) {
    next(error);
  }
};

/**
 * Get all blocked users for current user
 * GET /api/moderation/blocks
 */
const getMyBlocks = async (req, res, next) => {
  try {
    const blocks = await Block.find({ blocker: req.user._id })
      .populate('blocked', 'name displayName avatar city')
      .sort({ createdAt: -1 });

    return successResponse(res, { blocks, count: blocks.length }, 'Blocked users retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Report a user, profile, message, or behavior
 * POST /api/moderation/report
 */
const submitReport = async (req, res, next) => {
  try {
    const { reportedUserId, type = 'profile', reason, details = '', messageId } = req.body;

    if (!reportedUserId) {
      return errorResponse(res, 'Reported user ID is required.', 400);
    }

    if (!reason) {
      return errorResponse(res, 'Report reason is required.', 400);
    }

    const validReasons = [
      'harassment',
      'spam',
      'scam',
      'inappropriate_content',
      'fake_profile',
      'other'
    ];
    if (!validReasons.includes(reason)) {
      return errorResponse(res, `Invalid reason. Must be one of: ${validReasons.join(', ')}`, 400);
    }

    const reportedUser = await User.findById(reportedUserId);
    if (!reportedUser) {
      return errorResponse(res, 'Reported user not found.', 404);
    }

    const report = await Report.create({
      reporter: req.user._id,
      reportedUser: reportedUserId,
      type,
      reason,
      details: String(details).trim().substring(0, 1000),
      messageContext: messageId || null,
      status: 'pending'
    });

    return successResponse(
      res,
      { report },
      'Thank you for reporting. Our Trust & Safety team will review this report promptly.',
      201
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Get all reports
 * GET /api/moderation/admin/reports
 */
const getAdminReports = async (req, res, next) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};

    const reports = await Report.find(filter)
      .populate('reporter', 'name email role')
      .populate('reportedUser', 'name email role isSuspended isBlocked')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 });

    return successResponse(res, { reports, count: reports.length }, 'Admin reports retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Resolve or take action on a report
 * PUT /api/moderation/admin/reports/:id
 */
const updateAdminReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, adminNotes, suspendUser } = req.body;

    const report = await Report.findById(id);
    if (!report) {
      return errorResponse(res, 'Report not found.', 404);
    }

    if (status) report.status = status;
    if (adminNotes !== undefined) report.adminNotes = adminNotes;
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();

    await report.save();

    if (suspendUser) {
      await User.findByIdAndUpdate(report.reportedUser, { isSuspended: true });
    }

    return successResponse(res, { report }, 'Report updated by admin.');
  } catch (error) {
    next(error);
  }
};

/**
 * Get reports submitted by current user (Self-Service Report Tracking)
 * GET /api/moderation/my-reports
 */
const getMyReports = async (req, res, next) => {
  try {
    const reports = await Report.find({ reporter: req.user._id })
      .populate('reportedUser', 'name displayName avatar')
      .sort({ createdAt: -1 });

    return successResponse(res, { reports, count: reports.length }, 'User reports retrieved');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  blockUser,
  unblockUser,
  getMyBlocks,
  submitReport,
  getMyReports,
  getAdminReports,
  updateAdminReport
};
