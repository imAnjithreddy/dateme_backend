const mongoose = require('mongoose');
const Friendship = require('../models/Friendship');
const User = require('../models/User');
const Block = require('../models/Block');
const Notification = require('../models/Notification');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// Safe user fields projection to prevent credential leakage
const SAFE_USER_FIELDS = '_id name displayName email avatar bio profilePhoto city gender onlineStatus isOnline lastSeen interests major campusYear year department';

/**
 * Helper: Only populate timestamps and fields that are relevant to the friendship state.
 * Prevents polluting response with irrelevant null timestamps.
 */
const formatFriendshipForState = (f, currentUserId) => {
  const doc = f.toObject ? f.toObject() : { ...f };
  const currentIdStr = currentUserId ? currentUserId.toString() : '';

  const requesterIdStr = (doc.requester?._id || doc.requester || '').toString();
  const recipientIdStr = (doc.recipient?._id || doc.recipient || '').toString();
  const actionUserIdStr = (doc.actionUserId?._id || doc.actionUserId || '').toString();

  const isRequester = requesterIdStr === currentIdStr;
  const isRecipient = recipientIdStr === currentIdStr;
  const actionTakenByMe = actionUserIdStr === currentIdStr;
  const otherUser = isRequester ? doc.recipient : doc.requester;

  const result = {
    _id: doc._id,
    requester: doc.requester,
    recipient: doc.recipient,
    actionUserId: doc.actionUserId,
    otherUser,
    isRequester,
    isRecipient,
    actionTakenByMe,
    status: doc.status,
    message: doc.message || '',
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at
  };

  // Only attach timestamps relevant to the current state
  switch (doc.status) {
    case 'ACCEPTED':
      result.accepted_at = doc.accepted_at;
      result.acceptedAt = doc.accepted_at;
      break;
    case 'DECLINED':
      result.declined_at = doc.declined_at;
      result.declinedAt = doc.declined_at;
      break;
    case 'CANCELLED':
      result.cancelled_at = doc.cancelled_at;
      result.cancelledAt = doc.cancelled_at;
      break;
    case 'REMOVED':
      result.accepted_at = doc.accepted_at;
      result.acceptedAt = doc.accepted_at;
      result.removed_at = doc.removed_at;
      result.removedAt = doc.removed_at;
      break;
    case 'BLOCKED':
      result.blocked_at = doc.blocked_at;
      result.blockedAt = doc.blocked_at;
      break;
    case 'PENDING':
    default:
      // No extra transition timestamp needed for pending
      break;
  }

  return result;
};

/**
 * 1. Send friend request
 * POST /friends/request
 */
