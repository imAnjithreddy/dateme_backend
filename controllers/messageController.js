const Message = require('../models/Message');
const Connection = require('../models/Connection');
const Match = require('../models/Match');
const Block = require('../models/Block');
const Notification = require('../models/Notification');
const { successResponse, errorResponse } = require('../utils/apiResponse');

/**
 * Get active conversations (accepted connections & matches)
 * GET /api/messages/conversations
 */
const getConversations = async (req, res, next) => {
  try {
    // Get blocked IDs
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
      .populate('requester', 'name displayName avatar onlineStatus city bio')
      .populate('recipient', 'name displayName avatar onlineStatus city bio')
      .sort({ updatedAt: -1 });

    const conversations = await Promise.all(
      connections
        .filter((conn) => {
          const isReq = conn.requester._id.toString() === req.user._id.toString();
          const partner = isReq ? conn.recipient : conn.requester;
          return !blockedIds.includes(partner._id.toString());
        })
        .map(async (conn) => {
          const isRequester = conn.requester._id.toString() === req.user._id.toString();
          const partner = isRequester ? conn.recipient : conn.requester;

          const lastMessage = await Message.findOne({ connection: conn._id }).sort({ createdAt: -1 });

          const unreadCount = await Message.countDocuments({
            connection: conn._id,
            recipient: req.user._id,
            isRead: false
          });

          // Find associated match if any
          const match = await Match.findOne({
            users: { $all: [req.user._id, partner._id] },
            status: { $ne: 'unmatched' }
          });

          return {
            connectionId: conn._id,
            matchId: match ? match._id : null,
            partner,
            lastMessage: lastMessage ? lastMessage.text : 'Connected! Start a conversation.',
            lastMessageTime: lastMessage ? lastMessage.createdAt : conn.updatedAt,
            unreadCount
          };
        })
    );

    return successResponse(res, { conversations }, 'Conversations retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Get messages inside a connection / match
 * GET /api/messages/:connectionId
 */
const getMessages = async (req, res, next) => {
  try {
    const { connectionId } = req.params;

    // Check if connectionId is a connection or match ID
    let connection = await Connection.findById(connectionId)
      .populate('requester', 'name displayName avatar age city onlineStatus bio')
      .populate('recipient', 'name displayName avatar age city onlineStatus bio');

    let match = null;
    if (!connection) {
      match = await Match.findById(connectionId).populate(
        'users',
        'name displayName avatar age city onlineStatus bio'
      );
      if (match && match.connection) {
        connection = await Connection.findById(match.connection)
          .populate('requester', 'name displayName avatar age city onlineStatus bio')
          .populate('recipient', 'name displayName avatar age city onlineStatus bio');
      }
    }

    if (!connection) {
      return errorResponse(res, 'Conversation not found.', 404);
    }

    const isMember =
      connection.requester._id.toString() === req.user._id.toString() ||
      connection.recipient._id.toString() === req.user._id.toString();

    if (!isMember) {
      return errorResponse(res, 'You are not authorized to view this conversation.', 403);
    }

    const isRequester = connection.requester._id.toString() === req.user._id.toString();
    const partner = isRequester ? connection.recipient : connection.requester;

    // Check blocks
    const isBlocked = await Block.findOne({
      $or: [
        { blocker: req.user._id, blocked: partner._id },
        { blocker: partner._id, blocked: req.user._id }
      ]
    });
    if (isBlocked) {
      return errorResponse(res, 'This conversation is unavailable due to privacy restrictions.', 403);
    }

    if (connection.status !== 'accepted') {
      return errorResponse(res, 'Only accepted campus connections can access private messages.', 403);
    }

    // Mark unread messages as read
    await Message.updateMany(
      { connection: connection._id, recipient: req.user._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    const messages = await Message.find({ connection: connection._id })
      .populate('sender', 'name displayName avatar')
      .sort({ createdAt: 1 })
      .limit(200);

    return successResponse(
      res,
      { messages, partner, connectionId: connection._id, connection },
      'Messages retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Send private message to an accepted connection
 * POST /api/messages/:connectionId
 */
const sendMessage = async (req, res, next) => {
  try {
    const { connectionId } = req.params;
    const { text } = req.body;

    if (!text || !String(text).trim()) {
      return errorResponse(res, 'Message text is required.', 400);
    }

    let connection = await Connection.findById(connectionId);
    if (!connection) {
      const match = await Match.findById(connectionId);
      if (match && match.connection) {
        connection = await Connection.findById(match.connection);
      }
    }

    if (!connection) {
      return errorResponse(res, 'Conversation not found.', 404);
    }

    const isMember =
      connection.requester.toString() === req.user._id.toString() ||
      connection.recipient.toString() === req.user._id.toString();

    if (!isMember) {
      return errorResponse(res, 'You are not a member of this conversation.', 403);
    }

    const recipientId =
      connection.requester.toString() === req.user._id.toString()
        ? connection.recipient
        : connection.requester;

    // Check blocks
    const isBlocked = await Block.findOne({
      $or: [
        { blocker: req.user._id, blocked: recipientId },
        { blocker: recipientId, blocked: req.user._id }
      ]
    });
    if (isBlocked) {
      return errorResponse(res, 'Unable to message this user.', 403);
    }

    if (connection.status !== 'accepted') {
      return errorResponse(res, 'Only accepted connections can message.', 403);
    }

    const message = await Message.create({
      connection: connection._id,
      sender: req.user._id,
      recipient: recipientId,
      text: text.trim().substring(0, 1000)
    });

    // Update connection timestamp
    connection.updatedAt = new Date();
    await connection.save();

    // Update match lastInteraction
    await Match.findOneAndUpdate(
      { users: { $all: [req.user._id, recipientId] } },
      { lastInteraction: new Date() }
    );

    // Create notification for recipient
    await Notification.create({
      recipient: recipientId,
      sender: req.user._id,
      type: 'new_message',
      title: 'New Whisper Message',
      message: `${req.user.name}: "${text.trim().substring(0, 60)}"`,
      data: { connectionId: connection._id, actionUrl: `/messages?connectionId=${connection._id}` }
    });

    const populated = await Message.findById(message._id).populate('sender', 'name displayName avatar');

    // Real-time socket broadcast for instant recipient delivery
    try {
      const { getIO } = require('../socket');
      const io = req.app?.get('io') || getIO();
      if (io) {
        const formattedMsg = {
          _id: populated._id.toString(),
          message_id: populated._id.toString(),
          connectionId: connection._id.toString(),
          conversation_id: connection._id.toString(),
          sender_id: populated.sender?._id?.toString() || req.user._id.toString(),
          sender: populated.sender,
          receiver_id: recipientId.toString(),
          content: populated.text,
          text: populated.text,
          created_at: populated.createdAt,
          createdAt: populated.createdAt,
          isRead: false
        };

        const payload = {
          connectionId: connection._id.toString(),
          conversation_id: connection._id.toString(),
          message: populated,
          ...formattedMsg
        };

        io.to(`user:${recipientId.toString()}`).emit('message_received', payload);
        io.to(`user:${req.user._id.toString()}`).emit('message_sent', payload);
      }
    } catch (sockErr) {
      console.warn('[messageController] Socket broadcast warning:', sockErr.message);
    }

    return successResponse(res, { message: populated }, 'Message sent', 201);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getConversations,
  getMessages,
  sendMessage
};
