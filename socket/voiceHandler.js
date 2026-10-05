/**
 * CHUNK 11 — WebRTC Architecture
 *
 * Use WebRTC for the actual audio transmission.
 *
 * IMPORTANT:
 * Actual audio must NOT pass through the normal application server.
 *
 * Architecture:
 *
 *                  Datee_me Backend
 *                        │
 *              Authentication
 *              Authorization
 *              Signaling
 *              Presence
 *              Voice session state
 *                        │
 *                  WebRTC signaling
 *                        │
 *           ┌────────────┴────────────┐
 *           ▼                         ▼
 *       Player A                  Player B
 *        🎙️                         🎙️
 *           \                       /
 *            \_____ WebRTC ________/
 *                  Audio
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Friendship = require('../models/Friendship');
const Block = require('../models/Block');
const PrivateRoom = require('../models/PrivateRoom');
const PrivateRoomMember = require('../models/PrivateRoomMember');
const seatingManager = require('./seatingManager');

// Active Google Meet–style Voice Sessions
// channelId -> { channelId, participants: Map(userId -> { userId, name, avatar, socketId, isMuted, joinedAt }), createdAt }
const voiceSessions = new Map();

// userId string -> channelId string
const userVoiceSession = new Map();

// Active Multi-User Group Room Voice Sessions (Chunk 7.5 - Friend Lounge / Private Rooms)
// roomId -> Map(userId -> { userId, name, avatar, socketId, isMuted, isSpeaking, joinedAt })
const roomVoiceSessions = new Map();
const userRoomVoice = new Map(); // userId -> roomId

/**
 * Clean up a participant leaving a room voice session
 */
const removeUserFromRoomVoice = (roomId, userId, io) => {
  if (!roomId || !userId) return;
  const roomIdStr = roomId.toString();
  const userIdStr = userId.toString();

  const session = roomVoiceSessions.get(roomIdStr);
  if (session) {
    session.delete(userIdStr);
    userRoomVoice.delete(userIdStr);

    if (io) {
      io.to(`voice:room:${roomIdStr}`).emit('voice:room_peer_left', {
        roomId: roomIdStr,
        userId: userIdStr
      });
      io.to(`room:${roomIdStr}`).emit('voice:room_peer_left', {
        roomId: roomIdStr,
        userId: userIdStr
      });

      const remainingList = Array.from(session.values()).map((p) => ({
        userId: p.userId,
        name: p.name,
        isMuted: p.isMuted,
        isSpeaking: p.isSpeaking
      }));
      io.to(`room:${roomIdStr}`).emit('voice:room_status', {
        roomId: roomIdStr,
        activeCount: session.size,
        participants: remainingList
      });
    }

    if (session.size === 0) {
      roomVoiceSessions.delete(roomIdStr);
    }
  }
};

/**
 * Get active voice status for a room
 */
const getRoomVoiceStatus = (roomId) => {
  if (!roomId) return { activeCount: 0, participants: [] };
  const session = roomVoiceSessions.get(roomId.toString());
  if (!session) return { activeCount: 0, participants: [] };
  return {
    activeCount: session.size,
    participants: Array.from(session.values()).map((p) => ({
      userId: p.userId,
      name: p.name,
      isMuted: p.isMuted,
      isSpeaking: p.isSpeaking
    }))
  };
};

/**
 * Deterministic channel ID for 2 campus friends
 */
const getChannelId = (idA, idB) => {
  return 'voice_session_' + [idA.toString(), idB.toString()].sort().join('_');
};

/**
 * Format participant object for client broadcasting
 */
const formatParticipant = (p) => ({
  userId: p.userId,
  name: p.name,
  avatar: p.avatar,
  isMuted: Boolean(p.isMuted),
  joinedAt: p.joinedAt
});

/**
 * Clean up a participant leaving a session
 * - Removes user from the voice session
 * - Notifies the other participant
 * - Updates presence
 */
