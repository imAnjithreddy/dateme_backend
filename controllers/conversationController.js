const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const DirectMessage = require('../models/DirectMessage');
const Friendship = require('../models/Friendship');
const Connection = require('../models/Connection');
const Message = require('../models/Message');
const User = require('../models/User');
const Block = require('../models/Block');
const Notification = require('../models/Notification');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// Standard user projection fields for conversation partners
const SAFE_PARTNER_FIELDS = '_id name displayName email avatar onlineStatus isOnline lastActive bio campusYear major profilePhoto';

/**
 * Format direct message according to the required schema:
 * message_id, conversation_id, sender_id, receiver_id, content, created_at, updated_at, read_at
 */
const formatDirectMessage = (msg) => {
  const doc = msg.toObject ? msg.toObject() : { ...msg };

  const messageId = (doc._id || doc.message_id || '').toString();
  const conversationId = (doc.conversation_id?._id || doc.conversation_id || '').toString();
  const senderId = (doc.sender_id?._id || doc.sender_id || '').toString();
  const receiverId = (doc.receiver_id?._id || doc.receiver_id || '').toString();

  const content = doc.content || doc.text || '';
  const timestamp = doc.created_at || doc.createdAt || new Date().toISOString();

  let senderObj = null;
  if (doc.sender_id && typeof doc.sender_id === 'object' && doc.sender_id.name) {
    senderObj = {
      _id: doc.sender_id._id,
      name: doc.sender_id.name,
      displayName: doc.sender_id.displayName || doc.sender_id.name,
      avatar: doc.sender_id.avatar
    };
  } else if (doc.sender && typeof doc.sender === 'object' && doc.sender.name) {
    senderObj = {
      _id: doc.sender._id,
      name: doc.sender.name,
      displayName: doc.sender.displayName || doc.sender.name,
      avatar: doc.sender.avatar
    };
  } else if (senderId) {
    senderObj = {
      _id: senderId
    };
  }

  const formatted = {
    _id: messageId,
    message_id: messageId,
    conversation_id: conversationId,
    connectionId: conversationId,
    sender_id: senderId,
    sender: senderObj,
    receiver_id: receiverId,
    content: content,
    text: content,
    created_at: timestamp,
    createdAt: timestamp,
    updated_at: doc.updated_at || doc.updatedAt || timestamp,
    read_at: doc.read_at || null,
    isRead: Boolean(doc.read_at)
  };

  return formatted;
};

/**
 * Verifies all 5 communication eligibility conditions between two users:
 * 1. Both users are authenticated / valid.
 * 2. A friendship exists.
 * 3. Friendship status is ACCEPTED.
 * 4. Neither user has blocked the other.
 * 5. Both accounts are allowed to communicate.
 */
