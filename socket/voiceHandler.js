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

const User = require('../models/User');
const Friendship = require('../models/Friendship');
const Block = require('../models/Block');
const seatingManager = require('./seatingManager');

// Active Google Meet–style Voice Sessions
// channelId -> { channelId, participants: Map(userId -> { userId, name, avatar, socketId, isMuted, joinedAt }), createdAt }
const voiceSessions = new Map();

// userId string -> channelId string
const userVoiceSession = new Map();

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
const attachVoiceHandlers = (socket, io, userSockets, players = null) => {
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
      if (socket.user.isBanned || socket.user.isSuspended || socket.user.isBlocked) {
        const err = { success: false, error: 'Your account is restricted from voice communication.' };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      // Lookup target friend
      const targetUser = await User.findById(targetUserId).select(
        'name displayName avatar isBanned isSuspended isBlocked onlineStatus'
      );

      if (!targetUser) {
        const err = { success: false, error: 'Target campus user not found.' };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      if (targetUser.isBanned || targetUser.isSuspended || targetUser.isBlocked) {
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

      // Verify Friendship Status (Must be ACCEPTED)
      const friendship = await Friendship.findOne({
        $or: [
          { requester: verifiedUserId, recipient: targetUserId },
          { requester: targetUserId, recipient: verifiedUserId }
        ]
      });

      if (!friendship || friendship.status !== 'ACCEPTED') {
        const err = {
          success: false,
          error: 'Voice communication requires an accepted friendship. Please add friend first.'
        };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      // 5. Allowed Shared Interaction Context Verification (CHUNK 12 Requirement)
      // "A voice session can only be created when the server confirms:
      // Both users are currently in an allowed shared interaction context:
      // Both players are sitting together on the same valid two-person seat/interaction point."
      // "Do NOT trust frontend values such as: isFriend, canVoice, isSeatedTogether. The backend must verify these conditions itself."
      const coSeatedCheck = seatingManager.areCoSeated(verifiedUserId, targetUserId);
      if (!coSeatedCheck.coSeated) {
        const err = {
          success: false,
          error: `Voice session not permitted: ${coSeatedCheck.reason}`
        };
        if (typeof callback === 'function') return callback(err);
        return socket.emit('voice:error', err);
      }

      // If user is currently in another session, leave previous session cleanly
      const existingChannelId = userVoiceSession.get(verifiedUserId);
      if (existingChannelId) {
        socket.leave(`voice:session:${existingChannelId}`);
        removeParticipantFromSession(existingChannelId, verifiedUserId, io);
      }

      // Derive deterministic channel ID for the friendship
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
};

/**
 * Handle user disconnect for active voice sessions
 */
const handleVoiceDisconnect = (userId, io, players = null) => {
  const channelId = userVoiceSession.get(userId);
  if (!channelId) return;

  endVoiceSessionOnSeatVacate(userId, io, players);
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
  getActiveSessionsCount: () => voiceSessions.size,
  getSession: (channelId) => voiceSessions.get(channelId),
  getChannelId
};