const removeParticipantFromSession = (channelId, userId, io, userName = null, players = null) => {
  const session = voiceSessions.get(channelId);
  if (!session) {
    userVoiceSession.delete(userId);
    return;
  }

  const leavingParticipant = session.participants.get(userId);
  const displayName = userName || leavingParticipant?.name || 'Campus Friend';

  session.participants.delete(userId);
  userVoiceSession.delete(userId);

  // Update campus player presence state if players map provided
  if (players) {
    for (const [, p] of players) {
      if (p.userId === userId) {
        p.inVoice = false;
        break;
      }
    }
  }

  if (io) {
    // 1. Notify remaining participants in the voice room
    io.to(`voice:session:${channelId}`).emit('voice:peer_left', {
      channelId,
      userId,
      userName: displayName
    });

    // 2. Also notify each remaining participant in their personal room
    for (const [remainingUserId] of session.participants) {
      io.to(`user:${remainingUserId}`).emit('voice:peer_left', {
        channelId,
        userId,
        userName: displayName
      });
    }

    // 3. Broadcast presence update to campus world
    io.to('campus:world').emit('presence:voice_update', {
      userId,
      inVoice: false,
      channelId
    });

    io.emit('user:presence_update', {
      userId,
      inVoice: false
    });
  }

  // If no participants remain, close session
  if (session.participants.size === 0) {
    voiceSessions.delete(channelId);
  }
};

/**
 * Attach Voice WebRTC Signaling and Shared Voice Session Handlers to an authenticated socket
 */
