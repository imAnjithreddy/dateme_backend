const mongoose = require('mongoose');
const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const DirectMessage = require('../models/DirectMessage');
const Friendship = require('../models/Friendship');
const Block = require('../models/Block');
const Notification = require('../models/Notification');
const Connection = require('../models/Connection');
const { attachVoiceHandlers, handleVoiceDisconnect, endVoiceSessionOnSeatVacate } = require('./voiceHandler');
const seatingManager = require('./seatingManager');

// Valid Campus Area Rooms (includes all 2D zones, 3D zones, and chunk coordinates)
const VALID_AREAS = [
  'main-plaza',
  'cafe',
  'datee-cafe',
  'game-zone',
  'pixel-arcade',
  'event-area',
  'music-area',
  'music-stage',
  'club-house',
  'club-house-interior',
  'love-garden',
  'serenity-park',
  'clocktower-residence',
  'residential-area',
  'sky-pier',
  'chunk_0_0', 'chunk_1_0', 'chunk_2_0',
  'chunk_0_1', 'chunk_1_1', 'chunk_2_1',
  'chunk_0_2', 'chunk_1_2', 'chunk_2_2'
];

// Map of socketId -> playerState
const players = new Map();

// Map of userId -> Set of socketIds for presence tracking
const userSockets = new Map();

let ioInstance = null;

/**
 * Format direct message schema
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
 * Polymorphic conversation resolver
 * Resolves conversation across Conversation ID, Friendship ID, Connection ID, or target User ID.
 */
const resolveConversation = async (conversationId, verifiedUserId) => {
  if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) return null;

  // 1. Direct Conversation ID
  let conversation = await Conversation.findById(conversationId);
  if (conversation) return conversation;

  // 2. Friendship ID
  const friendship = await Friendship.findById(conversationId);
  if (friendship && friendship.status === 'ACCEPTED') {
    conversation = await Conversation.findOne({ friendship: friendship._id });
    if (!conversation) {
      conversation = await Conversation.create({
        participants: [friendship.requester, friendship.recipient],
        friendship: friendship._id
      });
    }
    return conversation;
  }

  // 3. Connection ID (legacy or campus match)
  const connection = await Connection.findById(conversationId);
  if (connection && ['accepted', 'connected', 'pending'].includes(connection.status)) {
    const p1 = connection.requester.toString();
    const p2 = connection.recipient.toString();
    conversation = await Conversation.findOne({
      participants: { $all: [p1, p2] }
    });
    if (!conversation) {
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
      conversation = await Conversation.create({
        participants: [p1, p2],
        friendship: fs._id
      });
    }
    return conversation;
  }

  // 4. Match ID
  try {
    const Match = require('../models/Match');
    const match = await Match.findById(conversationId);
    if (match) {
      if (match.connection) {
        return await resolveConversation(match.connection.toString(), verifiedUserId);
      }
      if (match.users && match.users.length === 2) {
        const [u1, u2] = match.users;
        conversation = await Conversation.findOne({ participants: { $all: [u1, u2] } });
        if (!conversation) {
          let fs = await Friendship.findOne({
            $or: [
              { requester: u1, recipient: u2 },
              { requester: u2, recipient: u1 }
            ]
          });
          if (!fs) {
            fs = await Friendship.create({ requester: u1, recipient: u2, status: 'ACCEPTED' });
          }
          conversation = await Conversation.create({ participants: [u1, u2], friendship: fs._id });
        }
        return conversation;
      }
    }
  } catch (mErr) {}

  // 5. Target User ID
  if (verifiedUserId && conversationId.toString() !== verifiedUserId.toString()) {
    const targetUser = await User.findById(conversationId);
    if (targetUser) {
      const u1 = new mongoose.Types.ObjectId(verifiedUserId);
      const u2 = new mongoose.Types.ObjectId(targetUser._id);
      conversation = await Conversation.findOne({
        participants: { $all: [u1, u2] }
      });
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
      }
      return conversation;
    }
  }

  return null;
};

