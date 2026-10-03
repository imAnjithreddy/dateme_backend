const Connection = require('../models/Connection');
const Notification = require('../models/Notification');
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
      if (connection.status === 'pending') {
        // If the other user already sent a request to me, auto-accept it to form a match!
        if (connection.requester.toString() === finalRecipientId) {
          connection.status = 'accepted';
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

          // Notify the other user that mutual connection & match formed
          await Notification.create({
            recipient: finalRecipientId,
            sender: req.user._id,
            type: 'connection_accepted',
            title: 'Mutual Match Sparked! 💕',
            message: `${req.user.name} and you are now matched! Start a conversation in Whispers.`,
            data: { connectionId: connection._id, matchId: match._id, actionUrl: '/messages' }
          });

          return successResponse(res, { connection, match }, `Mutual spark! You matched with ${recipient.name}.`, 200);
        }
        return errorResponse(res, 'A connection request is already pending.', 400);
      }

      // Re-activate if was passed, declined, or cancelled
      connection.status = 'pending';
      connection.requester = req.user._id;
      connection.recipient = finalRecipientId;
      connection.connectionOrigin = connectionOrigin;
      connection.campusZone = campusZone;
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

    // Create notification for recipient
    await Notification.create({
      recipient: finalRecipientId,
      sender: req.user._id,
      type: 'connection_request',
      title: 'New Connection Request',
      message: `${req.user.name} wants to connect with you.`,
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

      // Create notification for requester
      await Notification.create({
        recipient: connection.requester._id,
        sender: req.user._id,
        type: 'connection_accepted',
        title: 'Connection Accepted! 🎉',
        message: `${req.user.name} accepted your connection request! Start a conversation in Whispers.`,
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
      await connection.save();

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
            isFriend: false
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

    await Connection.findOneAndUpdate(
      { requester: req.user._id, recipient: targetUserId },
      { requester: req.user._id, recipient: targetUserId, status: 'passed' },
      { upsert: true, new: true }
    );

    return successResponse(res, null, 'User passed.');
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
  passUser
};