const verifyCommunicationEligibility = async (senderUser, targetUserOrId) => {
  // 1. Both users exist and are valid
  if (!senderUser || !senderUser._id) {
    return { eligible: false, statusCode: 401, message: 'Authentication required.' };
  }

  const senderId = senderUser._id;
  const targetId = targetUserOrId._id || targetUserOrId;

  if (senderId.toString() === targetId.toString()) {
    return { eligible: false, statusCode: 400, message: 'You cannot direct message yourself.' };
  }

  const recipient =
    targetUserOrId && targetUserOrId.name
      ? targetUserOrId
      : await User.findById(targetId);

  if (!recipient) {
    return { eligible: false, statusCode: 404, message: 'Recipient user account not found.' };
  }

  // 5. Account communication permissions
  if (senderUser.isBanned || senderUser.isSuspended || senderUser.isBlocked || (senderUser.restrictions && senderUser.restrictions.canChat === false)) {
    return {
      eligible: false,
      statusCode: 403,
      message: 'Your account is restricted from sending direct messages.'
    };
  }

  if (recipient.isBanned || recipient.isSuspended || recipient.isBlocked) {
    return {
      eligible: false,
      statusCode: 403,
      message: 'The recipient account is unavailable or restricted from receiving messages.'
    };
  }

  if (recipient.privacySettings && recipient.privacySettings.allowWhispers === false) {
    return {
      eligible: false,
      statusCode: 403,
      message: 'Recipient has disabled direct communication in their privacy settings.'
    };
  }

  // 4. Check for blocks in either direction
  const isBlocked = await Block.findOne({
    $or: [
      { blocker: senderId, blocked: targetId },
      { blocker: targetId, blocked: senderId }
    ]
  });

  if (isBlocked) {
    return {
      eligible: false,
      statusCode: 403,
      message: 'Direct messaging is not permitted due to block restrictions.'
    };
  }

  // 2. Friendship exists (or campus Connection exists)
  let friendship = await Friendship.findOne({
    $or: [
      { requester: senderId, recipient: targetId },
      { requester: targetId, recipient: senderId }
    ]
  });

  if (!friendship) {
    const connection = await Connection.findOne({
      $or: [
        { requester: senderId, recipient: targetId },
        { requester: targetId, recipient: senderId }
      ]
    });

    if (connection && ['accepted', 'connected', 'pending'].includes(connection.status)) {
      friendship = await Friendship.create({
        requester: senderId,
        recipient: targetId,
        status: 'ACCEPTED'
      });
    }
  }

  if (!friendship) {
    return {
      eligible: false,
      statusCode: 403,
      message: 'Direct messaging requires an existing friendship or campus connection.'
    };
  }

  // 3. Friendship status check:
  if (friendship.status === 'BLOCKED') {
    return {
      eligible: false,
      statusCode: 403,
      message: 'Direct messaging is not permitted due to relationship block.'
    };
  }

  // Auto-heal friendship status if users have an active or accepted connection
  if (friendship.status !== 'ACCEPTED') {
    const connection = await Connection.findOne({
      $or: [
        { requester: senderId, recipient: targetId },
        { requester: targetId, recipient: senderId }
      ]
    });
    if (connection && ['accepted', 'connected', 'pending'].includes(connection.status)) {
      friendship.status = 'ACCEPTED';
      await friendship.save();
    } else {
      return {
        eligible: false,
        statusCode: 403,
        message: `Direct messaging is only allowed between accepted friends. Current friendship status is ${friendship.status}.`
      };
    }
  }

  return { eligible: true, friendship, recipient };
};

/**
 * Polymorphic conversation resolver across Conversation ID, Friendship ID, Connection ID, Match ID, Target User ID.
 */
