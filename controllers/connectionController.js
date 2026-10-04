const Connection = require('../models/Connection');
const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');
const User = require('../models/User');
const Match = require('../models/Match');
const Block = require('../models/Block');
const { successResponse, errorResponse } = require('../utils/apiResponse');

/**
 * Send connection request from User A to User B
 * POST /api/connections/request
 */
const sendRequest = async (req, res, next) => {
  try {
    const { recipientId, targetUserId, connectionOrigin = 'discovery_feed', campusZone = 'central-quad' } = req.body;
    const finalRecipientId = recipientId || targetUserId;

    if (!finalRecipientId) {
      return errorResponse(res, 'Recipient ID is required.', 400);
    }

    if (finalRecipientId === req.user._id.toString()) {
      return errorResponse(res, 'You cannot connect with yourself.', 400);
    }

    // Check blocking restrictions
    const isBlocked = await Block.findOne({
      $or: [
        { blocker: req.user._id, blocked: finalRecipientId },
        { blocker: finalRecipientId, blocked: req.user._id }
      ]
    });
    if (isBlocked) {
      return errorResponse(res, 'Unable to send connection request to this user.', 403);
    }

    const recipient = await User.findById(finalRecipientId);
    if (!recipient || recipient.isSuspended || recipient.isBlocked) {
      return errorResponse(res, 'Target campus member not found or unavailable.', 404);
    }

    // Check account restrictions
    if (req.user.restrictions && req.user.restrictions.canSendRequests === false) {
      return errorResponse(res, 'Your account is restricted from sending connection requests.', 403);
    }

    // Enforce 25 connection requests per 24 hours anti-spam limit
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sentCount = await Connection.countDocuments({
      requester: req.user._id,
      createdAt: { $gte: oneDayAgo }
    });
    if (sentCount >= 25) {
      return errorResponse(res, 'Daily connection request limit reached (25/day). Please try again tomorrow to maintain campus safety.', 429);
    }

    // Check existing connection in either direction
    let connection = await Connection.findOne({
      $or: [
        { requester: req.user._id, recipient: finalRecipientId },
        { requester: finalRecipientId, recipient: req.user._id }
      ]
    });

    if (connection) {
      if (connection.status === 'accepted') {
        return successResponse(res, { connection }, 'You are already connected with this student.', 200);
      }

      // Enforce 7-Day cooldown if the request was declined
      if (connection.status === 'declined' && connection.declinedAt) {
        const cooldownMs = 7 * 24 * 60 * 60 * 1000;
        const elapsed = Date.now() - new Date(connection.declinedAt).getTime();
        if (elapsed < cooldownMs) {
          const daysLeft = Math.ceil((cooldownMs - elapsed) / (24 * 60 * 60 * 1000));
          return errorResponse(res, `Connection request was not accepted. You can try again in ${daysLeft} day${daysLeft > 1 ? 's' : ''}.`, 400);
        }
      }

      if (connection.status === 'pending') {
        // If the other user already sent a request to me, auto-accept it to form a match!
        if (connection.requester.toString() === finalRecipientId) {
          connection.status = 'accepted';
          connection.declinedAt = null;
          connection.cooldownUntil = null;
          await connection.save();

          // Create / activate MATCH
          let match = await Match.findOne({ users: { $all: [req.user._id, finalRecipientId] } });
          if (!match) {
            match = await Match.create({
              users: [req.user._id, finalRecipientId],
              connection: connection._id,
              status: 'active',
              lastInteraction: new Date()
            });
          } else {
            match.status = 'active';
            match.connection = connection._id;
            match.lastInteraction = new Date();
            await match.save();
          }

          // Clean up pending notifications
          await Notification.deleteMany({
            recipient: req.user._id,
            sender: finalRecipientId,
            type: { $in: ['connection_request', 'friend_request'] }
          });

          // Notify the other user that mutual connection & match formed
          await notificationService.createAndEmitNotification({
            recipient: finalRecipientId,
            sender: req.user._id,
            type: 'connection_accepted',
            title: 'Connection Accepted! 💕',
            message: `${req.user.name} accepted your connection request. You are now campus friends and can chat!`,
            data: { connectionId: connection._id, matchId: match._id, actionUrl: '/messages' }
          });

          return successResponse(res, { connection, match }, `Mutual spark! You matched with ${recipient.name}.`, 200);
        }
        return errorResponse(res, 'A connection request is already pending.', 400);
      }

      // Re-activate if was passed, declined (after cooldown), or cancelled
      connection.status = 'pending';
      connection.requester = req.user._id;
      connection.recipient = finalRecipientId;
      connection.connectionOrigin = connectionOrigin;
      connection.campusZone = campusZone;
      connection.declinedAt = null;
      connection.cooldownUntil = null;
      await connection.save();
    } else {
      connection = await Connection.create({
        requester: req.user._id,
        recipient: finalRecipientId,
        status: 'pending',
        connectionOrigin,
        campusZone
      });
    }

    // Clean up any old notifications between this pair
    await Notification.deleteMany({
      recipient: finalRecipientId,
      sender: req.user._id,
      type: { $in: ['connection_request', 'friend_request'] }
    });

    // Create notification for recipient
    await notificationService.createAndEmitNotification({
      recipient: finalRecipientId,
      sender: req.user._id,
      type: 'connection_request',
      title: 'Campus Connection Request',
      message: `${req.user.name} wants to connect with you!`,
      data: {
        connectionId: connection._id,
        actionUrl: '/notifications'
      }
    });

    // Bidirectional Sync: Also ensure pending Friendship exists
    try {
      const Friendship = require('../models/Friendship');
      let friendship = await Friendship.findOne({
        $or: [
          { requester: req.user._id, recipient: finalRecipientId },
          { requester: finalRecipientId, recipient: req.user._id }
        ]
      });
      if (!friendship) {
        await Friendship.create({
          requester: req.user._id,
          recipient: finalRecipientId,
          status: 'PENDING',
          actionUserId: req.user._id
        });
      } else if (friendship.status !== 'ACCEPTED') {
        friendship.requester = req.user._id;
        friendship.recipient = finalRecipientId;
        friendship.status = 'PENDING';
        friendship.actionUserId = req.user._id;
        await friendship.save();
      }
    } catch (fErr) {
      console.warn('[Connection] Friendship request sync warning:', fErr.message);
    }

    // Live WebSocket Handshake Notification
    try {
      const { getIO } = require('../socket');
      const io = req.app?.get('io') || getIO();
      if (io) {
        const payload = {
          type: 'connection_request',
          senderId: req.user._id.toString(),
          senderName: req.user.name,
          recipientId: finalRecipientId.toString(),
          status: 'PENDING'
        };
        io.to(`user:${finalRecipientId.toString()}`).emit('friendship:status_changed', payload);
        io.to(`user:${finalRecipientId.toString()}`).emit('friend:request_received', payload);
      }
    } catch (ioErr) {
      console.warn('[Connection] Socket broadcast warning:', ioErr.message);
    }

    return successResponse(
      res,
      { connection },
      `Connection request sent to ${recipient.name}.`,
      201
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Respond to connection request (accept / decline)
 * POST /api/connections/respond
 */
const respondRequest = async (req, res, next) => {
  try {
    const targetConnectionId = req.params.connectionId || req.body.connectionId;
    const { action } = req.body; // action: 'accept' | 'decline'

    if (!targetConnectionId || !['accept', 'decline'].includes(action)) {
      return errorResponse(res, "Please provide connectionId and valid action ('accept' or 'decline').", 400);
    }

    const connection = await Connection.findById(targetConnectionId).populate('requester', 'name avatar role');

    if (!connection) {
      return errorResponse(res, 'Connection request not found.', 404);
    }

    if (connection.recipient.toString() !== req.user._id.toString()) {
      return errorResponse(res, 'You are not authorized to respond to this request.', 403);
    }

    // Check blocking restrictions
    const isBlocked = await Block.findOne({
      $or: [
        { blocker: req.user._id, blocked: connection.requester._id },
        { blocker: connection.requester._id, blocked: req.user._id }
      ]
    });
    if (isBlocked) {
      return errorResponse(res, 'Cannot connect with blocked user.', 403);
    }

    if (action === 'accept') {
      connection.status = 'accepted';
      connection.declinedAt = null;
      connection.cooldownUntil = null;
      await connection.save();

      // Create / activate MATCH
      let match = await Match.findOne({ users: { $all: [req.user._id, connection.requester._id] } });
      if (!match) {
        match = await Match.create({
          users: [req.user._id, connection.requester._id],
          connection: connection._id,
          status: 'active',
          lastInteraction: new Date()
        });
      } else {
        match.status = 'active';
        match.connection = connection._id;
        match.lastInteraction = new Date();
        await match.save();
      }

      // Clean up related pending notifications
      await Notification.deleteMany({
        recipient: req.user._id,
        sender: connection.requester._id,
        type: { $in: ['connection_request', 'friend_request'] }
      });

      // Create canonical notification for requester
      await notificationService.createAndEmitNotification({
        recipient: connection.requester._id,
        sender: req.user._id,
        type: 'connection_accepted',
        title: 'Connection Accepted! 💕',
        message: `${req.user.name} accepted your connection request. You are now campus friends and can chat!`,
        data: {
          connectionId: connection._id,
          matchId: match._id,
          actionUrl: '/messages'
        }
      });

      // Bidirectional Sync: Also set Friendship to ACCEPTED
      try {
        const Friendship = require('../models/Friendship');
        let friendship = await Friendship.findOne({
          $or: [
            { requester: connection.requester._id, recipient: req.user._id },
            { requester: req.user._id, recipient: connection.requester._id }
          ]
        });
        if (friendship) {
          friendship.status = 'ACCEPTED';
          friendship.accepted_at = new Date();
          friendship.actionUserId = req.user._id;
          await friendship.save();
        } else {
          await Friendship.create({
            requester: connection.requester._id,
            recipient: req.user._id,
            status: 'ACCEPTED',
            actionUserId: req.user._id,
            accepted_at: new Date()
          });
        }
      } catch (fErr) {
        console.warn('[Connection] Friendship sync warning:', fErr.message);
      }

      // Live WebSocket Handshake Notification
      try {
        const { getIO } = require('../socket');
        const io = req.app?.get('io') || getIO();
        if (io) {
          const payload = {
            type: 'connection_accepted',
            partnerId: req.user._id.toString(),
            partnerName: req.user.name,
            targetUserId: connection.requester._id.toString(),
            status: 'ACCEPTED',
            isFriend: true
          };
          io.to(`user:${connection.requester._id.toString()}`).emit('friendship:status_changed', payload);
          io.to(`user:${connection.requester._id.toString()}`).emit('friend:accepted', payload);
          io.to(`user:${req.user._id.toString()}`).emit('friendship:status_changed', payload);
          io.to(`user:${req.user._id.toString()}`).emit('friend:accepted', payload);
        }
      } catch (ioErr) {
        console.warn('[Connection] Socket broadcast warning:', ioErr.message);
      }

      return successResponse(
        res,
        { connection, match },
        `You are now connected with ${connection.requester.name}!`
      );
    } else {
      connection.status = 'declined';
      connection.declinedAt = new Date();
      connection.cooldownUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await connection.save();

      // Clean up related pending notifications
      await Notification.deleteMany({
        recipient: req.user._id,
        sender: connection.requester._id,
        type: { $in: ['connection_request', 'friend_request'] }
      });

      // Bidirectional Sync: Also update Friendship to DECLINED
      try {
        const Friendship = require('../models/Friendship');
        await Friendship.updateMany(
          {
            $or: [
              { requester: connection.requester._id, recipient: req.user._id },
              { requester: req.user._id, recipient: connection.requester._id }
            ],
            status: 'PENDING'
          },
          { status: 'DECLINED', actionUserId: req.user._id, declined_at: new Date() }
        );
      } catch (fErr) {
        console.warn('[Connection] Friendship decline sync warning:', fErr.message);
      }

      // Live WebSocket Handshake Notification for decline
      try {
        const { getIO } = require('../socket');
        const io = req.app?.get('io') || getIO();
        if (io) {
          const payload = {
            type: 'connection_declined',
            partnerId: req.user._id.toString(),
            targetUserId: connection.requester._id.toString(),
            status: 'DECLINED',
            isFriend: false,
            cooldownUntil: connection.cooldownUntil
          };
          io.to(`user:${connection.requester._id.toString()}`).emit('friendship:status_changed', payload);
          io.to(`user:${connection.requester._id.toString()}`).emit('friend:declined', payload);
        }
      } catch (ioErr) {
        console.warn('[Connection] Socket broadcast warning:', ioErr.message);
      }

      return successResponse(res, { connection }, 'Connection request declined.');
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel outgoing pending connection request
 * POST /api/connections/cancel
 */
const cancelRequest = async (req, res, next) => {
  try {
    const { connectionId, recipientId } = req.body;

    const query = connectionId
      ? { _id: connectionId, requester: req.user._id, status: 'pending' }
      : { requester: req.user._id, recipient: recipientId, status: 'pending' };

    const connection = await Connection.findOne(query);
    if (!connection) {
      return errorResponse(res, 'Pending connection request not found or already processed.', 404);
    }

    connection.status = 'cancelled';
    await connection.save();

    // Clean up related pending notification
    await Notification.deleteMany({
      recipient: connection.recipient,
      sender: req.user._id,
      type: 'connection_request'
    });

    return successResponse(res, { connection }, 'Connection request cancelled.');
  } catch (error) {
    next(error);
  }
};

/**
 * Remove connection / Unmatch
 * POST /api/connections/remove
 */
const removeConnection = async (req, res, next) => {
  try {
    const { connectionId, partnerId } = req.body;

    let connection;
    if (connectionId) {
      connection = await Connection.findOne({
        _id: connectionId,
        $or: [{ requester: req.user._id }, { recipient: req.user._id }]
      });
    } else if (partnerId) {
      connection = await Connection.findOne({
        $or: [
          { requester: req.user._id, recipient: partnerId },
          { requester: partnerId, recipient: req.user._id }
        ]
      });
    }

    if (!connection) {
      return errorResponse(res, 'Connection not found.', 404);
    }

    const otherUserId =
      connection.requester.toString() === req.user._id.toString()
        ? connection.recipient
        : connection.requester;

    // Set connection status to declined / unlinked
    connection.status = 'declined';
    await connection.save();

    // Set match status to unmatched
    const match = await Match.findOneAndUpdate(
      { users: { $all: [req.user._id, otherUserId] } },
      {
        status: 'unmatched',
        unmatchedBy: req.user._id,
        unmatchedAt: new Date()
      },
      { new: true }
    );

    return successResponse(res, { connection, match }, 'Connection removed successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * Get accepted connections for current user
 * GET /api/connections
 */
const getConnections = async (req, res, next) => {
  try {
    // Get blocked users
    const blocks = await Block.find({
      $or: [{ blocker: req.user._id }, { blocked: req.user._id }]
    });
    const blockedIds = blocks.map((b) =>
      b.blocker.toString() === req.user._id.toString() ? b.blocked.toString() : b.blocker.toString()
    );

    const connections = await Connection.find({
      $or: [{ requester: req.user._id }, { recipient: req.user._id }],
      status: 'accepted'
    })
      .populate('requester', 'name email age city bio avatar onlineStatus interests relationshipIntent faculty education')
      .populate('recipient', 'name email age city bio avatar onlineStatus interests relationshipIntent faculty education')
      .sort({ updatedAt: -1 });

    // Filter out any blocked user connections
    const filtered = connections.filter((conn) => {
      const isReq = conn.requester._id.toString() === req.user._id.toString();
      const partner = isReq ? conn.recipient : conn.requester;
      return !blockedIds.includes(partner._id.toString());
    });

    const formatted = filtered.map((conn) => {
      const isRequester = conn.requester._id.toString() === req.user._id.toString();
      const partner = isRequester ? conn.recipient : conn.requester;
      return {
        connectionId: conn._id,
        connectedAt: conn.updatedAt,
        origin: conn.connectionOrigin,
        zone: conn.campusZone,
        partner
      };
    });

    return successResponse(res, { connections: formatted, count: formatted.length }, 'Connections retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Get pending incoming requests
 * GET /api/connections/pending
 */
const getPendingRequests = async (req, res, next) => {
  try {
    const blocks = await Block.find({
      $or: [{ blocker: req.user._id }, { blocked: req.user._id }]
    });
    const blockedIds = blocks.map((b) =>
      b.blocker.toString() === req.user._id.toString() ? b.blocked.toString() : b.blocker.toString()
    );

    const requests = await Connection.find({
      recipient: req.user._id,
      status: 'pending',
      requester: { $nin: blockedIds }
    })
      .populate('requester', 'name email age city bio avatar interests hobbies relationshipIntent faculty education level')
      .sort({ createdAt: -1 });

    return successResponse(res, { requests, count: requests.length }, 'Pending requests retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Pass a user in discovery
 * POST /api/connections/pass
 */
const passUser = async (req, res, next) => {
  try {
    const { targetUserId } = req.body;
    if (!targetUserId) {
      return errorResponse(res, 'Target user ID is required.', 400);
    }

    const existing = await Connection.findOne({
      $or: [
        { requester: req.user._id, recipient: targetUserId },
        { requester: targetUserId, recipient: req.user._id }
      ]
    });

    if (existing) {
      if (existing.status !== 'accepted') {
        existing.status = 'passed';
        existing.requester = req.user._id;
        existing.recipient = targetUserId;
        await existing.save();
      }
    } else {
      await Connection.create({
        requester: req.user._id,
        recipient: targetUserId,
        status: 'passed',
        connectionOrigin: 'discovery_feed'
      });
    }

    return successResponse(res, null, 'User passed.');
  } catch (error) {
    next(error);
  }
};

/**
 * Get active pending requests sent by the current user (Sent History)
 * GET /api/connections/sent
 */
const getSentRequests = async (req, res, next) => {
  try {
    const blocks = await Block.find({
      $or: [{ blocker: req.user._id }, { blocked: req.user._id }]
    });
    const blockedIds = blocks.map((b) =>
      b.blocker.toString() === req.user._id.toString() ? b.blocked.toString() : b.blocker.toString()
    );

    const requests = await Connection.find({
      requester: req.user._id,
      status: 'pending',
      recipient: { $nin: blockedIds }
    })
      .populate('recipient', 'name email age city bio avatar interests hobbies relationshipIntent faculty education level')
      .sort({ createdAt: -1 });

    return successResponse(res, { requests, count: requests.length }, 'Sent requests retrieved');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendRequest,
  respondRequest,
  cancelRequest,
  removeConnection,
  getConnections,
  getPendingRequests,
  getSentRequests,
  passUser
};