const sendFriendRequest = async (req, res, next) => {
  try {
    const requesterId = req.user._id;
    const recipientId = req.body.recipientId || req.body.recipient || req.body.friendId || req.body.userId || req.body.targetUserId;
    const { message = '' } = req.body;

    if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {
      return errorResponse(res, 'A valid recipient ID is required.', 400);
    }

    // Rule: Prevent sending request to yourself
    if (requesterId.toString() === recipientId.toString()) {
      return errorResponse(res, 'You cannot send a friend request to yourself.', 400);
    }

    // Verify recipient existence
    const recipient = await User.findById(recipientId).select(SAFE_USER_FIELDS);
    if (!recipient || recipient.isSuspended || recipient.isBlocked || recipient.isBanned) {
      return errorResponse(res, 'Target campus user not found or unavailable.', 404);
    }

    // Rule: Prevent sending request to/from blocked users
    const isBlocked = await Block.findOne({
      $or: [
        { blocker: requesterId, blocked: recipientId },
        { blocker: recipientId, blocked: requesterId }
      ]
    });
    const isFriendshipBlocked = await Friendship.findOne({
      status: 'BLOCKED',
      $or: [
        { requester: requesterId, recipient: recipientId },
        { requester: recipientId, recipient: requesterId }
      ]
    });
    if (isBlocked || isFriendshipBlocked) {
      return errorResponse(res, 'Cannot send a friend request to this user.', 403);
    }

    // Rule: Prevent duplicate friendships
    const existingAccepted = await Friendship.findOne({
      status: 'ACCEPTED',
      $or: [
        { requester: requesterId, recipient: recipientId },
        { requester: recipientId, recipient: requesterId }
      ]
    });
    if (existingAccepted) {
      return errorResponse(res, 'You are already friends with this user.', 400);
    }

    // Rule: Prevent duplicate pending requests
    const existingPending = await Friendship.findOne({
      status: 'PENDING',
      $or: [
        { requester: requesterId, recipient: recipientId },
        { requester: recipientId, recipient: requesterId }
      ]
    });
    if (existingPending) {
      if (existingPending.requester.toString() === requesterId.toString()) {
        return errorResponse(res, 'You have already sent a pending friend request to this user.', 400);
      } else {
        return errorResponse(res, 'This user has already sent you a friend request. Please accept it instead.', 400);
      }
    }

    // Check for past declined/cancelled/removed record between these users to reuse or create new
    let friendship = await Friendship.findOne({
      $or: [
        { requester: requesterId, recipient: recipientId },
        { requester: recipientId, recipient: requesterId }
      ]
    });

    if (friendship) {
      friendship.requester = requesterId;
      friendship.recipient = recipientId;
      friendship.status = 'PENDING';
      friendship.actionUserId = requesterId;
      friendship.message = message.trim();
      friendship.accepted_at = null;
      friendship.declined_at = null;
      friendship.cancelled_at = null;
      friendship.removed_at = null;
      friendship.blocked_at = null;
      await friendship.save();
    } else {
      friendship = await Friendship.create({
        requester: requesterId,
        recipient: recipientId,
        status: 'PENDING',
        actionUserId: requesterId,
        message: message.trim()
      });
    }

    // Create persistent notification for the recipient
    await Notification.create({
      recipient: recipientId,
      sender: requesterId,
      type: 'friend_request',
      title: 'New Friend Request',
      message: `${req.user.name} sent you a friend request.`,
      data: {
        friendshipId: friendship._id,
        actionUrl: '/friends'
      }
    });

    // Bidirectional Sync: Also ensure pending Connection exists
    try {
      const Connection = require('../models/Connection');
      let conn = await Connection.findOne({
        $or: [
          { requester: requesterId, recipient: recipientId },
          { requester: recipientId, recipient: requesterId }
        ]
      });
      if (!conn) {
        await Connection.create({
          requester: requesterId,
          recipient: recipientId,
          status: 'pending',
          campusZone: 'central-quad',
          connectionOrigin: 'virtual_campus'
        });
      } else if (conn.status !== 'accepted') {
        conn.requester = requesterId;
        conn.recipient = recipientId;
        conn.status = 'pending';
        await conn.save();
      }
    } catch (cErr) {
      console.warn('[Friendship] Connection request sync warning:', cErr.message);
    }

    // Live WebSocket Handshake Notification
    try {
      const { getIO } = require('../socket');
      const io = req.app?.get('io') || getIO();
      if (io) {
        const payload = {
          type: 'friend_request',
          senderId: requesterId.toString(),
          senderName: req.user.name,
          recipientId: recipientId.toString(),
          status: 'PENDING'
        };
        io.to(`user:${recipientId.toString()}`).emit('friendship:status_changed', payload);
        io.to(`user:${recipientId.toString()}`).emit('friend:request_received', payload);
      }
    } catch (ioErr) {
      console.warn('[Friendship] Socket broadcast warning:', ioErr.message);
    }

    await friendship.populate([
      { path: 'requester', select: SAFE_USER_FIELDS },
      { path: 'recipient', select: SAFE_USER_FIELDS }
    ]);

    const formatted = formatFriendshipForState(friendship, requesterId);
    return successResponse(res, formatted, `Friend request sent successfully to ${recipient.name}.`, 201);
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Accept friend request
 * POST /friends/:requestId/accept
 */
const acceptFriendRequest = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { requestId } = req.params;

    if (!requestId || !mongoose.Types.ObjectId.isValid(requestId)) {
      return errorResponse(res, 'Invalid friend request ID.', 400);
    }

    const request = await Friendship.findById(requestId);
    if (!request) {
      return errorResponse(res, 'Friend request not found.', 404);
    }

    // Security check: Only the intended recipient can accept
    if (request.recipient.toString() !== userId.toString()) {
      if (request.requester.toString() === userId.toString()) {
        return errorResponse(res, 'You cannot accept your own friend request.', 403);
      }
      return errorResponse(res, "You are not authorized to accept someone else's request.", 403);
    }

    if (request.status === 'ACCEPTED') {
      return errorResponse(res, 'This friend request has already been accepted.', 400);
    }
    if (request.status !== 'PENDING') {
      return errorResponse(res, `Cannot accept a friend request that is ${request.status.toLowerCase()}.`, 400);
    }

    const isBlocked = await Block.findOne({
      $or: [
        { blocker: userId, blocked: request.requester },
        { blocker: request.requester, blocked: userId }
      ]
    });
    if (isBlocked) {
      return errorResponse(res, 'Cannot accept friend request due to block restrictions.', 403);
    }

    request.status = 'ACCEPTED';
    request.actionUserId = userId;
    request.accepted_at = new Date();
    await request.save();

    // Ensure accepted Connection exists so whisper messaging permission is enabled for friends
    try {
      const Connection = require('../models/Connection');
      let conn = await Connection.findOne({
        $or: [
          { requester: request.requester, recipient: userId },
          { requester: userId, recipient: request.requester }
        ]
      });
      if (!conn) {
        await Connection.create({
          requester: request.requester,
          recipient: userId,
          status: 'accepted',
          campusZone: 'central-quad',
          connectionOrigin: 'virtual_campus'
        });
      } else if (conn.status !== 'accepted') {
        conn.status = 'accepted';
        await conn.save();
      }
    } catch (e) {
      console.warn('[Friendship] Connection sync warning:', e.message);
    }

    // Notify requester
    await Notification.create({
      recipient: request.requester,
      sender: userId,
      type: 'friend_accepted',
      title: 'Friend Request Accepted',
      message: `${req.user.name} accepted your friend request! You are now friends.`,
      data: {
        friendshipId: request._id,
        actionUrl: '/friends'
      }
    });

    // Live WebSocket Handshake Notification
    try {
      const { getIO } = require('../socket');
      const io = req.app?.get('io') || getIO();
      if (io) {
        const payload = {
          type: 'friend_accepted',
          partnerId: userId.toString(),
          partnerName: req.user.name,
          targetUserId: request.requester._id ? request.requester._id.toString() : request.requester.toString(),
          status: 'ACCEPTED',
          isFriend: true
        };
        const partnerStr = request.requester._id ? request.requester._id.toString() : request.requester.toString();
        io.to(`user:${partnerStr}`).emit('friendship:status_changed', payload);
        io.to(`user:${partnerStr}`).emit('friend:accepted', payload);
        io.to(`user:${userId.toString()}`).emit('friendship:status_changed', payload);
        io.to(`user:${userId.toString()}`).emit('friend:accepted', payload);
      }
    } catch (ioErr) {
      console.warn('[Friendship] Socket broadcast warning:', ioErr.message);
    }

    await request.populate([
      { path: 'requester', select: SAFE_USER_FIELDS },
      { path: 'recipient', select: SAFE_USER_FIELDS }
    ]);

    const formatted = formatFriendshipForState(request, userId);
    return successResponse(res, formatted, 'Friend request accepted successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Decline friend request
 * POST /friends/:requestId/decline
 */
const declineFriendRequest = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { requestId } = req.params;

    if (!requestId || !mongoose.Types.ObjectId.isValid(requestId)) {
      return errorResponse(res, 'Invalid friend request ID.', 400);
    }

    const request = await Friendship.findById(requestId);
    if (!request) {
      return errorResponse(res, 'Friend request not found.', 404);
    }

    // Security check: Only the intended recipient can decline
    if (request.recipient.toString() !== userId.toString()) {
      return errorResponse(res, "You are not authorized to decline someone else's request.", 403);
    }

    if (request.status !== 'PENDING') {
      return errorResponse(res, `Cannot decline a friend request that is ${request.status.toLowerCase()}.`, 400);
    }

    request.status = 'DECLINED';
    request.actionUserId = userId;
    request.declined_at = new Date();
    await request.save();

    // Bidirectional Sync: Also set Connection status to declined
    try {
      const Connection = require('../models/Connection');
      await Connection.updateMany(
        {
          $or: [
            { requester: request.requester, recipient: userId },
            { requester: userId, recipient: request.requester }
          ],
          status: 'pending'
        },
        { status: 'declined' }
      );
    } catch (cErr) {
      console.warn('[Friendship] Connection decline sync warning:', cErr.message);
    }

    // Live WebSocket Handshake Notification
    try {
      const { getIO } = require('../socket');
      const io = req.app?.get('io') || getIO();
      if (io) {
        const payload = {
          type: 'friend_declined',
          partnerId: userId.toString(),
          targetUserId: request.requester.toString(),
          status: 'DECLINED',
          isFriend: false
        };
        io.to(`user:${request.requester.toString()}`).emit('friendship:status_changed', payload);
        io.to(`user:${request.requester.toString()}`).emit('friend:declined', payload);
      }
    } catch (ioErr) {
      console.warn('[Friendship] Socket broadcast warning:', ioErr.message);
    }

    await request.populate([
      { path: 'requester', select: SAFE_USER_FIELDS },
      { path: 'recipient', select: SAFE_USER_FIELDS }
    ]);

    const formatted = formatFriendshipForState(request, userId);
    return successResponse(res, formatted, 'Friend request declined.');
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Cancel friend request
 * POST /friends/:requestId/cancel
 */
const cancelFriendRequest = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { requestId } = req.params;

    if (!requestId || !mongoose.Types.ObjectId.isValid(requestId)) {
      return errorResponse(res, 'Invalid friend request ID.', 400);
    }

    const request = await Friendship.findById(requestId);
    if (!request) {
      return errorResponse(res, 'Friend request not found.', 404);
    }

    // Security check: Only the original requester can cancel
    if (request.requester.toString() !== userId.toString()) {
      return errorResponse(res, "You are not authorized to cancel someone else's request. Only the sender can cancel.", 403);
    }

    if (request.status !== 'PENDING') {
      return errorResponse(res, `Cannot cancel a friend request that is ${request.status.toLowerCase()}.`, 400);
    }

    request.status = 'CANCELLED';
    request.actionUserId = userId;
    request.cancelled_at = new Date();
    await request.save();

    // Bidirectional Sync: Also set Connection status to cancelled
    try {
      const Connection = require('../models/Connection');
      await Connection.updateMany(
        {
          $or: [
            { requester: request.requester, recipient: request.recipient },
            { requester: request.recipient, recipient: request.requester }
          ],
          status: 'pending'
        },
        { status: 'cancelled' }
      );
    } catch (cErr) {
      console.warn('[Friendship] Connection cancel sync warning:', cErr.message);
    }

    // Live WebSocket Handshake Notification
    try {
      const { getIO } = require('../socket');
      const io = req.app?.get('io') || getIO();
      if (io) {
        const payload = {
          type: 'friend_cancelled',
          partnerId: userId.toString(),
          targetUserId: request.recipient.toString(),
          status: 'CANCELLED',
          isFriend: false
        };
        io.to(`user:${request.recipient.toString()}`).emit('friendship:status_changed', payload);
        io.to(`user:${request.recipient.toString()}`).emit('friend:cancelled', payload);
      }
    } catch (ioErr) {
      console.warn('[Friendship] Socket broadcast warning:', ioErr.message);
    }

    await request.populate([
      { path: 'requester', select: SAFE_USER_FIELDS },
      { path: 'recipient', select: SAFE_USER_FIELDS }
    ]);

    const formatted = formatFriendshipForState(request, userId);
    return successResponse(res, formatted, 'Friend request cancelled successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * 5. Remove friendship (Unfriend)
 * DELETE /friends/:friendId
 * Rule: Do not destroy historical records simply because a friendship is removed!
 * Status transitions to REMOVED with removed_at timestamp preserved.
 */
const unfriend = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { friendId } = req.params;

    if (!friendId || !mongoose.Types.ObjectId.isValid(friendId)) {
      return errorResponse(res, 'Invalid friend ID.', 400);
    }

    if (userId.toString() === friendId.toString()) {
      return errorResponse(res, 'You cannot unfriend yourself.', 400);
    }

    let friendship = await Friendship.findOne({
      status: 'ACCEPTED',
      $or: [
        { requester: userId, recipient: friendId },
        { requester: friendId, recipient: userId }
      ]
    });

    if (!friendship) {
      friendship = await Friendship.findOne({
        _id: friendId,
        status: 'ACCEPTED',
        $or: [{ requester: userId }, { recipient: userId }]
      });
    }

    if (!friendship) {
      return errorResponse(res, 'Friendship not found or you are not currently friends with this user.', 404);
    }

    // Transition state to REMOVED (permanently keeps history)
    friendship.status = 'REMOVED';
    friendship.actionUserId = userId;
    friendship.removed_at = new Date();
    await friendship.save();

    // Revoke messaging permission by updating Connection status
    try {
      const Connection = require('../models/Connection');
      await Connection.updateMany(
        {
          $or: [
            { requester: userId, recipient: friendId },
            { requester: friendId, recipient: userId }
          ]
        },
        { status: 'cancelled' }
      );
    } catch (e) {
      console.warn('[Friendship] Revoke connection warning:', e.message);
    }

    await friendship.populate([
      { path: 'requester', select: SAFE_USER_FIELDS },
      { path: 'recipient', select: SAFE_USER_FIELDS }
    ]);

    // STRICT SECURITY: Immediately revoke active voice session if friends were in voice
    try {
      const { revokeVoiceSessionOnAuthLoss } = require('../socket/voiceHandler');
      const { getIO } = require('../socket');
      const io = req.app?.get('io') || getIO();
      if (io) {
        revokeVoiceSessionOnAuthLoss(userId, friendId, io, 'unfriended');
      }
    } catch (vErr) {
      console.warn('[Friendship] Error revoking voice session on unfriend:', vErr.message);
    }

    // Live WebSocket Handshake Notification
    try {
      const { getIO } = require('../socket');
      const io = req.app?.get('io') || getIO();
      if (io) {
        const payload = {
          type: 'friend_removed',
          partnerId: userId.toString(),
          targetUserId: friendId.toString(),
          status: 'REMOVED',
          isFriend: false
        };
        io.to(`user:${friendId.toString()}`).emit('friendship:status_changed', payload);
        io.to(`user:${friendId.toString()}`).emit('friend:removed', payload);
        io.to(`user:${userId.toString()}`).emit('friendship:status_changed', payload);
        io.to(`user:${userId.toString()}`).emit('friend:removed', payload);
      }
    } catch (ioErr) {
      console.warn('[Friendship] Socket broadcast warning:', ioErr.message);
    }

    const formatted = formatFriendshipForState(friendship, userId);
    return successResponse(res, formatted, 'Friend removed from your active friends list.');
  } catch (error) {
    next(error);
  }
};


/**
 * 6. Get active friends list
 * GET /friends
 */
const getFriends = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    const search = (req.query.search || req.query.q || '').trim();

    const query = {
      status: 'ACCEPTED',
      $or: [{ requester: userId }, { recipient: userId }]
    };

    const friendships = await Friendship.find(query)
      .populate('requester', SAFE_USER_FIELDS)
      .populate('recipient', SAFE_USER_FIELDS)
      .sort({ accepted_at: -1, updated_at: -1 });

    let friends = friendships.map((f) => {
      const isRequester = (f.requester?._id || f.requester)?.toString() === userId.toString();
      const friendUser = isRequester ? f.recipient : f.requester;
      const userObj = friendUser?.toObject ? friendUser.toObject() : (friendUser || {});
      return {
        ...userObj,
        _id: userObj._id || userObj.id,
        friendshipId: f._id,
        created_at: f.created_at,
        accepted_at: f.accepted_at,
        friend: userObj
      };
    });

    if (search) {
      const sLower = search.toLowerCase();
      friends = friends.filter((item) => {
        const u = item.friend || item;
        return (
          (u.name && u.name.toLowerCase().includes(sLower)) ||
          (u.displayName && u.displayName.toLowerCase().includes(sLower)) ||
          (u.email && u.email.toLowerCase().includes(sLower)) ||
          (u.city && u.city.toLowerCase().includes(sLower)) ||
          (u.major && u.major.toLowerCase().includes(sLower))
        );
      });
    }

    const total = friends.length;
    const paginated = friends.slice(skip, skip + limit);

    return successResponse(
      res,
      paginated,
      'Friends list retrieved successfully.',
      200,
      {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 7. Get incoming pending requests (RECEIVED REQUESTS)
 * GET /friends/requests
 */
const getIncomingRequests = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const requests = await Friendship.find({
      recipient: userId,
      status: 'PENDING'
    })
      .populate('requester', SAFE_USER_FIELDS)
      .sort({ created_at: -1 });

    const formatted = requests.map((r) => formatFriendshipForState(r, userId));
    return successResponse(res, formatted, 'Incoming friend requests retrieved successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * 8. Get sent requests (SENT REQUESTS: Pending, Cancelled, Declined)
 * GET /friends/requests/sent
 */
const getSentRequests = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const statusFilter = req.query.status; // Optional ?status=PENDING

    const query = {
      requester: userId
    };

    if (statusFilter && ['PENDING', 'CANCELLED', 'DECLINED'].includes(statusFilter.toUpperCase())) {
      query.status = statusFilter.toUpperCase();
    } else {
      // By default show pending and recent cancelled/declined sent requests
      query.status = { $in: ['PENDING', 'CANCELLED', 'DECLINED'] };
    }

    const sentRequests = await Friendship.find(query)
      .populate('recipient', SAFE_USER_FIELDS)
      .sort({ created_at: -1 });

    const formatted = sentRequests.map((r) => formatFriendshipForState(r, userId));
    return successResponse(res, formatted, 'Sent friend requests retrieved successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * 9. Get complete friendship and request history (HISTORY)
 * GET /friends/history
 */
const getFriendshipHistory = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const query = {
      $or: [{ requester: userId }, { recipient: userId }]
    };

    const total = await Friendship.countDocuments(query);
    const history = await Friendship.find(query)
      .populate('requester', SAFE_USER_FIELDS)
      .populate('recipient', SAFE_USER_FIELDS)
      .populate('actionUserId', 'name _id email')
      .sort({ updated_at: -1 })
      .skip(skip)
      .limit(limit);

    const formatted = history.map((item) => formatFriendshipForState(item, userId));

    return successResponse(
      res,
      formatted,
      'Friendship history retrieved successfully.',
      200,
      {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 10. Block a user relationship
 * POST /friends/:targetUserId/block
 */
const blockUserRelationship = async (req, res, next) => {
  try {
    const blockerId = req.user._id;
    const { targetUserId } = req.params;

    if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return errorResponse(res, 'Invalid target user ID.', 400);
    }

    if (blockerId.toString() === targetUserId.toString()) {
      return errorResponse(res, 'You cannot block yourself.', 400);
    }

    // Persist in Block model
    await Block.findOneAndUpdate(
      { blocker: blockerId, blocked: targetUserId },
      { blocker: blockerId, blocked: targetUserId, reason: req.body.reason || 'User preference' },
      { upsert: true, new: true }
    );

    // Update or create Friendship record with status BLOCKED
    let friendship = await Friendship.findOne({
      $or: [
        { requester: blockerId, recipient: targetUserId },
        { requester: targetUserId, recipient: blockerId }
      ]
    });

    if (friendship) {
      friendship.status = 'BLOCKED';
      friendship.actionUserId = blockerId;
      friendship.blocked_at = new Date();
      await friendship.save();
    } else {
      friendship = await Friendship.create({
        requester: blockerId,
        recipient: targetUserId,
        status: 'BLOCKED',
        actionUserId: blockerId,
        blocked_at: new Date()
      });
    }

    try {
      const Connection = require('../models/Connection');
      await Connection.updateMany(
        {
          $or: [
            { requester: blockerId, recipient: targetUserId },
            { requester: targetUserId, recipient: blockerId }
          ]
        },
        { status: 'cancelled' }
      );
    } catch (e) {
      console.warn('[Friendship] Revoke connection on block warning:', e.message);
    }

    await friendship.populate([
      { path: 'requester', select: SAFE_USER_FIELDS },
      { path: 'recipient', select: SAFE_USER_FIELDS }
    ]);

    // STRICT SECURITY: Immediately terminate voice session, close WebRTC, and clear co-seated context on block
    try {
      const { revokeVoiceSessionOnAuthLoss } = require('../socket/voiceHandler');
      const { getIO } = require('../socket');
      const io = req.app?.get('io') || getIO();
      if (io) {
        revokeVoiceSessionOnAuthLoss(blockerId, targetUserId, io, 'blocked');
      }
    } catch (vErr) {
      console.warn('[Friendship] Error revoking voice session on block:', vErr.message);
    }

    const formatted = formatFriendshipForState(friendship, blockerId);
    return successResponse(res, formatted, 'User blocked successfully.');
  } catch (error) {
    next(error);
  }
};


/**
 * 11. Unblock a user relationship
 * POST /friends/:targetUserId/unblock
 */
const unblockUserRelationship = async (req, res, next) => {
  try {
    const blockerId = req.user._id;
    const { targetUserId } = req.params;

    if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return errorResponse(res, 'Invalid target user ID.', 400);
    }

    await Block.deleteOne({ blocker: blockerId, blocked: targetUserId });

    const friendship = await Friendship.findOne({
      status: 'BLOCKED',
      actionUserId: blockerId,
      $or: [
        { requester: blockerId, recipient: targetUserId },
        { requester: targetUserId, recipient: blockerId }
      ]
    });

    if (friendship) {
      friendship.status = 'CANCELLED';
      friendship.actionUserId = blockerId;
      friendship.cancelled_at = new Date();
      await friendship.save();
    }

    return successResponse(res, null, 'User unblocked successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * 12. Get blocked users list
 * GET /friends/blocked
 */
const getBlockedUsers = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const blocks = await Block.find({ blocker: userId })
      .populate('blocked', SAFE_USER_FIELDS)
      .sort({ createdAt: -1 });

    const blockedList = blocks.map((b) => ({
      blockId: b._id,
      blockedUser: b.blocked,
      reason: b.reason,
      blocked_at: b.createdAt
    }));

    return successResponse(res, blockedList, 'Blocked users retrieved successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * 13. Get friendship & permission status between authenticated user and a target user
 * GET /friends/status/:targetUserId
 *
 * Verifies backend permissions:
 * - Simply being near another player does NOT grant messaging or voice permissions.
 * - Sitting beside someone does NOT automatically make them friends.
 * - Proximity is only a world interaction. Friendship controls communication permissions.
 */
const getFriendshipStatus = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const { targetUserId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return errorResponse(res, 'Invalid target user ID.', 400);
    }

    if (currentUserId.toString() === targetUserId.toString()) {
      return successResponse(res, {
        isSelf: true,
        status: 'SELF',
        canMessage: false,
        canVoice: false,
        canAddFriend: false
      });
    }

    const targetUser = await User.findById(targetUserId).select(SAFE_USER_FIELDS);
    if (!targetUser) {
      return errorResponse(res, 'Target user not found.', 404);
    }

    // Check Block records
    const isBlocked = await Block.findOne({
      $or: [
        { blocker: currentUserId, blocked: targetUserId },
        { blocker: targetUserId, blocked: currentUserId }
      ]
    });

    const iBlockedThem = isBlocked && isBlocked.blocker.toString() === currentUserId.toString();
    const theyBlockedMe = isBlocked && isBlocked.blocker.toString() === targetUserId.toString();

    // Find latest friendship record between the two
    const friendship = await Friendship.findOne({
      $or: [
        { requester: currentUserId, recipient: targetUserId },
        { requester: targetUserId, recipient: currentUserId }
      ]
    }).sort({ updatedAt: -1 });

    let status = 'NONE';
    let isFriend = false;
    let isPendingSent = false;
    let isPendingReceived = false;
    let requestId = null;
    let friendshipId = friendship ? friendship._id : null;

    if (isBlocked || (friendship && friendship.status === 'BLOCKED')) {
      status = 'BLOCKED';
    } else if (friendship) {
      if (friendship.status === 'ACCEPTED') {
        status = 'ACCEPTED';
        isFriend = true;
      } else if (friendship.status === 'PENDING') {
        if (friendship.requester.toString() === currentUserId.toString()) {
          status = 'PENDING_SENT';
          isPendingSent = true;
          requestId = friendship._id;
        } else {
          status = 'PENDING_RECEIVED';
          isPendingReceived = true;
          requestId = friendship._id;
        }
      } else {
        status = friendship.status; // DECLINED, CANCELLED, REMOVED
      }
    }

    // Strict Backend Permission Calculation:
    // Only accepted friends can message or voice! Proximity never grants messaging.
    const canMessage = isFriend && !isBlocked;
    const canVoice = isFriend && !isBlocked;
    const canAddFriend = !isFriend && !isPendingSent && !isPendingReceived && !isBlocked;

    return successResponse(
      res,
      {
        targetUser: {
          _id: targetUser._id,
          name: targetUser.name || targetUser.displayName,
          displayName: targetUser.displayName || targetUser.name,
          avatar: targetUser.avatar,
          bio: targetUser.bio,
          city: targetUser.city,
          isOnline: targetUser.isOnline || targetUser.onlineStatus === 'online'
        },
        status,
        friendshipId,
        requestId,
        isFriend,
        isPendingSent,
        isPendingReceived,
        isBlocked: !!isBlocked,
        iBlockedThem,
        theyBlockedMe,
        canMessage,
        canVoice,
        canAddFriend,
        timestamps: friendship
          ? {
              created_at: friendship.created_at,
              accepted_at: friendship.accepted_at,
              declined_at: friendship.declined_at,
              cancelled_at: friendship.cancelled_at,
              removed_at: friendship.removed_at,
              blocked_at: friendship.blocked_at
            }
          : null
      },
      'Friendship status retrieved successfully.'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  unfriend,
  getFriends,
  getIncomingRequests,
  getSentRequests,
  getFriendshipHistory,
  blockUserRelationship,
  unblockUserRelationship,
  getBlockedUsers,
  getFriendshipStatus
};