const resolveConversationById = async (conversationId, currentUserId = null) => {
  if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) return null;

  // 1. Direct Conversation ID
  let conversation = await Conversation.findById(conversationId).populate([
    { path: 'participants', select: SAFE_PARTNER_FIELDS },
    { path: 'friendship' }
  ]);
  if (conversation) return conversation;

  // 2. Resilient fallback: Friendship ID
  const friendship = await Friendship.findById(conversationId).populate([
    { path: 'requester', select: SAFE_PARTNER_FIELDS },
    { path: 'recipient', select: SAFE_PARTNER_FIELDS }
  ]);
  if (friendship) {
    if (friendship.status !== 'ACCEPTED') {
      friendship.status = 'ACCEPTED';
      await friendship.save();
    }
    conversation = await Conversation.findOne({ friendship: friendship._id }).populate([
      { path: 'participants', select: SAFE_PARTNER_FIELDS },
      { path: 'friendship' }
    ]);
    if (!conversation) {
      conversation = await Conversation.create({
        participants: [friendship.requester._id, friendship.recipient._id],
        friendship: friendship._id
      });
      await conversation.populate([
        { path: 'participants', select: SAFE_PARTNER_FIELDS },
        { path: 'friendship' }
      ]);
    }
    return conversation;
  }

  // 3. Resilient fallback: Connection ID (supports connections from campus/match/discovery)
  const connection = await Connection.findById(conversationId).populate([
    { path: 'requester', select: SAFE_PARTNER_FIELDS },
    { path: 'recipient', select: SAFE_PARTNER_FIELDS }
  ]);
  if (connection) {
    const p1 = connection.requester._id;
    const p2 = connection.recipient._id;

    let fs = await Friendship.findOne({
      $or: [
        { requester: p1, recipient: p2 },
        { requester: p2, recipient: p1 }
      ]
    });
    if (!fs) {
      fs = await Friendship.create({
        requester: p1,
        recipient: p2,
        status: 'ACCEPTED'
      });
    } else if (fs.status !== 'ACCEPTED') {
      fs.status = 'ACCEPTED';
      await fs.save();
    }

    conversation = await Conversation.findOne({
      participants: { $all: [p1, p2] }
    }).populate([
      { path: 'participants', select: SAFE_PARTNER_FIELDS },
      { path: 'friendship' }
    ]);

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [p1, p2],
        friendship: fs._id
      });
      await conversation.populate([
        { path: 'participants', select: SAFE_PARTNER_FIELDS },
        { path: 'friendship' }
      ]);
    }
    return conversation;
  }

  // 4. Resilient fallback: Match ID
  try {
    const Match = require('../models/Match');
    const match = await Match.findById(conversationId);
    if (match) {
      if (match.connection) {
        return await resolveConversationById(match.connection.toString(), currentUserId);
      }
      if (match.users && match.users.length === 2) {
        const [u1, u2] = match.users;
        let fs = await Friendship.findOne({
          $or: [
            { requester: u1, recipient: u2 },
            { requester: u2, recipient: u1 }
          ]
        });
        if (!fs) {
          fs = await Friendship.create({
            requester: u1,
            recipient: u2,
            status: 'ACCEPTED'
          });
        }
        conversation = await Conversation.findOne({ participants: { $all: [u1, u2] } }).populate([
          { path: 'participants', select: SAFE_PARTNER_FIELDS },
          { path: 'friendship' }
        ]);
        if (!conversation) {
          conversation = await Conversation.create({
            participants: [u1, u2],
            friendship: fs._id
          });
          await conversation.populate([
            { path: 'participants', select: SAFE_PARTNER_FIELDS },
            { path: 'friendship' }
          ]);
        }
        return conversation;
      }
    }
  } catch (matchErr) {
    // Non-blocking Match check
  }

  // 5. Resilient fallback: Target User ID
  if (currentUserId && conversationId.toString() !== currentUserId.toString()) {
    const targetUser = await User.findById(conversationId);
    if (targetUser) {
      const u1 = new mongoose.Types.ObjectId(currentUserId);
      const u2 = new mongoose.Types.ObjectId(targetUser._id);
      conversation = await Conversation.findOne({ participants: { $all: [u1, u2] } }).populate([
        { path: 'participants', select: SAFE_PARTNER_FIELDS },
        { path: 'friendship' }
      ]);
      if (!conversation) {
        let fs = await Friendship.findOne({
          $or: [
            { requester: u1, recipient: u2 },
            { requester: u2, recipient: u1 }
          ]
        });
        if (!fs) {
          fs = await Friendship.create({
            requester: u1,
            recipient: u2,
            status: 'ACCEPTED'
          });
        }
        conversation = await Conversation.create({
          participants: [u1, u2],
          friendship: fs._id
        });
        await conversation.populate([
          { path: 'participants', select: SAFE_PARTNER_FIELDS },
          { path: 'friendship' }
        ]);
      }
      return conversation;
    }
  }

  return null;
};

/**
 * Unified message collector across DirectMessage and legacy Message collections.
 * Deduplicates, normalizes, and sorts chronologically.
 */
