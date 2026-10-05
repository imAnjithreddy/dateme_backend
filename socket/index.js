const mongoose = require('mongoose');
const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const DirectMessage = require('../models/DirectMessage');
const Friendship = require('../models/Friendship');
const Block = require('../models/Block');
const Notification = require('../models/Notification');
const Connection = require('../models/Connection');
const notificationService = require('../services/notificationService');
const { attachVoiceHandlers, handleVoiceDisconnect, endVoiceSessionOnSeatVacate, removeUserFromRoomVoice } = require('./voiceHandler');
const seatingManager = require('./seatingManager');
const snapshotEngine = require('./snapshotEngine');
const { attachTimeSyncHandlers } = require('./timeSync');
const { LOBBY_SEATING_ZONES } = require('./DateeHomesLobbyCollision');
const PrivateRoom = require('../models/PrivateRoom');
const PrivateRoomMember = require('../models/PrivateRoomMember');

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
  'datee-homes-lobby',
  'sky-pier',
  'chunk_0_0', 'chunk_1_0', 'chunk_2_0',
  'chunk_0_1', 'chunk_1_1', 'chunk_2_1',
  'chunk_0_2', 'chunk_1_2', 'chunk_2_2'
];

// Datee Homes Lobby Seating Occupancy Maps
const lobbySeatOccupants = new Map(); // seatId -> { userId, socketId }
const userLobbySeats = new Map();     // userId -> seatId

// Datee Homes Private Room live occupants tracking: roomId -> Map(socketId, playerState)
const privateRoomOccupants = new Map();
const socketPrivateRooms = new Map(); // socketId -> roomId
const privateRoomChatHistory = new Map(); // roomId -> Array of message objects