const initSocket = (io) => {
  ioInstance = io;

  // Handshake authentication middleware: Strictly reject unauthenticated connections
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        (socket.handshake.headers?.authorization &&
          socket.handshake.headers.authorization.startsWith('Bearer ')
            ? socket.handshake.headers.authorization.split(' ')[1]
            : null);

      if (!token) {
        return next(new Error('Authentication required: No token provided'));
      }

      let decoded;
      try {
        decoded = verifyToken(token);
      } catch (err) {
        return next(new Error('Authentication failed: Invalid or expired token'));
      }

      if (!decoded || !decoded.id) {
        return next(new Error('Authentication failed: Invalid token payload'));
      }

      const user = await User.findById(decoded.id).select(
        'name displayName role currentCampusZone avatar age city relationshipIntent interests bio isVerified isBanned isSuspended isBlocked onlineStatus isOnline lastActive'
      );
      if (!user) {
        return next(new Error('Authentication failed: User account not found'));
      }
      if (user.isBanned || user.isSuspended || user.isBlocked) {
        return next(new Error('Authentication failed: User account is restricted'));
      }

      socket.user = user;
      return next();
    } catch (err) {
      return next(new Error('Authentication error: ' + err.message));
    }
  });

  io.on('connection', (socket) => {
    // Only authenticated users reach this handler
    const verifiedUserId = socket.user._id.toString();
    const verifiedName = socket.user.name || socket.user.displayName || 'Campus Student';
    const verifiedRole = socket.user.role || 'USER';

    // Join personal user room for targeted notifications and private whispers
    socket.join(`user:${verifiedUserId}`);

    // Manage presence & user_online event
    if (!userSockets.has(verifiedUserId)) {
      userSockets.set(verifiedUserId, new Set());
    }
    const isFirstConnection = userSockets.get(verifiedUserId).size === 0;
    userSockets.get(verifiedUserId).add(socket.id);

    if (isFirstConnection) {
      const onlinePayload = {
        userId: verifiedUserId,
        name: verifiedName,
        avatar: socket.user.avatar,
        onlineStatus: 'online',
        isOnline: true,
        lastActive: new Date().toISOString()
      };
      io.emit('user_online', onlinePayload);
      User.findByIdAndUpdate(verifiedUserId, {
        onlineStatus: 'online',
        isOnline: true,
        lastActive: new Date()
      }).exec();
    }

    const defaultAvatar = socket.user?.avatar || {
      primaryColor: '#6366f1',
      secondaryColor: '#ec4899',
      skinTone: '#e0ac69',
      hairStyle: 'undercut',
      accessory: 'headphones'
    };

    // Attach WebRTC Voice Signaling & Call Authorization Handlers
    attachVoiceHandlers(socket, io, userSockets, players);

    /**
     * Event: campus:join
     * When a student enters the 3D Virtual Campus
     */
    socket.on('campus:join', (data = {}) => {
      // Clean up previous registration for this socket if any
      const existing = players.get(socket.id);
      if (existing) {
        socket.leave(`area:${existing.campusArea}`);
      }

      const initialArea = VALID_AREAS.includes(data.campusArea) ? data.campusArea : 'main-plaza';

      // Clamp initial coordinates to 2D campus boundaries (0 to 3800px)
      const posX = typeof data.x === 'number' ? Math.max(0, Math.min(3800, data.x)) : 1800;
      const posY = 0;
      const posZ = typeof data.z === 'number' ? Math.max(0, Math.min(3800, data.z)) : 1900;
      const rotation = typeof data.rotation === 'number' ? data.rotation : 0;

      const playerState = {
        socketId: socket.id,
        userId: verifiedUserId,
        displayName: verifiedName,
        role: verifiedRole,
        avatar: data.avatar || defaultAvatar,
        campusArea: initialArea,
        position: [posX, posY, posZ],
        rotation,
        animationState: 'idle',
        onlineStatus: 'online', // 'online' | 'away' | 'offline'
        // Safe public profile snippets (strictly NO private data)
        age: socket.user?.age || null,
        city: socket.user?.city || 'Campus Grounds',
        relationshipIntent: socket.user?.relationshipIntent || 'dating',
        interests: socket.user?.interests ? socket.user.interests.slice(0, 5) : [],
        bio: socket.user?.bio ? socket.user.bio.substring(0, 150) : 'Exploring the 3D campus grounds.',
        statusTag: `Chilling in ${initialArea.replace('-', ' ')}`,
        lastActive: Date.now()
      };

      players.set(socket.id, playerState);

      // Join global campus room and initial area room
      socket.join('campus:world');
      socket.join(`area:${initialArea}`);

      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Socket] ${playerState.displayName} joined campus area: ${initialArea} (${socket.id}) at (${posX}, ${posZ})`);
      }

      // 1. Send all currently online players to the joining player
      socket.emit('campus:init', {
        self: playerState,
        players: Array.from(players.values())
      });

      // 2. Broadcast new arrival to campus world
      socket.to('campus:world').emit('player:joined', playerState);

      // 3. Broadcast updated presence count
      io.to('campus:world').emit('presence:update', {
        onlineCount: players.size,
        players: Array.from(players.values())
      });
    });

    /**
     * Event: player:move
     * High-frequency movement synchronization with campus-wide broadcasting
     */
    socket.on('player:move', (data) => {
      const player = players.get(socket.id);
      if (!player) return;

      const newX = typeof data.x === 'number' ? Math.max(0, Math.min(3800, data.x)) : player.position[0];
      const newY = typeof data.y === 'number' ? data.y : 0;
      const newZ = typeof data.z === 'number' ? Math.max(0, Math.min(3800, data.z)) : player.position[2];
      const newRotation = typeof data.rotation === 'number' ? data.rotation : player.rotation;
      const animationState = data.animationState || (data.isMoving ? 'walk' : 'idle');
      const newArea = VALID_AREAS.includes(data.campusArea || data.zone)
        ? data.campusArea || data.zone
        : player.campusArea;

      player.position = [newX, newY, newZ];
      player.rotation = newRotation;
      player.animationState = animationState;
      player.lastActive = Date.now();

      // Check for area transition
      if (newArea !== player.campusArea) {
        const oldArea = player.campusArea;
        player.campusArea = newArea;
        player.statusTag = `Exploring ${newArea.replace('-', ' ')}`;

        // Switch rooms
        socket.leave(`area:${oldArea}`);
        socket.join(`area:${newArea}`);

        // Notify rooms about area switch
        socket.to(`area:${oldArea}`).emit('player:left_area', {
          socketId: socket.id,
          userId: player.userId,
          newArea
        });

        socket.to(`area:${newArea}`).emit('player:entered_area', player);

        // Notify global room so minimaps reflect the new zone
        io.to('campus:world').emit('player:area_changed', {
          socketId: socket.id,
          userId: player.userId,
          oldArea,
          newArea,
          position: player.position
        });
      }

      // Broadcast position update to entire campus world so all players in range can render smoothly
      socket.to('campus:world').emit('player:moved', {
        socketId: socket.id,
        userId: player.userId,
        position: player.position,
        rotation: player.rotation,
        animationState: player.animationState,
        campusArea: player.campusArea
      });
    });

    /**
     * Event: presence:status
     * Toggle status between online, away, offline
     */
    socket.on('presence:status', ({ status }) => {
      const player = players.get(socket.id);
      if (!player) return;

      const validStatuses = ['online', 'away', 'offline'];
      if (!validStatuses.includes(status)) return;

      player.onlineStatus = status;

      io.to('campus:world').emit('player:status_changed', {
        socketId: socket.id,
        userId: player.userId,
        onlineStatus: status
      });
    });

    /**
     * Event: player_sit
     * Synchronize seating on benches across multiplayer campus
     */
    socket.on('player_sit', (data = {}) => {
      const player = players.get(socket.id);
      if (player) {
        player.animationState = 'sit';
        player.isSeated = true;
        player.seatId = data.seatId;
        if (typeof data.x === 'number') player.position[0] = data.x;
        if (typeof data.y === 'number') player.position[2] = data.y;
        if (data.facing) player.rotation = data.facing;
      }

      // Authoritative server-side seating registration
      if (data.seatId) {
        seatingManager.occupySeat(verifiedUserId, data.seatId, socket.id);

        // Check if both seats on the same interaction object are now occupied
        const coSeated = seatingManager.getCoSeatedPartner(verifiedUserId);
        if (coSeated) {
          // Server verifies:
          // 1. Same interaction object? YES (coSeated.userSeat.objectId === coSeated.partnerSeat.objectId)
          // 2. Both seats occupied? YES (verified by seatingManager)
          // 3. Friends? Query Friendship
          // 4. Blocked? Query Block
          (async () => {
            try {
              const partnerUserId = coSeated.partnerUserId;
              const [isBlocked, friendship, partnerUser] = await Promise.all([
                Block.findOne({
                  $or: [
                    { blocker: verifiedUserId, blocked: partnerUserId },
                    { blocker: partnerUserId, blocked: verifiedUserId }
                  ]
                }),
                Friendship.findOne({
                  $or: [
                    { requester: verifiedUserId, recipient: partnerUserId },
                    { requester: partnerUserId, recipient: verifiedUserId }
                  ]
                }),
                User.findById(partnerUserId).select('name displayName avatar')
              ]);

              const areFriends = Boolean(friendship && friendship.status === 'ACCEPTED');
              const hasBlock = Boolean(isBlocked);

              if (areFriends && !hasBlock && partnerUser) {
                // Create voice-enabled interaction context!
                // Both users see:
                // 💬 Message
                // 🎙️ Voice
                // Voice starts MUTED.
                // Neither microphone is automatically enabled.
                const userA = socket.user;
                const userB = partnerUser;

                io.to(`user:${verifiedUserId}`).emit('seating:co_seated_context', {
                  coSeated: true,
                  objectId: coSeated.objectId,
                  partner: {
                    userId: userB._id.toString(),
                    name: userB.name || userB.displayName,
                    avatar: userB.avatar
                  },
                  canMessage: true,
                  canVoice: true,
                  isVoiceActive: false,
                  isMuted: true
                });

                io.to(`user:${partnerUserId}`).emit('seating:co_seated_context', {
                  coSeated: true,
                  objectId: coSeated.objectId,
                  partner: {
                    userId: userA._id.toString(),
                    name: userA.name || userA.displayName,
                    avatar: userA.avatar
                  },
                  canMessage: true,
                  canVoice: true,
                  isVoiceActive: false,
                  isMuted: true
                });
              } else {
                io.to(`user:${verifiedUserId}`).emit('seating:co_seated_context', {
                  coSeated: true,
                  objectId: coSeated.objectId,
                  partner: partnerUser
                    ? {
                        userId: partnerUser._id.toString(),
                        name: partnerUser.name || partnerUser.displayName,
                        avatar: partnerUser.avatar
                      }
                    : null,
                  canMessage: false,
                  canVoice: false,
                  canAddFriend: !hasBlock && (!friendship || friendship.status !== 'ACCEPTED')
                });
              }
            } catch (err) {
              console.warn('[Seating] Error evaluating co-seated context:', err.message);
            }
          })();
        }
      }

      io.to('campus:world').emit('player_sit', {
        socketId: socket.id,
        userId: player?.userId || socket.id,
        benchId: data.benchId,
        seatId: data.seatId,
        x: data.x,
        y: data.y,
        facing: data.facing
      });
    });

    /**
     * Event: player_stand
     * Synchronize standing up from benches across multiplayer campus
     */
    socket.on('player_stand', (data = {}) => {
      const player = players.get(socket.id);
      if (player) {
        player.animationState = 'idle';
        player.isSeated = false;
        player.seatId = null;
        if (typeof data.x === 'number') player.position[0] = data.x;
        if (typeof data.y === 'number') player.position[2] = data.y;
      }

      // Player leaves seat -> Voice interaction context ends -> WebRTC connection closes
      endVoiceSessionOnSeatVacate(verifiedUserId, io, players);

      // Check if user was co-seated with someone before vacating
      const prevCoSeated = seatingManager.getCoSeatedPartner(verifiedUserId);
      if (prevCoSeated) {
        io.to(`user:${verifiedUserId}`).emit('seating:co_seated_cleared', {
          objectId: prevCoSeated.objectId
        });
        io.to(`user:${prevCoSeated.partnerUserId}`).emit('seating:co_seated_cleared', {
          objectId: prevCoSeated.objectId
        });
      }

      // Authoritative server-side seating vacation
      seatingManager.vacateSeat(verifiedUserId, data.seatId);

      io.to('campus:world').emit('player_stand', {
        socketId: socket.id,
        userId: player?.userId || socket.id,
        benchId: data.benchId,
        seatId: data.seatId,
        x: data.x,
        y: data.y
      });
    });

    /**
     * Event: player:wave
     * Social interaction wave trigger
     */
    socket.on('player:wave', ({ targetSocketId, targetUserId }) => {
      const sender = players.get(socket.id);
      if (!sender) return;

      sender.animationState = 'wave';
      setTimeout(() => {
        if (players.has(socket.id)) {
          players.get(socket.id).animationState = 'idle';
        }
      }, 2500);

      const wavePayload = {
        senderSocketId: socket.id,
        senderUserId: sender.userId,
        senderName: sender.displayName,
        targetSocketId,
        targetUserId
      };

      // Notify target socket directly if provided
      if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
        io.to(targetSocketId).emit('player:waved_at', wavePayload);
      }

      // Also broadcast wave emote to everyone in the sender's area
      io.to(`area:${sender.campusArea}`).emit('player:emoted', {
        socketId: socket.id,
        userId: sender.userId,
        displayName: sender.displayName,
        emote: '👋',
        targetName: targetUserId ? 'nearby peer' : null
      });
    });

    /**
     * Event: player:say_hi
     * Quick proximity greeting
     */
    socket.on('player:say_hi', ({ targetSocketId, text = 'Hey!' }) => {
      const sender = players.get(socket.id);
      if (!sender) return;

      const cleanText = String(text).trim().substring(0, 80);

      const hiPayload = {
        senderSocketId: socket.id,
        senderUserId: sender.userId,
        senderName: sender.displayName,
        text: cleanText,
        targetSocketId
      };

      if (targetSocketId && io.sockets.sockets.get(targetSocketId)) {
        io.to(targetSocketId).emit('player:said_hi', hiPayload);
      }

      io.to(`area:${sender.campusArea}`).emit('player:speech', {
        socketId: socket.id,
        displayName: sender.displayName,
        text: cleanText
      });
    });

    /**
     * Event: chat:campus_message
     * Campus area chat messages (strictly separated from movement)
     */
    socket.on('chat:campus_message', ({ text, campusArea }) => {
      const sender = players.get(socket.id);
      if (!sender) return;

      if (!text || !String(text).trim()) return;

      const cleanText = String(text).trim().substring(0, 300);
      const targetArea = VALID_AREAS.includes(campusArea) ? campusArea : sender.campusArea;

      const messageObj = {
        id: Date.now() + Math.random().toString(36).substring(2, 7),
        senderId: sender.userId,
        socketId: socket.id,
        senderName: sender.displayName,
        avatar: sender.avatar,
        text: cleanText,
        campusArea: targetArea,
        timestamp: new Date().toISOString()
      };

      // Broadcast to the specific campus area room and campus global
      io.to(`area:${targetArea}`).emit('chat:campus_broadcast', messageObj);
    });

    /**
     * Subscribe / Join private conversation channel
     * Event: conversation:join & conversation:subscribe
     * Strictly verifies that authenticated user belongs to the conversation.
     * Prevents user from subscribing to another user's private conversation.
     */
    const handleConversationJoin = async (data = {}, callback) => {
      try {
        const conversationId = data.conversationId || data.conversation_id || data.connectionId || data.userId || data.targetUserId;
        if (!conversationId) {
          const err = { success: false, error: 'Conversation ID is required.' };
          if (typeof callback === 'function') return callback(err);
          return socket.emit('error', err);
        }

        const conversation = await resolveConversation(conversationId, verifiedUserId);

        if (!conversation) {
          const err = { success: false, error: 'Conversation not found.' };
          if (typeof callback === 'function') return callback(err);
          return socket.emit('error', err);
        }

        // STRICT IDENTITY CHECK: authenticated user must be a participant
        const isMember = conversation.participants.some(
          (p) => p.toString() === verifiedUserId
        );

        if (!isMember) {
          console.warn(`[Security Alert] User ${verifiedUserId} attempted unauthorized subscription to conversation ${conversationId}`);
          const err = {
            success: false,
            error: 'Forbidden: You are not authorized to subscribe to this private conversation.'
          };
          if (typeof callback === 'function') return callback(err);
          return socket.emit('error', err);
        }

        // Check if communication is blocked
        const partnerId = conversation.participants.find((p) => p.toString() !== verifiedUserId);
        if (partnerId) {
          const isBlocked = await Block.findOne({
            $or: [
              { blocker: verifiedUserId, blocked: partnerId },
              { blocker: partnerId, blocked: verifiedUserId }
            ]
          });
          if (isBlocked) {
            const err = { success: false, error: 'Cannot subscribe: Communication is blocked.' };
            if (typeof callback === 'function') return callback(err);
            return socket.emit('error', err);
          }
        }

        socket.join(`conversation:${conversation._id.toString()}`);
        if (conversationId && conversationId.toString() !== conversation._id.toString()) {
          socket.join(`conversation:${conversationId.toString()}`);
        }
        if (typeof callback === 'function') {
          callback({
            success: true,
            conversation_id: conversation._id.toString(),
            message: 'Subscribed to conversation successfully.'
          });
        }
      } catch (err) {
        if (typeof callback === 'function') callback({ success: false, error: err.message });
      }
    };

    socket.on('conversation:join', handleConversationJoin);
    socket.on('conversation:subscribe', handleConversationJoin);

    socket.on('conversation:leave', ({ conversationId, conversation_id, connectionId }) => {
      const id = conversationId || conversation_id || connectionId;
      if (id) {
        socket.leave(`conversation:${id}`);
      }
    });

    /**
     * Real-time typing indicators
     * Event: typing_started & typing_stopped
     */
    const handleTypingStarted = async (data = {}) => {
      try {
        const conversationId = data.conversation_id || data.conversationId || data.connectionId;
        if (!conversationId) return;

        let conversation = null;
        if (mongoose.Types.ObjectId.isValid(conversationId)) {
          conversation = await Conversation.findById(conversationId);
          if (!conversation) {
            const friendship = await Friendship.findById(conversationId);
            if (friendship) conversation = await Conversation.findOne({ friendship: friendship._id });
          }
        }
        if (!conversation) return;

        const isMember = conversation.participants.some((p) => p.toString() === verifiedUserId);
        if (!isMember) return;

        const partnerId = conversation.participants.find((p) => p.toString() !== verifiedUserId);

        const payload = {
          conversation_id: conversation._id.toString(),
          sender_id: verifiedUserId,
          user: {
            _id: verifiedUserId,
            name: verifiedName
          }
        };

        socket.to(`conversation:${conversation._id.toString()}`).emit('typing_started', payload);
        if (partnerId) {
          socket.to(`user:${partnerId.toString()}`).emit('typing_started', payload);
          // Legacy typing:update
          socket.to(`user:${partnerId.toString()}`).emit('typing:update', {
            connectionId: conversation._id.toString(),
            userId: verifiedUserId,
            name: verifiedName,
            isTyping: true
          });
        }
        socket.to(`conversation:${conversation._id.toString()}`).emit('typing:update', {
          connectionId: conversation._id.toString(),
          userId: verifiedUserId,
          name: verifiedName,
          isTyping: true
        });
      } catch (err) {
        console.warn('[Socket] typing_started error:', err.message);
      }
    };

    socket.on('typing_started', handleTypingStarted);
    socket.on('typing:start', handleTypingStarted);

    const handleTypingStopped = async (data = {}) => {
      try {
        const conversationId = data.conversation_id || data.conversationId || data.connectionId;
        if (!conversationId) return;

        let conversation = null;
        if (mongoose.Types.ObjectId.isValid(conversationId)) {
          conversation = await Conversation.findById(conversationId);
          if (!conversation) {
            const friendship = await Friendship.findById(conversationId);
            if (friendship) conversation = await Conversation.findOne({ friendship: friendship._id });
          }
        }
        if (!conversation) return;

        const isMember = conversation.participants.some((p) => p.toString() === verifiedUserId);
        if (!isMember) return;

        const partnerId = conversation.participants.find((p) => p.toString() !== verifiedUserId);

        const payload = {
          conversation_id: conversation._id.toString(),
          sender_id: verifiedUserId
        };

        socket.to(`conversation:${conversation._id.toString()}`).emit('typing_stopped', payload);
        if (partnerId) {
          socket.to(`user:${partnerId.toString()}`).emit('typing_stopped', payload);
          // Legacy typing:update
          socket.to(`user:${partnerId.toString()}`).emit('typing:update', {
            connectionId: conversation._id.toString(),
            userId: verifiedUserId,
            name: verifiedName,
            isTyping: false
          });
        }
        socket.to(`conversation:${conversation._id.toString()}`).emit('typing:update', {
          connectionId: conversation._id.toString(),
          userId: verifiedUserId,
          name: verifiedName,
          isTyping: false
        });
      } catch (err) {
        console.warn('[Socket] typing_stopped error:', err.message);
      }
    };

    socket.on('typing_stopped', handleTypingStopped);
    socket.on('typing:stop', handleTypingStopped);

    /**
     * Real-time private message send via Socket
     * Event: message_send & message:send
     */
    const handleSendMessage = async (data = {}, callback) => {
      try {
        const conversationId =
          data.conversationId ||
          data.conversation_id ||
          data.connectionId ||
          data.targetUserId ||
          data.userId ||
          data.recipientId;
        const text = data.content || data.text;

        if (!conversationId) {
          if (typeof callback === 'function') callback({ success: false, error: 'Conversation ID required.' });
          return;
        }
        if (!text || !String(text).trim()) {
          if (typeof callback === 'function') callback({ success: false, error: 'Message content cannot be empty.' });
          return;
        }

        const cleanText = String(text).trim().substring(0, 4000);

        const { checkSocketMessageRateLimit } = require('../middleware/rateLimiter');
        const rateCheck = checkSocketMessageRateLimit(socket.user._id);
        if (!rateCheck.allowed) {
          if (typeof callback === 'function') callback({ success: false, error: rateCheck.message });
          return;
        }

        const conversation = await resolveConversation(conversationId, verifiedUserId);

        if (!conversation) {
          if (typeof callback === 'function') callback({ success: false, error: 'Conversation not found.' });
          return;
        }

        const isMember = conversation.participants.some((p) => p.toString() === verifiedUserId);
        if (!isMember) {
          if (typeof callback === 'function') callback({ success: false, error: 'Unauthorized.' });
          return;
        }

        const partnerId = conversation.participants.find((p) => p.toString() !== verifiedUserId);
        if (!partnerId) {
          if (typeof callback === 'function') callback({ success: false, error: 'Recipient not found.' });
          return;
        }

        const { verifyCommunicationEligibility } = require('../controllers/conversationController');
        const eligibility = await verifyCommunicationEligibility(socket.user, partnerId);
        if (!eligibility.eligible) {
          if (typeof callback === 'function') callback({ success: false, error: eligibility.message });
          return;
        }

        const directMessage = await DirectMessage.create({
          conversation_id: conversation._id,
          sender_id: socket.user._id,
          receiver_id: partnerId,
          content: cleanText,
          read_at: null
        });

        conversation.lastMessage = directMessage._id;
        conversation.lastMessageContent = cleanText.substring(0, 100);
        conversation.lastMessageSender = socket.user._id;
        conversation.lastMessageAt = directMessage.created_at;
        conversation.updated_at = new Date();
        await conversation.save();

        // Check if recipient has muted this conversation
        const isMutedByPartner = conversation.mutedBy?.some((m) =>
          (m.user?._id || m.user).toString() === partnerId.toString() &&
          (!m.mutedUntil || new Date(m.mutedUntil) > new Date())
        );

        if (!isMutedByPartner) {
          await Notification.create({
            recipient: partnerId,
            sender: socket.user._id,
            type: 'new_message',
            title: 'New Message',
            message: `${verifiedName}: "${cleanText.substring(0, 60)}"`,
            data: {
              conversation_id: conversation._id.toString(),
              message_id: directMessage._id.toString(),
              actionUrl: `/messages?conversationId=${conversation._id}`
            }
          });
        }

        await directMessage.populate('sender_id', '_id name displayName avatar');
        const formatted = formatDirectMessage(directMessage);

        // 1. Deliver message_received exactly ONCE to recipient's personal room
        io.to(`user:${partnerId.toString()}`).emit('message_received', formatted);

        // 2. Deliver message_sent to sender's other connected devices/tabs (excluding current socket)
        socket.to(`user:${verifiedUserId}`).emit('message_sent', formatted);

        // 3. Acknowledge delivery directly to the active sending socket
        if (typeof callback === 'function') {
          callback({ success: true, message: formatted });
        }
      } catch (err) {
        if (typeof callback === 'function') callback({ success: false, error: err.message });
      }
    };

    socket.on('message_send', handleSendMessage);
    socket.on('message:send', handleSendMessage);

    /**
     * Mark messages read via socket
     * Event: message_read & message:read
     */
    const handleMessageRead = async (data = {}, callback) => {
      try {
        const conversationId = data.conversationId || data.conversation_id || data.connectionId;
        if (!conversationId) return;

        let conversation = null;
        if (mongoose.Types.ObjectId.isValid(conversationId)) {
          conversation = await Conversation.findById(conversationId);
          if (!conversation) {
            const friendship = await Friendship.findById(conversationId);
            if (friendship) conversation = await Conversation.findOne({ friendship: friendship._id });
          }
        }
        if (!conversation) return;

        const isMember = conversation.participants.some((p) => p.toString() === verifiedUserId);
        if (!isMember) return;

        const partnerId = conversation.participants.find((p) => p.toString() !== verifiedUserId);
        const readTimestamp = new Date();

        await DirectMessage.updateMany(
          {
            conversation_id: conversation._id,
            receiver_id: socket.user._id,
            read_at: null
          },
          {
            $set: { read_at: readTimestamp }
          }
        );

        const readPayload = {
          conversation_id: conversation._id.toString(),
          reader_id: verifiedUserId,
          read_at: readTimestamp.toISOString()
        };

        io.to(`conversation:${conversation._id.toString()}`).emit('message_read', readPayload);
        if (partnerId) {
          io.to(`user:${partnerId.toString()}`).emit('message_read', readPayload);
          // Legacy
          io.to(`user:${partnerId.toString()}`).emit('message:read_receipt', {
            connectionId: conversation._id.toString(),
            readerId: verifiedUserId
          });
        }

        if (typeof callback === 'function') callback({ success: true, ...readPayload });
      } catch (err) {
        if (typeof callback === 'function') callback({ success: false, error: err.message });
      }
    };

    socket.on('message_read', handleMessageRead);
    socket.on('message:read', handleMessageRead);

    /**
     * Mini-Game Socket Events
     */
    socket.on('game:invite', (data) => {
      try {
        if (!data || !data.targetUserId) return;
        io.to(`user:${data.targetUserId}`).emit('game:invited', {
          session: data.session,
          inviter: socket.user ? {
            _id: socket.user._id,
            name: socket.user.name,
            displayName: socket.user.displayName,
            avatar: socket.user.avatar
          } : null
        });
      } catch (e) {
        console.warn('[Socket] game:invite error:', e.message);
      }
    });

    socket.on('game:respond', (data) => {
      try {
        if (!data || !data.session) return;
        const s = data.session;
        const inviterId = typeof s.inviter === 'object' ? s.inviter._id : s.inviter;
        const inviteeId = typeof s.invitee === 'object' ? s.invitee._id : s.invitee;

        const eventName = s.status === 'active' ? 'game:started' : 'game:declined';
        io.to(`user:${inviterId}`).emit(eventName, { session: s });
        io.to(`user:${inviteeId}`).emit(eventName, { session: s });
      } catch (e) {
        console.warn('[Socket] game:respond error:', e.message);
      }
    });

    socket.on('game:move', (data) => {
      try {
        if (!data || !data.session) return;
        const s = data.session;
        const inviterId = typeof s.inviter === 'object' ? s.inviter._id : s.inviter;
        const inviteeId = typeof s.invitee === 'object' ? s.invitee._id : s.invitee;

        io.to(`user:${inviterId}`).emit('game:updated', { session: s });
        io.to(`user:${inviteeId}`).emit('game:updated', { session: s });
      } catch (e) {
        console.warn('[Socket] game:move error:', e.message);
      }
    });

    socket.on('game:reset', (data) => {
      try {
        if (!data || !data.session) return;
        const s = data.session;
        const inviterId = typeof s.inviter === 'object' ? s.inviter._id : s.inviter;
        const inviteeId = typeof s.invitee === 'object' ? s.invitee._id : s.invitee;

        io.to(`user:${inviterId}`).emit('game:reset', { session: s });
        io.to(`user:${inviteeId}`).emit('game:reset', { session: s });
      } catch (e) {
        console.warn('[Socket] game:reset error:', e.message);
      }
    });

    /**
     * Latency ping check
     */
    socket.on('ping:check', (timestamp, callback) => {
      if (typeof callback === 'function') {
        callback({ serverTime: Date.now(), receivedTimestamp: timestamp });
      }
    });

    /**
     * Clean Disconnect
     */
    socket.on('disconnect', () => {
      // 1. Campus player presence cleanup
      const player = players.get(socket.id);
      if (player) {
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[Socket] Student left campus: ${player.displayName} (${socket.id})`);
        }
        players.delete(socket.id);

        // Broadcast to campus world that this player left
        socket.to('campus:world').emit('player:left', {
          socketId: socket.id,
          userId: player.userId
        });

        // Broadcast updated presence count
        io.to('campus:world').emit('presence:update', {
          onlineCount: players.size,
          players: Array.from(players.values())
        });
      }

      // 2. User presence tracking cleanup & user_offline event
      const userSocketSet = userSockets.get(verifiedUserId);
      if (userSocketSet) {
        userSocketSet.delete(socket.id);
        if (userSocketSet.size === 0) {
          userSockets.delete(verifiedUserId);
          const offlinePayload = {
            userId: verifiedUserId,
            onlineStatus: 'offline',
            isOnline: false,
            lastActive: new Date().toISOString()
          };
          io.emit('user_offline', offlinePayload);
          User.findByIdAndUpdate(verifiedUserId, {
            onlineStatus: 'offline',
            isOnline: false,
            lastActive: new Date()
          }).exec();
        }
      }

      // 3. WebRTC Voice Call disconnect cleanup
      handleVoiceDisconnect(verifiedUserId, io, players);

      // 4. Authoritative Seating cleanup
      const dcCoSeated = seatingManager.getCoSeatedPartner(verifiedUserId);
      if (dcCoSeated) {
        io.to(`user:${dcCoSeated.partnerUserId}`).emit('seating:co_seated_cleared', {
          objectId: dcCoSeated.objectId
        });
      }
      seatingManager.vacateUser(verifiedUserId);
    });
  });

  return io;
};

module.exports = {
  initSocket,
  getIO: () => ioInstance,
  getOnlineUsersCount: () => players.size,
  getOnlinePlayersList: () => Array.from(players.values())
};