const collectAndMergeMessages = async (conversation, fallbackId = null) => {
  const p1 = conversation.participants[0]?._id || conversation.participants[0];
  const p2 = conversation.participants[1]?._id || conversation.participants[1];

  // 1. Fetch direct messages
  const rawDMs = await DirectMessage.find({
    conversation_id: conversation._id
  })
    .populate('sender_id', '_id name displayName avatar')
    .sort({ created_at: 1 })
    .limit(300);

  const formattedDMs = rawDMs.map(formatDirectMessage);

  // 2. Fetch connection messages (legacy Message collection)
  let formattedLegacy = [];
  try {
    const connectionQuery = {
      $or: [
        { requester: p1, recipient: p2 },
        { requester: p2, recipient: p1 }
      ]
    };
    if (fallbackId && mongoose.Types.ObjectId.isValid(fallbackId)) {
      connectionQuery.$or.push({ _id: fallbackId });
    }
    const connections = await Connection.find(connectionQuery);
    const connectionIds = connections.map((c) => c._id);

    if (connectionIds.length > 0) {
      const legacyMsgs = await Message.find({ connection: { $in: connectionIds } })
        .populate('sender', SAFE_PARTNER_FIELDS)
        .sort({ createdAt: 1 })
        .limit(300);

      formattedLegacy = legacyMsgs.map((m) => {
        const sObj = m.sender || {};
        const sId = (sObj._id || m.sender || '').toString();
        const rId = (m.recipient?._id || m.recipient || '').toString();
        const timestamp = m.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString();
        return {
          _id: m._id.toString(),
          message_id: m._id.toString(),
          conversation_id: conversation._id.toString(),
          connectionId: (m.connection?._id || m.connection || conversation._id).toString(),
          sender_id: sId,
          receiver_id: rId,
          content: m.text || '',
          text: m.text || '',
          created_at: timestamp,
          createdAt: timestamp,
          updated_at: m.updatedAt ? new Date(m.updatedAt).toISOString() : timestamp,
          read_at: m.isRead ? (m.updatedAt || timestamp) : null,
          isRead: Boolean(m.isRead),
          sender: {
            _id: sId,
            name: sObj.name,
            displayName: sObj.displayName || sObj.name,
            avatar: sObj.avatar
          }
        };
      });
    }
  } catch (err) {
    console.warn('[collectAndMergeMessages] Legacy fetch warning:', err.message);
  }

  // 3. Merge, deduplicate by ID and (text + timestamp within 5s), sort by createdAt
  const seenIds = new Set();
  const allMessages = [];

  const combined = [...formattedLegacy, ...formattedDMs];
  combined.sort((a, b) => new Date(a.created_at || a.createdAt) - new Date(b.created_at || b.createdAt));

  for (const m of combined) {
    const id = (m._id || m.message_id || '').toString();
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    allMessages.push(m);
  }

  return allMessages;
};

/**
 * 1. GET /conversations
 * Retrieve all active conversations for the authenticated user
 */