// Rate Limit Tracking Maps (Chunk 7.5 Security)
const chatRateLimits = new Map(); // userId -> { count, resetAt }
const roomJoinRateLimits = new Map(); // userId -> { count, resetAt }

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
  snapshotEngine.start(io);

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
    // Attach high-precision NTP-style server time sync handler
    attachTimeSyncHandlers(socket);

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

      // Register with authoritative snapshot engine
      snapshotEngine.registerPlayer(socket.id, socket.user, {
        x: posX,
        y: posZ,
        campusArea: initialArea,
        direction: rotation
      });

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
     * Event: player:move & player:move_input
     * Authoritative movement validation & client input processing
     */
    const handlePlayerMove = (data = {}) => {
      let player = players.get(socket.id);
      if (!player) {
        // Self-Healing: if socket sent movement before or instead of campus:join,
        // dynamically register player in players Map and snapshotEngine
        const initialArea = VALID_AREAS.includes(data.campusArea || data.zone)
          ? data.campusArea || data.zone
          : 'datee-homes-lobby';
        const posX = typeof data.x === 'number' ? Math.max(0, Math.min(3800, data.x)) : 600;
        const posZ = typeof data.z === 'number' ? Math.max(0, Math.min(3800, data.z)) : (typeof data.y === 'number' ? data.y : 400);
        player = {
          socketId: socket.id,
          userId: verifiedUserId,
          name: verifiedName,
          displayName: verifiedName,
          role: verifiedRole,
          avatar: data.avatarConfig || data.avatar || socket.user?.avatar || {},
          campusArea: initialArea,
          position: [posX, 0, posZ],
          rotation: typeof data.rotation === 'string' ? data.rotation : (typeof data.facing === 'string' ? data.facing : 'down'),
          animationState: data.animationState || 'idle',
          onlineStatus: 'online',
          lastActive: Date.now()
        };
        players.set(socket.id, player);
        snapshotEngine.registerPlayer(socket.id, socket.user || player, {
          x: posX,
          y: posZ,
          campusArea: initialArea,
          direction: player.rotation
        });
        if (initialArea === 'datee-homes-lobby') {
          socket.join('area:datee-homes-lobby');
        } else {
          socket.join('campus:world');
          socket.join(`area:${initialArea}`);
        }
      }

      const newX = typeof data.x === 'number' ? Math.max(0, Math.min(3800, data.x)) : player.position[0];
      const newY = typeof data.y === 'number' ? data.y : 0;
      const newZ = typeof data.z === 'number' ? Math.max(0, Math.min(3800, data.z)) : player.position[2];
      const newRotation = typeof data.rotation === 'number' ? data.rotation : player.rotation;
      const animationState = data.animationState || (data.isMoving ? 'walk' : 'idle');
      const newArea = VALID_AREAS.includes(data.campusArea || data.zone)
        ? data.campusArea || data.zone
        : player.campusArea;

      // Authoritative validation via snapshot engine
      const validated = snapshotEngine.processMovementInput(socket.id, {
        x: newX,
        y: newZ,
        sequence: data.sequence,
        direction: newRotation,
        movementState: animationState,
        campusArea: newArea
      });

      if (validated) {
        player.position = [validated.x, 0, validated.y];
        player.rotation = validated.direction;
        player.animationState = validated.movementState;
      } else {
        player.position = [newX, newY, newZ];
        player.rotation = newRotation;
        player.animationState = animationState;
      }
      player.lastActive = Date.now();

      // Check for area transition
      if (newArea !== player.campusArea) {
        const oldArea = player.campusArea;
        player.campusArea = newArea;
        player.statusTag = `Exploring ${newArea.replace('-', ' ')}`;
        snapshotEngine.setPlayerZone(socket.id, newArea);

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

      // Check if player is inside an isolated private room
      const activePrivateRoomId = socketPrivateRooms.get(socket.id) || (data.campusArea === 'private-room' ? data.roomId : null);
      if (activePrivateRoomId) {
        const roomIdStr = activePrivateRoomId.toString();
        const roomMap = privateRoomOccupants.get(roomIdStr);
        const posX = typeof data.x === 'number' ? data.x : (typeof data.position?.[0] === 'number' ? data.position[0] : 400);
        const posY = typeof data.y === 'number' ? data.y : (typeof data.z === 'number' ? data.z : (typeof data.position?.[2] === 'number' ? data.position[2] : 420));
        const facing = data.facing || (typeof data.rotation === 'string' ? data.rotation : 'down');
        const isMoving = Boolean(data.isMoving);
        const isSeated = Boolean(data.isSeated);
        const animState = data.animationState || (isSeated ? 'sit' : (isMoving ? 'walk' : 'idle'));

        if (roomMap && roomMap.has(socket.id)) {
          const rp = roomMap.get(socket.id);
          rp.x = posX;
          rp.y = posY;
          rp.rotation = facing;
          rp.facing = facing;
          rp.animationState = animState;
          rp.isMoving = isMoving;
          rp.isSeated = isSeated;
        }

        const movePayload = {
          socketId: socket.id,
          userId: verifiedUserId,
          name: verifiedName,
          x: posX,
          y: posY,
          facing,
          rotation: facing,
          animationState: animState,
          isMoving,
          isSeated,
          avatarConfig: socket.user?.avatar || data.avatarConfig || data.avatar
        };

        // Broadcast movement to members inside room:${roomIdStr} and friend-lounge alias
        socket.to(`room:${roomIdStr}`).emit('private_room:peer_moved', movePayload);
        socket.to(`friend-lounge:${roomIdStr}`).emit('private_room:peer_moved', movePayload);
        return; // Strictly isolate private room movement from campus:world
      }

      // Backward-compatible legacy broadcast for any non-snapshot listeners (including DateeHomesLobby)
      const posX = player.position[0];
      const posY = player.position[2]; // 2D vertical coordinate corresponds to 3D z
      const facing = typeof player.rotation === 'string' ? player.rotation : (typeof data.facing === 'string' ? data.facing : 'down');
      const isMoving = player.animationState === 'walk';
      const isSeated = player.animationState === 'sit';

      socket.to('campus:world').emit('player:moved', {
        socketId: socket.id,
        userId: player.userId,
        name: player.name || verifiedName || 'Resident',
        position: player.position,
        x: posX,
        y: posY,
        z: posY,
        rotation: facing,
        facing,
        animationState: player.animationState,
        isMoving,
        isSeated,
        campusArea: player.campusArea,
        avatarConfig: socket.user?.avatar || player.avatar || {}
      });
    };

    socket.on('player:move', handlePlayerMove);
    socket.on('player_move', handlePlayerMove);
    socket.on('player:move_input', handlePlayerMove);

    /**
     * Event: player_avatar_update
     * Instantly broadcast wardrobe outfit changes across campus, lobby, and private rooms
     */
    socket.on('player_avatar_update', (data = {}) => {
      const avatar = data.avatar || data.avatarConfig || {};
      const player = players.get(socket.id);
      if (player) {
        player.avatar = avatar;
      }
      if (socket.user) {
        socket.user.avatar = avatar;
      }
      const activePrivateRoomId = socketPrivateRooms.get(socket.id);
      if (activePrivateRoomId) {
        io.to(`room:${activePrivateRoomId}`).emit('player:avatar_changed', {
          socketId: socket.id,
          userId: verifiedUserId,
          avatar
        });
      }
      if (player?.campusArea === 'datee-homes-lobby') {
        io.to('area:datee-homes-lobby').emit('player:avatar_changed', {
          socketId: socket.id,
          userId: verifiedUserId,
          avatar
        });
      }
      io.to('campus:world').emit('player:avatar_changed', {
        socketId: socket.id,
        userId: verifiedUserId,
        avatar
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

      // Update authoritative snapshot engine
      snapshotEngine.setPlayerSeated(socket.id, true, data.seatId, data.x, data.y, data.facing);

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

      // Update authoritative snapshot engine
      snapshotEngine.setPlayerSeated(socket.id, false, null, data.x, data.y);

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
     * Datee Homes Lobby Seating Events (Chunk 0.6)
     * Authoritative seat validation, occupancy broadcast, and state sync
     */
    socket.on('datee_homes:get_seats', () => {
      const occupied = {};
      for (const [seatId, rec] of lobbySeatOccupants) {
        occupied[seatId] = rec.userId;
      }
      socket.emit('datee_homes:seats_state', { occupiedSeats: occupied });
    });

    socket.on('datee_homes:get_occupants', () => {
      const occupants = [];
      for (const [sId, p] of players) {
        if (
          sId !== socket.id &&
          (p.campusArea === 'datee-homes-lobby' || p.campusArea === 'DATEE_HOMES_LOBBY') &&
          !socketPrivateRooms.has(sId)
        ) {
          occupants.push({
            socketId: sId,
            userId: p.userId,
            name: p.name || p.displayName || 'Resident',
            x: p.position?.[0] ?? 600,
            y: p.position?.[2] ?? 400,
            facing: typeof p.rotation === 'string' ? p.rotation : 'down',
            isMoving: p.animationState === 'walk',
            isSeated: p.animationState === 'sit',
            animationState: p.animationState || 'idle',
            avatarConfig: p.avatar || {}
          });
        }
      }
      socket.emit('datee_homes:occupants_list', { occupants });
    });

    socket.on('datee_homes:sit_request', (data = {}) => {
      const { seatId } = data;
      if (!seatId) return;

      const seat = LOBBY_SEATING_ZONES.find((s) => s.seatId === seatId);
      if (!seat) {
        socket.emit('datee_homes:sit_rejected', { seatId, reason: 'Invalid seat' });
        return;
      }

      const occupant = lobbySeatOccupants.get(seatId);
      if (occupant && occupant.userId !== verifiedUserId) {
        socket.emit('datee_homes:sit_rejected', { seatId, reason: 'Seat already occupied' });
        return;
      }

      // Vacate user's previous seat if any
      const prevSeatId = userLobbySeats.get(verifiedUserId);
      if (prevSeatId && prevSeatId !== seatId) {
        lobbySeatOccupants.delete(prevSeatId);
        io.to('campus:world').emit('datee_homes:seat_vacated', {
          seatId: prevSeatId,
          userId: verifiedUserId
        });
      }

      lobbySeatOccupants.set(seatId, { userId: verifiedUserId, socketId: socket.id });
      userLobbySeats.set(verifiedUserId, seatId);

      const player = players.get(socket.id);
      if (player) {
        player.isSeated = true;
        player.seatId = seatId;
        player.animationState = 'sit';
        player.position[0] = seat.anchorX;
        player.position[2] = seat.anchorY;
        player.rotation = seat.facing;
      }

      snapshotEngine.setPlayerSeated(socket.id, true, seatId, seat.anchorX, seat.anchorY, seat.facing);

      socket.emit('datee_homes:sit_approved', {
        seatId,
        anchorX: seat.anchorX,
        anchorY: seat.anchorY,
        facing: seat.facing
      });

      io.to('campus:world').emit('datee_homes:seat_occupied', {
        seatId,
        userId: verifiedUserId,
        socketId: socket.id,
        x: seat.anchorX,
        y: seat.anchorY,
        facing: seat.facing
      });
    });

    socket.on('datee_homes:stand_request', () => {
      const seatId = userLobbySeats.get(verifiedUserId);
      const seat = seatId ? LOBBY_SEATING_ZONES.find((s) => s.seatId === seatId) : null;

      if (seatId) {
        lobbySeatOccupants.delete(seatId);
        userLobbySeats.delete(verifiedUserId);
      }

      const player = players.get(socket.id);
      if (player) {
        player.isSeated = false;
        player.seatId = null;
        player.animationState = 'idle';
        if (seat) {
          player.position[0] = seat.standX;
          player.position[2] = seat.standY;
        }
      }

      snapshotEngine.setPlayerSeated(socket.id, false, null, seat?.standX, seat?.standY);

      socket.emit('datee_homes:stand_approved', {
        standX: seat?.standX,
        standY: seat?.standY
      });

      io.to('campus:world').emit('datee_homes:seat_vacated', {
        seatId,
        userId: verifiedUserId,
        socketId: socket.id,
        standX: seat?.standX,
        standY: seat?.standY
      });
    });

    /**
     * Datee Homes Private Room Multiplayer Events (Chunk 4)
     * Authoritative access check, live presence, and isolated room movement channel
     */
    socket.on('private_room:join', async (data = {}, callback) => {
      try {
        const { roomId } = data;
        if (!roomId) {
          const err = { success: false, error: 'Room ID is required.' };
          if (typeof callback === 'function') callback(err);
          return socket.emit('private_room:error', err);
        }

        // 1. Rate limiting on room joins (max 5 per 3 seconds)
        const now = Date.now();
        let joinRate = roomJoinRateLimits.get(verifiedUserId);
        if (!joinRate || now - joinRate.resetAt > 3000) {
          joinRate = { count: 0, resetAt: now + 3000 };
          roomJoinRateLimits.set(verifiedUserId, joinRate);
        }
        joinRate.count++;
        if (joinRate.count > 5) {
          const err = { success: false, error: 'You are joining rooms too rapidly. Please wait a moment.' };
          if (typeof callback === 'function') callback(err);
          return socket.emit('private_room:error', err);
        }

        let room = null;
        if (mongoose.Types.ObjectId.isValid(roomId)) {
          room = await PrivateRoom.findById(roomId);
        } else {
          // If roomCode was passed as roomId or non-ObjectId identifier
          room = await PrivateRoom.findOne({ roomCode: String(roomId).toUpperCase() });
        }

        const isDemoOrLocal =
          String(roomId).startsWith('room-demo-') ||
          String(roomId).startsWith('room_');

        if (!room) {
          if (isDemoOrLocal) {
            room = {
              _id: roomId,
              name: roomId === 'room-demo-1' ? 'Our Cozy Suite' : 'Campus Chai & Chill',
              roomCode: roomId === 'room-demo-1' ? 'LOVE24' : 'HANG07',
              type: roomId === 'room-demo-1' ? 'COUPLE' : 'FRIENDS',
              maxPlayers: roomId === 'room-demo-1' ? 2 : 6,
              ownerId: verifiedUserId,
              status: 'ACTIVE'
            };
          } else {
            const err = { success: false, error: 'Room not found or no longer active.' };
            if (typeof callback === 'function') callback(err);
            return socket.emit('private_room:error', err);
          }
        }

        let membership = null;
        if (mongoose.Types.ObjectId.isValid(room._id)) {
          // Check block with owner
          if (room.ownerId && mongoose.Types.ObjectId.isValid(room.ownerId)) {
            const isBlocked = await Block.findOne({
              $or: [
                { blocker: verifiedUserId, blocked: room.ownerId },
                { blocker: room.ownerId, blocked: verifiedUserId }
              ]
            });

            if (isBlocked) {
              const err = { success: false, error: 'Access to this room is restricted due to block settings.' };
              if (typeof callback === 'function') callback(err);
              return socket.emit('private_room:error', err);
            }
          }

          // Authoritative membership check
          membership = await PrivateRoomMember.findOne({
            roomId: room._id,
            userId: verifiedUserId
          });

          if (!membership && room.ownerId && room.ownerId.toString() !== verifiedUserId) {
            const err = { success: false, error: 'You are not an authorized member of this private lounge.' };
            if (typeof callback === 'function') callback(err);
            return socket.emit('private_room:error', err);
          }
        }

        const roomIdStr = (room._id || roomId).toString();

        // 2. Strict capacity check: MAX 6 users for Friend Lounge per specification
        if (!privateRoomOccupants.has(roomIdStr)) {
          privateRoomOccupants.set(roomIdStr, new Map());
        }
        const roomMap = privateRoomOccupants.get(roomIdStr);
        const maxCapacity = room.type === 'FRIENDS' ? 6 : 2;
        if (!roomMap.has(socket.id) && roomMap.size >= maxCapacity) {
          const err = {
            success: false,
            error: `No space available. This ${room.type === 'FRIENDS' ? 'lounge' : 'room'} is currently full (${maxCapacity} max).`
          };
          if (typeof callback === 'function') callback(err);
          return socket.emit('private_room:error', err);
        }

        // 3. Block check against any existing room occupants
        for (const occupant of roomMap.values()) {
          if (occupant.userId && occupant.userId !== verifiedUserId) {
            const hasBlock = await Block.findOne({
              $or: [
                { blocker: verifiedUserId, blocked: occupant.userId },
                { blocker: occupant.userId, blocked: verifiedUserId }
              ]
            });
            if (hasBlock) {
              const err = { success: false, error: 'Access restricted due to block settings with an occupant.' };
              if (typeof callback === 'function') callback(err);
              return socket.emit('private_room:error', err);
            }
          }
        }

        // Leave any prior private room channel
        const prevRoomId = socketPrivateRooms.get(socket.id);
        if (prevRoomId && prevRoomId !== roomIdStr) {
          socket.leave(`room:${prevRoomId}`);
          socket.leave(`friend-lounge:${prevRoomId}`);
          const prevMap = privateRoomOccupants.get(prevRoomId);
          if (prevMap) {
            prevMap.delete(socket.id);
            socket.to(`room:${prevRoomId}`).emit('private_room:peer_left', {
              socketId: socket.id,
              userId: verifiedUserId
            });
            socket.to(`friend-lounge:${prevRoomId}`).emit('private_room:peer_left', {
              socketId: socket.id,
              userId: verifiedUserId
            });
          }
          removeUserFromRoomVoice(prevRoomId, verifiedUserId, io);
        }

        // Join socket room channels (both standard and friend-lounge alias)
        socket.join(`room:${roomIdStr}`);
        socket.join(`friend-lounge:${roomIdStr}`);
        socketPrivateRooms.set(socket.id, roomIdStr);

        // Vacate any Datee Homes Lobby seat
        const lobbySeatId = userLobbySeats.get(verifiedUserId);
        if (lobbySeatId) {
          lobbySeatOccupants.delete(lobbySeatId);
          userLobbySeats.delete(verifiedUserId);
          io.to('campus:world').emit('datee_homes:seat_vacated', {
            seatId: lobbySeatId,
            userId: verifiedUserId
          });
        }

        // Update player's active campus area to private-room
        const player = players.get(socket.id);
        const oldArea = player?.campusArea || 'datee-homes-lobby';
        if (player) {
          player.campusArea = 'private-room';
          player.isSeated = false;
        }
        snapshotEngine.setPlayerZone(socket.id, 'private-room');

        // Immediately notify Datee Homes Lobby that this player entered a private room and left the lobby
        socket.leave('area:datee-homes-lobby');
        socket.to('area:datee-homes-lobby').emit('player:left_area', {
          socketId: socket.id,
          userId: verifiedUserId,
          oldArea,
          newArea: 'private-room'
        });
        socket.to('campus:world').emit('player:left', {
          socketId: socket.id,
          userId: verifiedUserId,
          campusArea: 'datee-homes-lobby'
        });
        socket.to('campus:world').emit('player:area_changed', {
          socketId: socket.id,
          userId: verifiedUserId,
          oldArea,
          newArea: 'private-room'
        });

        const playerState = {
          socketId: socket.id,
          userId: verifiedUserId,
          name: verifiedName,
          role: membership?.role || 'MEMBER',
          x: typeof data.x === 'number' ? data.x : 400,
          y: typeof data.y === 'number' ? data.y : 420,
          rotation: 'down',
          animationState: 'idle',
          isMoving: false,
          avatarConfig: socket.user?.avatar || data.avatar || {}
        };
        roomMap.set(socket.id, playerState);

        // Notify caller with current room occupants list
        const occupantsList = Array.from(roomMap.values()).filter((p) => p.socketId !== socket.id);
        socket.emit('private_room:joined', {
          roomId: roomIdStr,
          room: {
            id: room._id,
            roomCode: room.roomCode,
            code: room.roomCode,
            name: room.name,
            type: room.type,
            maxPlayers: maxCapacity,
            theme: room.theme,
            state: room.state
          },
          occupants: occupantsList
        });

        // Broadcast to other peers inside this room
        socket.to(`room:${roomIdStr}`).emit('private_room:peer_joined', {
          player: playerState
        });
        socket.to(`friend-lounge:${roomIdStr}`).emit('private_room:peer_joined', {
          player: playerState
        });

        if (typeof callback === 'function') {
          callback({ success: true, roomId: roomIdStr });
        }
      } catch (err) {
        console.error('[Socket] private_room:join error:', err);
        if (typeof callback === 'function') callback({ success: false, error: err.message });
      }
    });

    socket.on('private_room:leave', ({ roomId } = {}) => {
      const activeId = roomId ? roomId.toString() : socketPrivateRooms.get(socket.id);
      if (activeId) {
        socket.leave(`room:${activeId}`);
        socket.leave(`friend-lounge:${activeId}`);
        socketPrivateRooms.delete(socket.id);

        const player = players.get(socket.id);
        if (player) {
          player.campusArea = 'datee-homes-lobby';
          player.isSeated = false;
        }
        snapshotEngine.setPlayerZone(socket.id, 'datee-homes-lobby');
        socket.join('area:datee-homes-lobby');
        socket.to('area:datee-homes-lobby').emit('player:joined_area', {
          socketId: socket.id,
          userId: verifiedUserId,
          campusArea: 'datee-homes-lobby'
        });
        socket.to('campus:world').emit('player:area_changed', {
          socketId: socket.id,
          userId: verifiedUserId,
          oldArea: 'private-room',
          newArea: 'datee-homes-lobby'
        });

        const roomMap = privateRoomOccupants.get(activeId);
        if (roomMap) {
          roomMap.delete(socket.id);
          socket.to(`room:${activeId}`).emit('private_room:peer_left', {
            socketId: socket.id,
            userId: verifiedUserId
          });
          socket.to(`friend-lounge:${activeId}`).emit('private_room:peer_left', {
            socketId: socket.id,
            userId: verifiedUserId
          });
        }
        removeUserFromRoomVoice(activeId, verifiedUserId, io);
      }
    });

    /**
     * Private Room & Friend Lounge Group Chat (Chunk 7.5)
     * Authoritative sender derivation, rate limiting, room occupancy verification, and isolated broadcast.
     */
    const handleSendRoomChat = async (data = {}, callback) => {
      try {
        if (!verifiedUserId) {
          const err = { success: false, error: 'Authentication required to send chat messages.' };
          if (typeof callback === 'function') callback(err);
          return socket.emit('private_room:error', err);
        }

        // Rate limit: max 5 messages per 3 seconds
        const now = Date.now();
        let rate = chatRateLimits.get(verifiedUserId);
        if (!rate || now - rate.resetAt > 3000) {
          rate = { count: 0, resetAt: now + 3000 };
          chatRateLimits.set(verifiedUserId, rate);
        }
        rate.count++;
        if (rate.count > 5) {
          const err = { success: false, error: 'You are sending messages too quickly. Please slow down.' };
          if (typeof callback === 'function') callback(err);
          return socket.emit('private_room:error', err);
        }

        const activeRoomId = data.roomId ? data.roomId.toString() : socketPrivateRooms.get(socket.id);
        if (!activeRoomId) {
          const err = { success: false, error: 'You are not inside this lounge.' };
          if (typeof callback === 'function') callback(err);
          return socket.emit('private_room:error', err);
        }

        // Authoritative membership/occupancy verification
        const roomMap = privateRoomOccupants.get(activeRoomId);
        if (!roomMap || !roomMap.has(socket.id)) {
          const err = { success: false, error: 'You must be inside this lounge to send messages.' };
          if (typeof callback === 'function') callback(err);
          return socket.emit('private_room:error', err);
        }

        const text = String(data.text || '').trim();
        if (!text) {
          const err = { success: false, error: 'Message cannot be empty.' };
          if (typeof callback === 'function') callback(err);
          return socket.emit('private_room:error', err);
        }

        const cleanText = text.substring(0, 500);
        const senderAvatar = socket.user?.avatar || data.avatar || {};
        const senderName = socket.user?.name || verifiedName || 'Member';

        // STRICT SECURITY: senderId is ALWAYS verifiedUserId, NEVER client-supplied data.senderId
        const messageObj = {
          id: `pmsg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          roomId: activeRoomId,
          senderId: verifiedUserId, // Authoritative identity
          senderName: senderName,
          senderAvatar: senderAvatar,
          text: cleanText,
          timestamp: new Date().toISOString()
        };

        if (!privateRoomChatHistory.has(activeRoomId)) {
          privateRoomChatHistory.set(activeRoomId, []);
        }
        const history = privateRoomChatHistory.get(activeRoomId);
        history.push(messageObj);
        if (history.length > 50) {
          history.shift();
        }

        // Broadcast ONLY to members inside room:${activeRoomId} and friend-lounge:${activeRoomId}
        io.to(`room:${activeRoomId}`).emit('private_room:chat_message', messageObj);
        io.to(`friend-lounge:${activeRoomId}`).emit('private_room:chat_message', messageObj);

        // Also emit peer speech bubble for canvas overlay
        io.to(`room:${activeRoomId}`).emit('private_room:peer_speech', {
          socketId: socket.id,
          userId: verifiedUserId,
          displayName: senderName,
          text: cleanText,
          timestamp: messageObj.timestamp
        });

        if (typeof callback === 'function') {
          callback({ success: true, message: messageObj });
        }
      } catch (err) {
        console.error('[Socket] private_room:send_chat error:', err);
        if (typeof callback === 'function') callback({ success: false, error: err.message });
      }
    };

    socket.on('private_room:send_chat', handleSendRoomChat);
    socket.on('friend_lounge:send_chat', handleSendRoomChat);

    const handleGetRoomChat = async ({ roomId } = {}, callback) => {
      try {
        const activeRoomId = roomId ? roomId.toString() : socketPrivateRooms.get(socket.id);
        if (!activeRoomId) {
          const err = { success: false, error: 'Room ID is required.' };
          if (typeof callback === 'function') callback(err);
          return socket.emit('private_room:error', err);
        }

        // STRICT SECURITY: Verify caller is an authorized member or active occupant before returning history
        const roomMap = privateRoomOccupants.get(activeRoomId);
        const isOccupant = roomMap && roomMap.has(socket.id);

        let isAuthorized = isOccupant;
        if (!isAuthorized) {
          const isDemoOrLocal = activeRoomId.startsWith('room-demo-') || activeRoomId.startsWith('room_');
          if (isDemoOrLocal) {
            isAuthorized = true;
          } else if (mongoose.Types.ObjectId.isValid(activeRoomId)) {
            const room = await PrivateRoom.findById(activeRoomId);
            if (room) {
              const isOwner = room.ownerId && room.ownerId.toString() === verifiedUserId;
              const isMember = await PrivateRoomMember.exists({ roomId: room._id, userId: verifiedUserId });
              isAuthorized = isOwner || isMember;
            }
          }
        }

        if (!isAuthorized) {
          const err = { success: false, error: 'Unauthorized to view room chat history.' };
          if (typeof callback === 'function') callback(err);
          return socket.emit('private_room:error', err);
        }

        const history = privateRoomChatHistory.has(activeRoomId)
          ? privateRoomChatHistory.get(activeRoomId)
          : [];

        if (typeof callback === 'function') {
          callback({ success: true, messages: history });
        } else {
          socket.emit('private_room:chat_history', { roomId: activeRoomId, messages: history });
        }
      } catch (err) {
        console.error('[Socket] private_room:get_chat error:', err);
        if (typeof callback === 'function') callback({ success: false, error: err.message });
      }
    };

    socket.on('private_room:get_chat', handleGetRoomChat);
    socket.on('friend_lounge:get_chat', handleGetRoomChat);

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
     * Event: player_speech & player:speech
     * Avatar proximity/world speech bubble broadcast across campus
     */
    const handlePlayerSpeech = (data = {}) => {
      const player = players.get(socket.id);
      const text = String(data.text || data.content || '').trim().substring(0, 100);
      if (!text) return;

      const userId = player?.userId || socket.user?._id?.toString() || verifiedUserId;
      const displayName = player?.displayName || socket.user?.name || verifiedName;
      const area = player?.campusArea || 'main-plaza';

      const speechPayload = {
        socketId: socket.id,
        userId,
        displayName,
        text,
        timestamp: new Date().toISOString()
      };

      io.to('campus:world').emit('player:speech', speechPayload);
      if (area) {
        io.to(`area:${area}`).emit('player:speech', speechPayload);
      }
    };

    socket.on('player_speech', handlePlayerSpeech);
    socket.on('player:speech', handlePlayerSpeech);

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
          await notificationService.createAndEmitNotification({
            recipient: partnerId,
            sender: socket.user._id,
            type: 'new_message',
            title: 'New Message',
            message: `${verifiedName}: "${cleanText.substring(0, 60)}"`,
            data: {
              conversation_id: conversation._id.toString(),
              message_id: directMessage._id.toString(),
              actionUrl: '/messages'
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
        snapshotEngine.unregisterPlayer(socket.id);

        // Broadcast to campus world that this player left
        socket.to('campus:world').emit('player:left', {
          socketId: socket.id,
          userId: player.userId
        });

        if (player.campusArea === 'datee-homes-lobby') {
          socket.to('area:datee-homes-lobby').emit('player:left', {
            socketId: socket.id,
            userId: player.userId
          });
          socket.to('area:datee-homes-lobby').emit('player:left_area', {
            socketId: socket.id,
            userId: player.userId,
            oldArea: 'datee-homes-lobby'
          });
        }

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

      // 5. Datee Homes Lobby Seating cleanup
      const dcLobbySeat = userLobbySeats.get(verifiedUserId);
      if (dcLobbySeat) {
        lobbySeatOccupants.delete(dcLobbySeat);
        userLobbySeats.delete(verifiedUserId);
        io.to('campus:world').emit('datee_homes:seat_vacated', {
          seatId: dcLobbySeat,
          userId: verifiedUserId,
          socketId: socket.id
        });
      }

      // 6. Private Room presence cleanup
      const dcPrivateRoomId = socketPrivateRooms.get(socket.id);
      if (dcPrivateRoomId) {
        socketPrivateRooms.delete(socket.id);
        const roomMap = privateRoomOccupants.get(dcPrivateRoomId);
        if (roomMap) {
          roomMap.delete(socket.id);
          socket.to(`room:${dcPrivateRoomId}`).emit('private_room:peer_left', {
            socketId: socket.id,
            userId: verifiedUserId
          });
        }
      }
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