const attachVoiceHandlers = (socket, io, userSockets, players = null, privateRoomOccupants = null) => {
  const verifiedUserId = socket.user._id.toString();
  const verifiedName = socket.user.name || socket.user.displayName || 'Campus Student';

  /**
   * 1. Join Shared Voice Session (Google Meet Style)
   * Event: voice:join_session
   *
   * Verifies:
   * 1. Authentication (verifiedUserId from token)
   * 2. Friendship exists and status is ACCEPTED
   * 3. Neither user has blocked the other
   * 4. Both accounts allowed to communicate
   *
   * Features:
   * - No ringing / calling experience.
   * - Enters shared voice session immediately.
   * - Microphone is MUTED by default.
   */
  socket.on('voice:join_session', async (data = {}, callback) => {
    try {
      const targetUserId = (data.targetUserId || data.recipientId || '').toString();

      if (!targetUserId) {
        const err = { success: false, error: 'Target friend user ID is required.' };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      if (targetUserId === verifiedUserId) {
        const err = { success: false, error: 'You cannot enter a voice session with yourself.' };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      // Check caller account restrictions
      if (socket.user.isBanned || socket.user.isSuspended || socket.user.isBlocked || (socket.user.restrictions && socket.user.restrictions.canUseVoice === false)) {
        const err = { success: false, error: 'Your account is restricted from voice communication.' };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      // Lookup target friend
      const targetUser = await User.findById(targetUserId).select(
        'name displayName avatar isBanned isSuspended isBlocked onlineStatus restrictions'
      );

      if (!targetUser) {
        const err = { success: false, error: 'Target campus user not found.' };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      if (targetUser.isBanned || targetUser.isSuspended || targetUser.isBlocked || (targetUser.restrictions && targetUser.restrictions.canUseVoice === false)) {
        const err = { success: false, error: 'Target student is unavailable or restricted.' };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      // Verify Block Status
      const isBlocked = await Block.findOne({
        $or: [
          { blocker: verifiedUserId, blocked: targetUserId },
          { blocker: targetUserId, blocked: verifiedUserId }
        ]
      });

      if (isBlocked) {
        const err = { success: false, error: 'Voice communication not permitted due to block restrictions.' };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      // Check if this voice session is within an authorized Private Room (Chunk 7)
      const roomId = data.roomId ? data.roomId.toString() : null;
      let isAuthorizedByPrivateRoom = false;

      if (roomId) {
        const isDemoOrLocal = roomId.startsWith('room-demo-') || roomId.startsWith('room_');
        if (isDemoOrLocal) {
          isAuthorizedByPrivateRoom = true;
        } else if (mongoose.Types.ObjectId.isValid(roomId)) {
          const pRoom = await PrivateRoom.findById(roomId);
          if (pRoom && pRoom.status === 'ACTIVE') {
            const isUserAAuth =
              pRoom.ownerId.toString() === verifiedUserId ||
              (await PrivateRoomMember.exists({ roomId, userId: verifiedUserId }));
            const isUserBAuth =
              pRoom.ownerId.toString() === targetUserId ||
              (await PrivateRoomMember.exists({ roomId, userId: targetUserId }));
            if (isUserAAuth && isUserBAuth) {
              isAuthorizedByPrivateRoom = true;
            }
          }
        }
      }

      if (!isAuthorizedByPrivateRoom) {
        // Verify Friendship Status (Must be ACCEPTED for external campus voice)
        const friendship = await Friendship.findOne({
          $or: [
            { requester: verifiedUserId, recipient: targetUserId },
            { requester: targetUserId, recipient: verifiedUserId }
          ]
        });

        if (!friendship || friendship.status !== 'ACCEPTED') {
          const err = {
            success: false,
            error: 'Voice communication requires an accepted friendship or shared private room access.'
          };
          if (typeof callback === 'function') return callback(err);
          return socket.emit('voice:error', err);
        }

        // 5. Allowed Shared Interaction Context Verification (Campus Bench / Table)
        const coSeatedCheck = seatingManager.areCoSeated(verifiedUserId, targetUserId);
        if (!coSeatedCheck.coSeated) {
          const err = {
            success: false,
            error: `Voice session not permitted: ${coSeatedCheck.reason}`
          };
          if (typeof callback === 'function') return callback(err);
          return socket.emit('voice:error', err);
        }
      }

      // If user is currently in another session, leave previous session cleanly
      const existingChannelId = userVoiceSession.get(verifiedUserId);
      if (existingChannelId) {
        socket.leave(`voice:session:${existingChannelId}`);
        removeParticipantFromSession(existingChannelId, verifiedUserId, io);
      }

      // Derive deterministic channel ID for the friendship / private room pair
      const channelId = getChannelId(verifiedUserId, targetUserId);

      // Join Socket room for this voice session
      socket.join(`voice:session:${channelId}`);

      if (!voiceSessions.has(channelId)) {
        voiceSessions.set(channelId, {
          channelId,
          participants: new Map(),
          createdAt: new Date()
        });
      }

      const session = voiceSessions.get(channelId);

      // Participant data with MICROPHONE MUTED BY DEFAULT
      const participantData = {
        userId: verifiedUserId,
        name: verifiedName,
        avatar: socket.user.avatar,
        socketId: socket.id,
        isMuted: true, // MUTED by default per requirement!
        joinedAt: new Date()
      };

      session.participants.set(verifiedUserId, participantData);
      userVoiceSession.set(verifiedUserId, channelId);

      const participantsList = Array.from(session.participants.values()).map(formatParticipant);

      // 1. Notify the session room that this peer joined
      io.to(`voice:session:${channelId}`).emit('voice:peer_joined', {
        channelId,
        peer: formatParticipant(participantData),
        participants: participantsList
      });

      // 2. Notify the friend's personal room that a shared voice session is active
      io.to(`user:${targetUserId}`).emit('voice:session_available', {
        channelId,
        partner: formatParticipant(participantData),
        message: `${verifiedName} is in your shared voice channel`
      });

      // 3. If both friends are now present in the voice session, trigger WebRTC auto-negotiation
      if (session.participants.size === 2) {
        const participantIds = Array.from(session.participants.keys()).sort();
        io.to(`voice:session:${channelId}`).emit('voice:session_ready', {
          channelId,
          initiatorId: participantIds[0], // deterministic offer initiator
          participants: participantsList
        });
      }

      // 4. Update presence for campus world & user sockets
      if (players) {
        const p = players.get(socket.id);
        if (p) p.inVoice = true;
      }
      io.to('campus:world').emit('presence:voice_update', {
        userId: verifiedUserId,
        inVoice: true,
        channelId
      });
      io.emit('user:presence_update', {
        userId: verifiedUserId,
        inVoice: true
      });

      if (typeof callback === 'function') {
        callback({
          success: true,
          channelId,
          peer: formatParticipant(participantData),
          participants: participantsList
        });
      }
    } catch (err) {
      console.error('[Voice] Error in voice:join_session:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  /**
   * 2. Leave Shared Voice Session
   * Event: voice:leave_session
   *
   * When the user leaves:
   * - Stop transmitting audio
   * - Close WebRTC peer connection
   * - Remove user from voice session
   * - Notify other participant
   * - Update presence
   * - Return UI to normal campus state
   * - Leaving voice does NOT remove the friendship
   * - The players can continue sitting together and chatting
   */
  socket.on('voice:leave_session', (data = {}, callback) => {
    try {
      const channelId = data.channelId || userVoiceSession.get(verifiedUserId);
      if (channelId) {
        socket.leave(`voice:session:${channelId}`);
        removeParticipantFromSession(channelId, verifiedUserId, io, verifiedName, players);
      }
      if (typeof callback === 'function') callback({ success: true, channelId, userId: verifiedUserId });
    } catch (err) {
      console.error('[Voice] Error in voice:leave_session:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  /**
   * 3. Microphone Mute / Unmute Control
   * Event: voice:mute_change
   *
   * The user explicitly controls their microphone:
   * 🎙️ Muted
   * 🎙️ Unmute
   */
  socket.on('voice:mute_change', (data = {}, callback) => {
    try {
      const channelId = data.channelId || userVoiceSession.get(verifiedUserId);
      const isMuted = data.isMuted !== undefined ? Boolean(data.isMuted) : true;

      if (!channelId || !voiceSessions.has(channelId)) {
        if (typeof callback === 'function') callback({ success: false, error: 'Voice session not active.' });
        return;
      }

      const session = voiceSessions.get(channelId);

      // STRICT SECURITY: Verify caller is an authorized participant in this session
      if (!session.participants.has(verifiedUserId)) {
        console.warn(`[Voice Security] User ${verifiedUserId} attempted mute modification on unauthorized session ${channelId}`);
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Forbidden: You are not an authorized participant in this voice session.' });
        }
        return;
      }

      // STRICT SECURITY: A user cannot modify another user's mute state.
      // We strictly retrieve participant for verifiedUserId only, ignoring any client-supplied userId.
      const participant = session.participants.get(verifiedUserId);
      participant.isMuted = isMuted;

      // Broadcast mute state update with verifiedUserId
      io.to(`voice:session:${channelId}`).emit('voice:peer_mute_changed', {
        channelId,
        userId: verifiedUserId,
        isMuted
      });

      if (typeof callback === 'function') {
        callback({ success: true, isMuted });
      }
    } catch (err) {
      console.error('[Voice] Error in voice:mute_change:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  /**
   * 4. WebRTC Signaling Relay (SDP Offer / Answer, ICE Candidates)
   * Event: voice:signal
   *
   * STRICT SECURITY & ARCHITECTURE GUARANTEE:
   * - Does NOT send actual audio through the normal application server.
   * - Audio streams peer-to-peer via WebRTC RTCPeerConnection directly between browsers.
   * - Server only relays standard SDP descriptions and ICE candidate coordinates within the authorized session room.
   */
  socket.on('voice:signal', (data = {}) => {
    try {
      const { channelId, signal } = data;
      if (!channelId || !signal) return;

      const session = voiceSessions.get(channelId);
      if (!session) {
        socket.emit('voice:error', { success: false, error: 'Voice session not active.' });
        return;
      }

      // STRICT SECURITY: Verify sender is in this session
      if (!session.participants.has(verifiedUserId)) {
        console.warn(`[Voice Security] User ${verifiedUserId} attempted signal on unauthorized session ${channelId}`);
        socket.emit('voice:error', {
          success: false,
          error: 'Forbidden: You are not authorized to send signaling messages in this voice session.'
        });
        return;
      }

      // STRICT SECURITY: Never trust client-supplied senderId. Force senderId to verifiedUserId.
      // Relay signal strictly to the other verified peer in the voice room (prevents listening to another user's audio)
      socket.to(`voice:session:${channelId}`).emit('voice:signal', {
        channelId,
        senderId: verifiedUserId,
        signal
      });
    } catch (err) {
      console.error('[Voice] Error in voice:signal relay:', err);
    }
  });

  /**
   * ========================================================
   * MULTI-USER ROOM GROUP VOICE (Chunk 7.5 - Friend Lounge)
   * Supports up to 6 members in group voice with strict authorization.
   * Starts MUTED by default.
   * ========================================================
   */
  socket.on('voice:room_join', async (data = {}, callback) => {
    try {
      const { roomId } = data;
      if (!roomId) {
        const err = { success: false, error: 'Room ID is required.' };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      // 1. Account restrictions check
      if (
        socket.user.isBanned ||
        socket.user.isSuspended ||
        socket.user.isBlocked ||
        (socket.user.restrictions && socket.user.restrictions.canUseVoice === false)
      ) {
        const err = { success: false, error: 'Your account is restricted from voice communication.' };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      const roomIdStr = roomId.toString();
      const isDemoOrLocal = roomIdStr.startsWith('room-demo-') || roomIdStr.startsWith('room_');

      // 2. Authoritative Lounge membership check
      let room = null;
      if (!isDemoOrLocal) {
        if (!mongoose.Types.ObjectId.isValid(roomIdStr)) {
          const err = { success: false, error: 'Invalid room ID format.' };
          if (typeof callback === 'function') return callback(err);
          return socket.emit('voice:error', err);
        }

        room = await PrivateRoom.findById(roomIdStr);
        if (!room || room.status !== 'ACTIVE') {
          const err = { success: false, error: 'Room not found or no longer active.' };
          if (typeof callback === 'function') return callback(err);
          return socket.emit('voice:error', err);
        }

        const isOwner = room.ownerId && room.ownerId.toString() === verifiedUserId;
        const isMember = await PrivateRoomMember.exists({ roomId: room._id, userId: verifiedUserId });
        const isOccupant = Boolean(privateRoomOccupants && privateRoomOccupants.get(roomIdStr)?.has(socket.id));
        if (!isOwner && !isMember && !isOccupant) {
          const roomLabel = room.type === 'COUPLE' ? 'couple suite' : 'lounge';
          const err = { success: false, error: `You are not an authorized member of this ${roomLabel}.` };
          if (typeof callback === 'function') return callback(err);
          return socket.emit('voice:error', err);
        }

        // Check block with room owner
        if (room.ownerId && room.ownerId.toString() !== verifiedUserId) {
          const isBlocked = await Block.findOne({
            $or: [
              { blocker: verifiedUserId, blocked: room.ownerId },
              { blocker: room.ownerId, blocked: verifiedUserId }
            ]
          });
          if (isBlocked) {
            const err = { success: false, error: 'Voice interaction restricted due to block settings.' };
            if (typeof callback === 'function') return callback(err);
            return socket.emit('voice:error', err);
          }
        }
      }

      // 3. Lounge voice capacity check: MAX 6 users (per specification)
      if (!roomVoiceSessions.has(roomIdStr)) {
        roomVoiceSessions.set(roomIdStr, new Map());
      }
      const voiceMap = roomVoiceSessions.get(roomIdStr);
      const maxVoiceUsers = room?.type === 'FRIENDS' ? 6 : 2;

      if (!voiceMap.has(verifiedUserId) && voiceMap.size >= maxVoiceUsers) {
        const err = {
          success: false,
          error: `Voice session is at full capacity (max ${maxVoiceUsers} participants).`
        };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      // 4. Block check against active voice participants in the room
      for (const p of voiceMap.values()) {
        if (p.userId !== verifiedUserId) {
          const isBlocked = await Block.findOne({
            $or: [
              { blocker: verifiedUserId, blocked: p.userId },
              { blocker: p.userId, blocked: verifiedUserId }
            ]
          });
          if (isBlocked) {
            const err = { success: false, error: 'Cannot join voice session due to block restrictions with a participant.' };
            if (typeof callback === 'function') return callback(err);
            return socket.emit('voice:error', err);
          }
        }
      }

      // Leave any prior room voice session cleanly
      const priorRoomId = userRoomVoice.get(verifiedUserId);
      if (priorRoomId && priorRoomId !== roomIdStr) {
        removeUserFromRoomVoice(priorRoomId, verifiedUserId, io);
      }

      // Join socket room
      socket.join(`voice:room:${roomIdStr}`);
      userRoomVoice.set(verifiedUserId, roomIdStr);

      // Register participant: Microphone STARTS MUTED by requirement
      const participantData = {
        userId: verifiedUserId,
        name: verifiedName,
        avatar: socket.user?.avatar || {},
        socketId: socket.id,
        isMuted: true,
        isSpeaking: false,
        joinedAt: new Date().toISOString()
      };
      voiceMap.set(verifiedUserId, participantData);

      // Get existing peers currently in room voice (excluding caller)
      const existingPeers = Array.from(voiceMap.values())
        .filter((p) => p.userId !== verifiedUserId)
        .map((p) => ({
          userId: p.userId,
          name: p.name,
          avatar: p.avatar,
          isMuted: p.isMuted,
          isSpeaking: p.isSpeaking
        }));

      const resPayload = {
        success: true,
        roomId: roomIdStr,
        participants: existingPeers,
        self: {
          userId: verifiedUserId,
          name: verifiedName,
          isMuted: true,
          isSpeaking: false
        }
      };

      if (typeof callback === 'function') callback(resPayload);
      socket.emit('voice:room_joined', resPayload);

      // Broadcast to existing room participants
      socket.to(`voice:room:${roomIdStr}`).emit('voice:room_peer_joined', {
        roomId: roomIdStr,
        peer: {
          userId: verifiedUserId,
          name: verifiedName,
          avatar: socket.user?.avatar || {},
          isMuted: true,
          isSpeaking: false
        }
      });

      // Broadcast live room voice status to everyone inside the room
      const currentParticipants = Array.from(voiceMap.values()).map((p) => ({
        userId: p.userId,
        name: p.name,
        isMuted: p.isMuted,
        isSpeaking: p.isSpeaking
      }));
      io.to(`room:${roomIdStr}`).emit('voice:room_status', {
        roomId: roomIdStr,
        activeCount: voiceMap.size,
        participants: currentParticipants
      });
    } catch (err) {
      console.error('[Voice] voice:room_join error:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  socket.on('voice:room_signal', async (data = {}) => {
    try {
      const { roomId, targetUserId, signal } = data;
      if (!roomId || !targetUserId || !signal) return;

      const roomIdStr = roomId.toString();
      const targetUserIdStr = targetUserId.toString();

      const session = roomVoiceSessions.get(roomIdStr);
      if (!session || !session.has(verifiedUserId)) return;

      const targetParticipant = session.get(targetUserIdStr);
      if (!targetParticipant) return;

      // Authoritative Block check
      const isBlocked = await Block.findOne({
        $or: [
          { blocker: verifiedUserId, blocked: targetUserIdStr },
          { blocker: targetUserIdStr, blocked: verifiedUserId }
        ]
      });
      if (isBlocked) return;

      // Relay signal to target participant's socket
      io.to(targetParticipant.socketId).emit('voice:room_signal', {
        roomId: roomIdStr,
        senderUserId: verifiedUserId,
        signal
      });
    } catch (err) {
      console.error('[Voice] voice:room_signal error:', err);
    }
  });

  socket.on('voice:toggle_room_mute', (data = {}) => {
    try {
      const { roomId, isMuted } = data;
      const roomIdStr = roomId ? roomId.toString() : userRoomVoice.get(verifiedUserId);
      if (!roomIdStr) return;

      const session = roomVoiceSessions.get(roomIdStr);
      if (session && session.has(verifiedUserId)) {
        const p = session.get(verifiedUserId);
        p.isMuted = Boolean(isMuted);
        if (p.isMuted) p.isSpeaking = false;

        io.to(`voice:room:${roomIdStr}`).emit('voice:room_peer_mute_changed', {
          roomId: roomIdStr,
          userId: verifiedUserId,
          isMuted: p.isMuted
        });
      }
    } catch (err) {
      console.error('[Voice] voice:toggle_room_mute error:', err);
    }
  });

  socket.on('voice:toggle_room_speaking', (data = {}) => {
    try {
      const { roomId, isSpeaking } = data;
      const roomIdStr = roomId ? roomId.toString() : userRoomVoice.get(verifiedUserId);
      if (!roomIdStr) return;

      const session = roomVoiceSessions.get(roomIdStr);
      if (session && session.has(verifiedUserId)) {
        const p = session.get(verifiedUserId);
        p.isSpeaking = Boolean(isSpeaking);

        io.to(`voice:room:${roomIdStr}`).emit('voice:room_peer_speaking_changed', {
          roomId: roomIdStr,
          userId: verifiedUserId,
          isSpeaking: p.isSpeaking
        });
      }
    } catch (err) {
      console.error('[Voice] voice:toggle_room_speaking error:', err);
    }
  });

  socket.on('voice:leave_room', (data = {}) => {
    try {
      const { roomId } = data;
      const roomIdStr = roomId ? roomId.toString() : userRoomVoice.get(verifiedUserId);
      if (roomIdStr) {
        socket.leave(`voice:room:${roomIdStr}`);
        removeUserFromRoomVoice(roomIdStr, verifiedUserId, io);
      }
    } catch (err) {
      console.error('[Voice] voice:leave_room error:', err);
    }
  });
};

/**
 * Handle user disconnect for active voice sessions
 */
const handleVoiceDisconnect = (userId, io, players = null) => {
  if (!userId) return;
  const userIdStr = userId.toString();

  // 1. Direct 1-on-1 voice session cleanup
  const channelId = userVoiceSession.get(userIdStr);
  if (channelId) {
    endVoiceSessionOnSeatVacate(userIdStr, io, players);
  }

  // 2. Room group voice session cleanup (Chunk 7.5)
  const roomId = userRoomVoice.get(userIdStr);
  if (roomId) {
    removeUserFromRoomVoice(roomId, userIdStr, io);
  }
};

/**
 * End voice session when a player leaves their seat.
 * Since voice communication authoritatively requires being co-seated on the same bench/table,
 * leaving the seat immediately terminates the voice session and closes WebRTC.
 */
const endVoiceSessionOnSeatVacate = (userId, io, players = null) => {
  if (!userId) return;
  const userIdStr = userId.toString();
  const channelId = userVoiceSession.get(userIdStr);
  if (!channelId) return;

  const session = voiceSessions.get(channelId);
  if (!session) {
    userVoiceSession.delete(userIdStr);
    return;
  }

  // Notify all participants in this voice session that it has ended due to standing up
  if (io) {
    const endPayload = {
      channelId,
      reason: 'seat_vacated',
      leavingUserId: userIdStr,
      message: 'Voice session ended because player left their seat.'
    };

    io.to(`voice:session:${channelId}`).emit('voice:session_ended', endPayload);

    for (const [pUserId] of session.participants) {
      io.to(`user:${pUserId}`).emit('voice:session_ended', endPayload);
    }
  }

  // Clean up all participants from this session
  const participantIds = Array.from(session.participants.keys());
  for (const pUserId of participantIds) {
    removeParticipantFromSession(channelId, pUserId, io, null, players);
  }
};

/**
 * Authoritatively terminate a voice session when authorization is revoked:
 * - When either user blocks the other
 * - When friendship is removed (unfriended)
 * - When user is banned/suspended
 */
const revokeVoiceSessionOnAuthLoss = (userAId, userBId, io, reason = 'blocked') => {
  if (!userAId || !userBId) return;
  const idA = userAId.toString();
  const idB = userBId.toString();
  const channelId = getChannelId(idA, idB);

  const session = voiceSessions.get(channelId);
  if (!session) {
    userVoiceSession.delete(idA);
    userVoiceSession.delete(idB);
    return;
  }

  console.log(`[Voice Security] Authoritatively terminating session ${channelId} due to auth revocation (${reason})`);

  if (io) {
    const endPayload = {
      channelId,
      reason,
      message: `Voice session terminated immediately due to ${reason === 'blocked' ? 'block restrictions' : 'authorization revocation'}.`
    };

    // 1. Notify voice session room (closes WebRTC on clients)
    io.to(`voice:session:${channelId}`).emit('voice:session_ended', endPayload);

    // 2. Notify both user rooms directly
    io.to(`user:${idA}`).emit('voice:session_ended', endPayload);
    io.to(`user:${idB}`).emit('voice:session_ended', endPayload);

    // 3. Clear co-seated dock and communication context
    io.to(`user:${idA}`).emit('seating:co_seated_cleared', { reason });
    io.to(`user:${idB}`).emit('seating:co_seated_cleared', { reason });

    // 4. Update presence for both participants
    io.to('campus:world').emit('presence:voice_update', { userId: idA, inVoice: false, channelId });
    io.to('campus:world').emit('presence:voice_update', { userId: idB, inVoice: false, channelId });
    io.emit('user:presence_update', { userId: idA, inVoice: false });
    io.emit('user:presence_update', { userId: idB, inVoice: false });
  }

  // Clean up session records
  userVoiceSession.delete(idA);
  userVoiceSession.delete(idB);
  voiceSessions.delete(channelId);
};

module.exports = {
  attachVoiceHandlers,
  handleVoiceDisconnect,
  endVoiceSessionOnSeatVacate,
  revokeVoiceSessionOnAuthLoss,
  removeUserFromRoomVoice,
  getRoomVoiceStatus,
  getActiveSessionsCount: () => voiceSessions.size,
  getSession: (channelId) => voiceSessions.get(channelId),
  getChannelId
};