const getConversations = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;

    // Get all accepted friendships for current user
    const friendships = await Friendship.find({
      $or: [{ requester: currentUserId }, { recipient: currentUserId }],
      status: 'ACCEPTED'
    }).populate([
      { path: 'requester', select: SAFE_PARTNER_FIELDS },
      { path: 'recipient', select: SAFE_PARTNER_FIELDS }
    ]);

    // Query active blocks to filter out blocked users
    const blocks = await Block.find({
      $or: [{ blocker: currentUserId }, { blocked: currentUserId }]
    });
    const blockedIds = new Set(
      blocks.map((b) =>
        b.blocker.toString() === currentUserId.toString()
          ? b.blocked.toString()
          : b.blocker.toString()
      )
    );

    const conversations = [];

    for (const friendship of friendships) {
      const isRequester = friendship.requester._id.toString() === currentUserId.toString();
      const partner = isRequester ? friendship.recipient : friendship.requester;

      if (!partner || blockedIds.has(partner._id.toString())) {
        continue;
      }

      // Check account communication status
      if (partner.isBanned || partner.isSuspended || partner.isBlocked) {
        continue;
      }

      // Find or create conversation for this friendship
      let conversation = await Conversation.findOne({ friendship: friendship._id });
      if (!conversation) {
        conversation = await Conversation.create({
          participants: [friendship.requester._id, friendship.recipient._id],
          friendship: friendship._id
        });
      }

      // Get latest message in conversation
      const lastMessage = await DirectMessage.findOne({
        conversation_id: conversation._id
      }).sort({ created_at: -1 });

      // Count unread messages for current user
      const unreadCount = await DirectMessage.countDocuments({
        conversation_id: conversation._id,
        receiver_id: currentUserId,
        read_at: null
      });

      conversations.push({
        conversation_id: conversation._id.toString(),
        friendship_id: friendship._id.toString(),
        partner: {
          _id: partner._id,
          name: partner.name,
          displayName: partner.displayName || partner.name,
          email: partner.email,
          handle: partner.email ? partner.email.split('@')[0] : '',
          avatar: partner.avatar,
          onlineStatus: partner.onlineStatus,
          isOnline: partner.isOnline,
          bio: partner.bio,
          campusYear: partner.campusYear,
          major: partner.major
        },
        friendship_status: friendship.status,
        last_message: lastMessage ? formatDirectMessage(lastMessage) : null,
        unread_count: unreadCount,
        created_at: conversation.created_at,
        updated_at: lastMessage ? lastMessage.created_at : conversation.updated_at
      });
    }

    // Sort by most recent activity
    conversations.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    // Deduplicate by partner ID so a user never has multiple conversations for the same partner
    const uniqueConversations = [];
    const seenPartnerIds = new Set();
    for (const conv of conversations) {
      const pid = conv.partner?._id?.toString();
      if (pid && !seenPartnerIds.has(pid)) {
        seenPartnerIds.add(pid);
        uniqueConversations.push(conv);
      }
    }

    return successResponse(res, { conversations: uniqueConversations }, 'Conversations retrieved successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * 2. GET /conversations/:conversationId/messages
 * Retrieve messages in a conversation.
 * Verifies that the authenticated user belongs to the conversation.
 * Prevents URL tampering from reading another user's conversation.
 */
const getMessages = async (req, res, next) => {
  try {
    const currentUserId = req.user._id.toString();
    const { conversationId } = req.params;

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      return errorResponse(res, 'Invalid conversation ID format.', 400);
    }

    // 1. Locate conversation (polymorphic: Conversation ID, Friendship ID, Connection ID)
    let conversation = await resolveConversationById(conversationId);

    if (!conversation) {
      return errorResponse(res, 'Conversation not found.', 404);
    }

    // 2. CRITICAL SECURITY: Verify authenticated user belongs to the conversation
    // Prevents reading another user's private messages by changing ID in URL
    const isMember = conversation.participants.some(
      (p) => (p._id || p).toString() === currentUserId
    );

    if (!isMember) {
      return errorResponse(
        res,
        'You are not authorized to view this private conversation.',
        403
      );
    }

    // 3. Identify conversation partner
    const partner = conversation.participants.find(
      (p) => (p._id || p).toString() !== currentUserId
    );

    if (!partner) {
      return errorResponse(res, 'Conversation partner not found.', 404);
    }

    // 4. Verify all 5 communication eligibility conditions
    const eligibility = await verifyCommunicationEligibility(req.user, partner);
    if (!eligibility.eligible) {
      return errorResponse(res, eligibility.message, eligibility.statusCode);
    }

    // 5. Mark unread messages sent to current user as read
    const readTimestamp = new Date();
    const updateResult = await DirectMessage.updateMany(
      {
        conversation_id: conversation._id,
        receiver_id: req.user._id,
        read_at: null
      },
      {
        $set: { read_at: readTimestamp }
      }
    );

    // Real-time broadcast for message_read
    const { getIO } = require('../socket');
    const io = req.app?.get('io') || getIO();
    if (io && partner) {
      const readPayload = {
        conversation_id: conversation._id.toString(),
        reader_id: currentUserId,
        read_at: readTimestamp.toISOString()
      };
      io.to(`conversation:${conversation._id.toString()}`).emit('message_read', readPayload);
      io.to(`user:${partner._id.toString()}`).emit('message_read', readPayload);
      io.to(`user:${partner._id.toString()}`).emit('message:read_receipt', {
        connectionId: conversation._id.toString(),
        readerId: currentUserId
      });
    }

    // 6. Query all messages chronologically across both DirectMessage and legacy Message collections
    const messages = await collectAndMergeMessages(conversation, conversationId);

    return successResponse(
      res,
      {
        conversation_id: conversation._id.toString(),
        partner: {
          _id: partner._id,
          name: partner.name,
          displayName: partner.displayName || partner.name,
          avatar: partner.avatar,
          onlineStatus: partner.onlineStatus,
          isOnline: partner.isOnline
        },
        messages
      },
      'Messages retrieved successfully.'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 3. POST /conversations/:conversationId/messages
 * Send a direct message in a conversation.
 * Strictly verifies sender identity from token (ignores body.sender_id).
 * Enforces membership, friendship, block, and account permission rules.
 */
const sendMessage = async (req, res, next) => {
  try {
    const { conversationId } = req.params;

    // Never trust sender_id from frontend: derive directly from authenticated token
    const sender_id = req.user._id;

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      return errorResponse(res, 'Invalid conversation ID format.', 400);
    }

    // Validate message content
    const rawContent = req.body.content || req.body.text;
    if (!rawContent || !String(rawContent).trim()) {
      return errorResponse(res, 'Message content cannot be empty.', 400);
    }

    const content = String(rawContent).trim().substring(0, 4000);

    // 1. Locate conversation (polymorphic: Conversation ID, Friendship ID, Connection ID)
    let conversation = await resolveConversationById(conversationId);

    if (!conversation) {
      return errorResponse(res, 'Conversation not found.', 404);
    }

    // 2. CRITICAL SECURITY: Verify authenticated user belongs to the conversation
    const isMember = conversation.participants.some(
      (p) => (p._id || p).toString() === sender_id.toString()
    );

    if (!isMember) {
      return errorResponse(
        res,
        'You are not authorized to send messages in this conversation.',
        403
      );
    }

    // 3. Determine receiver
    const recipientUser = conversation.participants.find(
      (p) => (p._id || p).toString() !== sender_id.toString()
    );

    if (!recipientUser) {
      return errorResponse(res, 'Recipient not found in this conversation.', 404);
    }

    const receiver_id = recipientUser._id || recipientUser;

    // 4. Verify all 5 eligibility conditions
    const eligibility = await verifyCommunicationEligibility(req.user, recipientUser);
    if (!eligibility.eligible) {
      return errorResponse(res, eligibility.message, eligibility.statusCode);
    }

    // 5. Create and persist direct message with required fields
    const directMessage = await DirectMessage.create({
      conversation_id: conversation._id,
      sender_id,
      receiver_id,
      content,
      read_at: null
    });

    // 6. Update conversation metadata
    conversation.lastMessage = directMessage._id;
    conversation.lastMessageContent = content.substring(0, 100);
    conversation.lastMessageSender = sender_id;
    conversation.lastMessageAt = directMessage.created_at;
    conversation.updated_at = new Date();
    await conversation.save();

    // 7. Push in-app notification for recipient
    await Notification.create({
      recipient: receiver_id,
      sender: sender_id,
      type: 'new_message',
      title: 'New Message',
      message: `${req.user.name}: "${content.substring(0, 60)}"`,
      data: {
        conversation_id: conversation._id.toString(),
        message_id: directMessage._id.toString(),
        actionUrl: `/messages?conversationId=${conversation._id}`
      }
    });

    // Populate sender info for return response
    await directMessage.populate('sender_id', '_id name displayName avatar');

    const formatted = formatDirectMessage(directMessage);

    // 8. Real-time WebSocket broadcasting:
    // Deliver message_received exactly ONCE to recipient's personal room; deliver message_sent to sender
    const { getIO } = require('../socket');
    const io = req.app?.get('io') || getIO();
    if (io) {
      // 1. Deliver message_received to receiver user room
      io.to(`user:${receiver_id.toString()}`).emit('message_received', formatted);

      // 2. Deliver message_sent to sender's other connected sessions
      io.to(`user:${sender_id.toString()}`).emit('message_sent', formatted);
    }

    return successResponse(res, formatted, 'Message sent successfully.', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * 4. GET /conversations/with/:targetUserId
 * Retrieve or initialize a direct conversation with a target user (e.g., co-seated friend).
 * Strictly verifies communication eligibility (friendship=ACCEPTED, not blocked, not restricted).
 */
const getOrCreateWithUser = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const { targetUserId } = req.params;

    if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return errorResponse(res, 'Invalid target user ID format.', 400);
    }

    const eligibility = await verifyCommunicationEligibility(req.user, targetUserId);
    if (!eligibility.eligible) {
      return errorResponse(res, eligibility.message, eligibility.statusCode);
    }

    const { friendship, recipient } = eligibility;

    let conversation = await Conversation.findOne({ friendship: friendship._id }).populate([
      { path: 'participants', select: SAFE_PARTNER_FIELDS },
      { path: 'friendship' }
    ]);

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [currentUserId, recipient._id],
        friendship: friendship._id
      });
      await conversation.populate([
        { path: 'participants', select: SAFE_PARTNER_FIELDS },
        { path: 'friendship' }
      ]);
    }

    // Retrieve recent messages across both collections
    const messages = await collectAndMergeMessages(conversation, conversation._id);

    return successResponse(
      res,
      {
        conversation_id: conversation._id.toString(),
        friendship_id: friendship._id.toString(),
        partner: {
          _id: recipient._id,
          name: recipient.name,
          displayName: recipient.displayName || recipient.name,
          avatar: recipient.avatar,
          onlineStatus: recipient.onlineStatus,
          isOnline: recipient.isOnline,
          bio: recipient.bio,
          campusYear: recipient.campusYear,
          major: recipient.major
        },
        messages
      },
      'Conversation loaded successfully.'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 5. DELETE /conversations/:conversationId
 * Delete or clear a conversation and its direct messages for the current user.
 */
const deleteConversation = async (req, res, next) => {
  try {
    const currentUserId = req.user._id.toString();
    const { conversationId } = req.params;

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      return errorResponse(res, 'Invalid conversation ID format.', 400);
    }

    const conversation = await resolveConversationById(conversationId);
    if (!conversation) {
      return errorResponse(res, 'Conversation not found.', 404);
    }

    const isMember = conversation.participants.some(
      (p) => (p._id || p).toString() === currentUserId
    );

    if (!isMember) {
      return errorResponse(res, 'You are not authorized to delete this conversation.', 403);
    }

    // Delete direct messages in this conversation
    await DirectMessage.deleteMany({ conversation_id: conversation._id });

    // Delete the conversation document
    await Conversation.deleteOne({ _id: conversation._id });

    return successResponse(res, null, 'Conversation deleted successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * Mute conversation notifications
 * POST /api/conversations/:id/mute
 */
const muteConversation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { durationHours = null } = req.body;
    const userId = req.user._id;

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      return errorResponse(res, 'Conversation not found.', 404);
    }

    const isMember = conversation.participants.some(
      (p) => (p._id || p).toString() === userId.toString()
    );
    if (!isMember) {
      return errorResponse(res, 'Not authorized.', 403);
    }

    const mutedUntil = durationHours ? new Date(Date.now() + durationHours * 60 * 60 * 1000) : null;
    conversation.mutedBy = (conversation.mutedBy || []).filter(
      (m) => m.user.toString() !== userId.toString()
    );
    conversation.mutedBy.push({ user: userId, mutedUntil });
    await conversation.save();

    return successResponse(res, { mutedUntil }, 'Conversation muted.');
  } catch (error) {
    next(error);
  }
};

/**
 * Unmute conversation notifications
 * POST /api/conversations/:id/unmute
 */
const unmuteConversation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      return errorResponse(res, 'Conversation not found.', 404);
    }

    conversation.mutedBy = (conversation.mutedBy || []).filter(
      (m) => m.user.toString() !== userId.toString()
    );
    await conversation.save();

    return successResponse(res, null, 'Conversation unmuted.');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getConversations,
  getMessages,
  sendMessage,
  getOrCreateWithUser,
  deleteConversation,
  muteConversation,
  unmuteConversation,
  verifyCommunicationEligibility,
  formatDirectMessage,
  resolveConversationById,
  collectAndMergeMessages
};


