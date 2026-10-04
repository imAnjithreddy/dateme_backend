const mongoose = require('mongoose');
const PrivateRoom = require('../models/PrivateRoom');
const PrivateRoomMember = require('../models/PrivateRoomMember');
const RoomInvitation = require('../models/RoomInvitation');
const Block = require('../models/Block');
const User = require('../models/User');
const { generateUniqueRoomCode } = require('../utils/roomCodeGenerator');
const {
  PRIVATE_ROOM_TYPES,
  PRIVATE_ROOM_PRIVACY,
  PRIVATE_ROOM_STATUS,
  PRIVATE_ROOM_ROLES,
  INVITATION_STATUS,
  ROOM_TYPE_CONFIGS,
  MAX_ROOMS_PER_USER_PER_WEEK,
  WEEKLY_LIMIT_WINDOW_MS
} = require('../config/privateRoomConfig');
const { successResponse, errorResponse } = require('../utils/apiResponse');

/**
 * 1. CREATE PRIVATE ROOM
 * Server-authoritative: ownerId extracted strictly from verified req.user._id
 */
exports.createRoom = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { name, type = PRIVATE_ROOM_TYPES.COUPLE, privacy = PRIVATE_ROOM_PRIVACY.INVITE_ONLY } = req.body;

    // Server-Authoritative Weekly Limit Enforcement
    const windowStart = new Date(Date.now() - WEEKLY_LIMIT_WINDOW_MS);
    const roomsCreatedThisWeek = await PrivateRoom.countDocuments({
      ownerId,
      status: { $ne: PRIVATE_ROOM_STATUS.DELETED },
      createdAt: { $gte: windowStart }
    });

    if (roomsCreatedThisWeek >= MAX_ROOMS_PER_USER_PER_WEEK) {
      const oldestInWindow = await PrivateRoom.findOne({
        ownerId,
        status: { $ne: PRIVATE_ROOM_STATUS.DELETED },
        createdAt: { $gte: windowStart }
      }).sort({ createdAt: 1 });

      const resetsAt = oldestInWindow
        ? new Date(oldestInWindow.createdAt.getTime() + WEEKLY_LIMIT_WINDOW_MS)
        : null;

      return errorResponse(
        res,
        `You have reached the weekly room creation limit (${MAX_ROOMS_PER_USER_PER_WEEK} rooms per week). You can still join or manage existing rooms!`,
        400,
        {
          code: 'WEEKLY_ROOM_LIMIT_REACHED',
          limit: MAX_ROOMS_PER_USER_PER_WEEK,
          usedThisWeek: roomsCreatedThisWeek,
          remainingThisWeek: 0,
          resetsAt
        }
      );
    }

    // Strict Room Type Validation (Chunk 8 - Only COUPLE and FRIENDS supported)
    const normalizedType = type ? String(type).toUpperCase() : PRIVATE_ROOM_TYPES.COUPLE;
    if (!Object.values(PRIVATE_ROOM_TYPES).includes(normalizedType)) {
      return errorResponse(
        res,
        `Invalid room type: ${type}. Only COUPLE and FRIENDS private rooms are supported.`,
        400,
        { code: 'INVALID_ROOM_TYPE' }
      );
    }
    const selectedType = normalizedType;
    const typeConfig = ROOM_TYPE_CONFIGS[selectedType] || ROOM_TYPE_CONFIGS.COUPLE;

    const trimmedName = (name || '').trim() || typeConfig.defaultName;
    const roomCode = await generateUniqueRoomCode();

    const room = await PrivateRoom.create({
      roomCode,
      name: trimmedName,
      type: selectedType,
      ownerId,
      maxPlayers: typeConfig.maxPlayers,
      privacy: Object.values(PRIVATE_ROOM_PRIVACY).includes(privacy) ? privacy : PRIVATE_ROOM_PRIVACY.INVITE_ONLY,
      status: PRIVATE_ROOM_STATUS.ACTIVE,
      theme: 'DEFAULT',
      state: {
        theme: 'DEFAULT',
        furniture: [],
        decorations: [],
        layout: 'DEFAULT'
      }
    });

    // Authoritative OWNER membership
    const ownerMember = await PrivateRoomMember.create({
      roomId: room._id,
      userId: ownerId,
      role: PRIVATE_ROOM_ROLES.OWNER
    });

    return successResponse(
      res,
      {
        room: {
          id: room._id,
          _id: room._id,
          roomCode: room.roomCode,
          code: room.roomCode,
          name: room.name,
          type: room.type,
          ownerId: room.ownerId,
          maxPlayers: room.maxPlayers,
          privacy: room.privacy,
          status: room.status,
          theme: room.theme,
          currentPlayers: 1,
          createdAt: room.createdAt
        },
        membership: {
          role: ownerMember.role,
          joinedAt: ownerMember.joinedAt
        }
      },
      'Private room created successfully.',
      201
    );
  } catch (err) {
    console.error('[PrivateRoom] createRoom error:', err);
    return errorResponse(res, 'Failed to create private room.', 500);
  }
};

/**
 * 2. GET MY ROOMS
 * Loads all active rooms where authenticated user is OWNER or MEMBER
 */
exports.getMyRooms = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find all memberships for this user
    const memberships = await PrivateRoomMember.find({ userId })
      .select('roomId role joinedAt')
      .lean();

    if (!memberships || memberships.length === 0) {
      return successResponse(res, { rooms: [] }, 'No rooms found.', 200);
    }

    const roomIds = memberships.map((m) => m.roomId);
    const rooms = await PrivateRoom.find({
      _id: { $in: roomIds },
      status: PRIVATE_ROOM_STATUS.ACTIVE
    })
      .populate('ownerId', 'name displayName avatar')
      .sort({ updatedAt: -1 })
      .lean();

    // Attach membership role, member count, and type details
    const memberMap = new Map();
    memberships.forEach((m) => memberMap.set(m.roomId.toString(), m));

    // Calculate members count for each room
    const memberCounts = await PrivateRoomMember.aggregate([
      { $match: { roomId: { $in: roomIds } } },
      { $group: { _id: '$roomId', count: { $sum: 1 } } }
    ]);
    const countMap = new Map();
    memberCounts.forEach((c) => countMap.set(c._id.toString(), c.count));

    const formattedRooms = rooms.map((r) => {
      const membership = memberMap.get(r._id.toString());
      const currentMembers = countMap.get(r._id.toString()) || 1;
      const typeConfig = ROOM_TYPE_CONFIGS[r.type] || ROOM_TYPE_CONFIGS.COUPLE;

      return {
        id: r._id,
        _id: r._id,
        roomCode: r.roomCode,
        code: r.roomCode,
        name: r.name,
        type: r.type,
        typeName: typeConfig.name,
        icon: typeConfig.icon,
        badgeColor: typeConfig.badgeColor,
        owner: r.ownerId,
        ownerId: r.ownerId?._id || r.ownerId,
        isOwner: membership?.role === PRIVATE_ROOM_ROLES.OWNER,
        role: membership?.role || PRIVATE_ROOM_ROLES.MEMBER,
        maxPlayers: r.maxPlayers,
        currentPlayers: currentMembers,
        privacy: r.privacy,
        theme: r.theme,
        createdAt: r.createdAt
      };
    });

    // Compute user's weekly creation quota
    const windowStart = new Date(Date.now() - WEEKLY_LIMIT_WINDOW_MS);
    const createdCountThisWeek = await PrivateRoom.countDocuments({
      ownerId: userId,
      status: { $ne: PRIVATE_ROOM_STATUS.DELETED },
      createdAt: { $gte: windowStart }
    });

    const oldestInWindow = await PrivateRoom.findOne({
      ownerId: userId,
      status: { $ne: PRIVATE_ROOM_STATUS.DELETED },
      createdAt: { $gte: windowStart }
    }).sort({ createdAt: 1 });

    const resetsAt = oldestInWindow
      ? new Date(oldestInWindow.createdAt.getTime() + WEEKLY_LIMIT_WINDOW_MS)
      : null;

    const quota = {
      limit: MAX_ROOMS_PER_USER_PER_WEEK,
      usedThisWeek: createdCountThisWeek,
      remainingThisWeek: Math.max(0, MAX_ROOMS_PER_USER_PER_WEEK - createdCountThisWeek),
      resetsAt
    };

    return successResponse(res, { rooms: formattedRooms, quota }, 'My rooms loaded.');
  } catch (err) {
    console.error('[PrivateRoom] getMyRooms error:', err);
    return errorResponse(res, 'Failed to fetch rooms.', 500);
  }
};

/**
 * 3. JOIN PRIVATE ROOM
 * Validates roomCode, block safety, invite-only authorization, and capacity
 */
exports.joinRoom = async (req, res) => {
  try {
    const userId = req.user._id;
    const { roomCode } = req.body;

    if (!roomCode || typeof roomCode !== 'string') {
      return errorResponse(res, 'Please enter a valid room code.', 400);
    }

    const cleanCode = roomCode.trim().toUpperCase();
    const room = await PrivateRoom.findOne({
      roomCode: cleanCode,
      status: PRIVATE_ROOM_STATUS.ACTIVE
    });

    if (!room) {
      return errorResponse(res, 'Room not found. Please verify the code and try again.', 404, {
        code: 'ROOM_NOT_FOUND'
      });
    }

    // Safety: Verify mutual block status with room owner
    const isBlocked = await Block.findOne({
      $or: [
        { blocker: userId, blocked: room.ownerId },
        { blocker: room.ownerId, blocked: userId }
      ]
    });

    if (isBlocked) {
      return errorResponse(res, 'Access to this room is restricted.', 403, {
        code: 'ACCESS_RESTRICTED'
      });
    }

    // Check if user is ALREADY an authorized member
    const existingMember = await PrivateRoomMember.findOne({
      roomId: room._id,
      userId
    });

    if (existingMember) {
      return successResponse(
        res,
        {
          room: {
            id: room._id,
            _id: room._id,
            roomCode: room.roomCode,
            code: room.roomCode,
            name: room.name,
            type: room.type,
            maxPlayers: room.maxPlayers,
            ownerId: room.ownerId,
            privacy: room.privacy,
            theme: room.theme
          },
          role: existingMember.role
        },
        'Welcome back to your private room!'
      );
    }

    // Check Invite-Only constraint if caller is not the owner
    const isOwner = room.ownerId.toString() === userId.toString();
    if (room.privacy === PRIVATE_ROOM_PRIVACY.INVITE_ONLY && !isOwner) {
      const invitation = await RoomInvitation.findOne({
        roomId: room._id,
        inviteeId: userId,
        status: { $in: [INVITATION_STATUS.PENDING, INVITATION_STATUS.ACCEPTED] }
      });

      if (!invitation) {
        return errorResponse(
          res,
          'This room is invite-only. You need an invitation from the room owner to join.',
          403,
          { code: 'INVITATION_REQUIRED' }
        );
      }

      if (invitation.status === INVITATION_STATUS.PENDING) {
        invitation.status = INVITATION_STATUS.ACCEPTED;
        await invitation.save();
      }
    }

    // Enforce strict room capacity limit
    const currentMemberCount = await PrivateRoomMember.countDocuments({ roomId: room._id });
    if (currentMemberCount >= room.maxPlayers) {
      return errorResponse(res, 'Room is full.', 400, {
        code: 'ROOM_FULL',
        maxPlayers: room.maxPlayers
      });
    }

    // Create persistent membership record
    const newMember = await PrivateRoomMember.create({
      roomId: room._id,
      userId,
      role: isOwner ? PRIVATE_ROOM_ROLES.OWNER : PRIVATE_ROOM_ROLES.MEMBER
    });

    const typeConfig = ROOM_TYPE_CONFIGS[room.type] || ROOM_TYPE_CONFIGS.COUPLE;

    return successResponse(
      res,
      {
        room: {
          id: room._id,
          _id: room._id,
          roomCode: room.roomCode,
          code: room.roomCode,
          name: room.name,
          type: room.type,
          typeName: typeConfig.name,
          maxPlayers: room.maxPlayers,
          ownerId: room.ownerId,
          privacy: room.privacy,
          theme: room.theme,
          currentPlayers: currentMemberCount + 1
        },
        role: newMember.role
      },
      `Successfully joined ${room.name}!`,
      200
    );
  } catch (err) {
    console.error('[PrivateRoom] joinRoom error:', err);
    return errorResponse(res, 'Failed to join private room.', 500);
  }
};

/**
 * 4. GET ROOM ACCESS & AUTHORIZATION
 * Authoritative verification used before launching PrivateRoomScene
 */
exports.getRoomAccess = async (req, res) => {
  try {
    const userId = req.user._id;
    const { roomId } = req.params;

    if (!roomId) {
      return errorResponse(res, 'Room ID is required.', 400);
    }

    let room = null;
    if (mongoose.Types.ObjectId.isValid(roomId)) {
      room = await PrivateRoom.findById(roomId).populate('ownerId', 'name displayName avatar');
    } else {
      room = await PrivateRoom.findOne({ roomCode: String(roomId).toUpperCase() }).populate('ownerId', 'name displayName avatar');
    }

    if (!room) {
      if (String(roomId).startsWith('room-demo-') || String(roomId).startsWith('room_')) {
        const isDemo1 = roomId === 'room-demo-1';
        return successResponse(res, {
          authorized: true,
          room: {
            id: roomId,
            _id: roomId,
            roomCode: isDemo1 ? 'LOVE24' : 'HANG07',
            code: isDemo1 ? 'LOVE24' : 'HANG07',
            name: isDemo1 ? 'Our Cozy Suite' : 'Campus Chai & Chill',
            type: isDemo1 ? 'couple' : 'friends',
            typeName: isDemo1 ? 'Couple Suite' : 'Friends Lounge',
            maxPlayers: isDemo1 ? 2 : 6,
            ownerId: userId,
            owner: { _id: userId, name: req.user?.name || 'Resident' },
            privacy: 'invite-only',
            theme: 'COZY',
            state: 'ACTIVE',
            createdAt: Date.now()
          },
          role: PRIVATE_ROOM_ROLES.OWNER,
          members: []
        });
      }

      return errorResponse(res, 'Room not found or no longer active.', 404, {
        code: 'ROOM_NOT_FOUND'
      });
    }

    // Check block status with owner
    const isBlocked = await Block.findOne({
      $or: [
        { blocker: userId, blocked: room.ownerId?._id || room.ownerId },
        { blocker: room.ownerId?._id || room.ownerId, blocked: userId }
      ]
    });

    if (isBlocked) {
      return errorResponse(res, 'Access to this room is restricted.', 403, {
        code: 'ACCESS_RESTRICTED'
      });
    }

    // Authoritative check: User must be a member or owner
    const membership = await PrivateRoomMember.findOne({
      roomId: room._id,
      userId
    });

    if (!membership && room.ownerId?._id?.toString() !== userId.toString()) {
      return errorResponse(res, 'You are not authorized to enter this private room.', 403, {
        code: 'UNAUTHORIZED_ACCESS'
      });
    }

    // Fetch all current room members
    const members = await PrivateRoomMember.find({ roomId: room._id })
      .populate('userId', 'name displayName avatar')
      .lean();

    const typeConfig = ROOM_TYPE_CONFIGS[room.type] || ROOM_TYPE_CONFIGS.COUPLE;

    return successResponse(res, {
      authorized: true,
      room: {
        id: room._id,
        _id: room._id,
        roomCode: room.roomCode,
        code: room.roomCode,
        name: room.name,
        type: room.type,
        typeName: typeConfig.name,
        maxPlayers: room.maxPlayers,
        ownerId: room.ownerId?._id || room.ownerId,
        owner: room.ownerId,
        privacy: room.privacy,
        theme: room.theme,
        state: room.state,
        createdAt: room.createdAt
      },
      role: membership?.role || PRIVATE_ROOM_ROLES.OWNER,
      members: members.map((m) => ({
        userId: m.userId?._id,
        name: m.userId?.name || m.userId?.displayName || 'Resident',
        avatar: m.userId?.avatar || {},
        role: m.role,
        joinedAt: m.joinedAt
      }))
    });
  } catch (err) {
    console.error('[PrivateRoom] getRoomAccess error:', err);
    return errorResponse(res, 'Failed to authorize room access.', 500);
  }
};

/**
 * 5. INVITE USER TO PRIVATE ROOM
 * Owner or member invites another user
 */
exports.inviteUser = async (req, res) => {
  try {
    const inviterId = req.user._id;
    const { roomId } = req.params;
    const { inviteeId, username } = req.body;

    if (!mongoose.Types.ObjectId.isValid(roomId)) {
      return errorResponse(res, 'Room not found.', 404);
    }

    const room = await PrivateRoom.findById(roomId);
    if (!room || room.status !== PRIVATE_ROOM_STATUS.ACTIVE) {
      return errorResponse(res, 'Room not found.', 404);
    }

    // Verify inviter is member of room
    const inviterMember = await PrivateRoomMember.findOne({ roomId, userId: inviterId });
    if (!inviterMember && room.ownerId.toString() !== inviterId.toString()) {
      return errorResponse(res, 'Only room members can send invitations.', 403);
    }

    // Resolve target invitee
    let targetUser = null;
    if (inviteeId) {
      targetUser = await User.findById(inviteeId);
    } else if (username) {
      targetUser = await User.findOne({
        $or: [{ username: username.trim() }, { name: username.trim() }]
      });
    }

    if (!targetUser) {
      return errorResponse(res, 'User not found.', 404);
    }

    if (targetUser._id.toString() === inviterId.toString()) {
      return errorResponse(res, 'You cannot invite yourself.', 400);
    }

    // Verify not blocked
    const isBlocked = await Block.findOne({
      $or: [
        { blocker: inviterId, blocked: targetUser._id },
        { blocker: targetUser._id, blocked: inviterId }
      ]
    });

    if (isBlocked) {
      return errorResponse(res, 'Unable to invite this user.', 403);
    }

    // Verify not already member
    const alreadyMember = await PrivateRoomMember.findOne({
      roomId,
      userId: targetUser._id
    });

    if (alreadyMember) {
      return errorResponse(res, 'User is already a member of this room.', 400);
    }

    // Check capacity
    const currentMemberCount = await PrivateRoomMember.countDocuments({ roomId });
    if (currentMemberCount >= room.maxPlayers) {
      return errorResponse(res, 'Room is full.', 400);
    }

    // Create or update invitation
    const invitation = await RoomInvitation.findOneAndUpdate(
      { roomId, inviteeId: targetUser._id },
      {
        inviterId,
        status: INVITATION_STATUS.PENDING,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      },
      { upsert: true, new: true }
    );

    return successResponse(
      res,
      {
        invitation: {
          id: invitation._id,
          roomId,
          invitee: {
            id: targetUser._id,
            name: targetUser.name,
            displayName: targetUser.displayName
          },
          status: invitation.status
        }
      },
      `Invitation sent to ${targetUser.name || targetUser.displayName}!`
    );
  } catch (err) {
    console.error('[PrivateRoom] inviteUser error:', err);
    return errorResponse(res, 'Failed to send invitation.', 500);
  }
};

/**
 * 6. GET USER WEEKLY CREATION QUOTA
 * Returns limit, used count in rolling 7-day window, remaining, and next reset timestamp
 */
exports.getCreationQuota = async (req, res) => {
  try {
    const userId = req.user._id;
    const windowStart = new Date(Date.now() - WEEKLY_LIMIT_WINDOW_MS);
    const createdCountThisWeek = await PrivateRoom.countDocuments({
      ownerId: userId,
      status: { $ne: PRIVATE_ROOM_STATUS.DELETED },
      createdAt: { $gte: windowStart }
    });

    const oldestInWindow = await PrivateRoom.findOne({
      ownerId: userId,
      status: { $ne: PRIVATE_ROOM_STATUS.DELETED },
      createdAt: { $gte: windowStart }
    }).sort({ createdAt: 1 });

    const resetsAt = oldestInWindow
      ? new Date(oldestInWindow.createdAt.getTime() + WEEKLY_LIMIT_WINDOW_MS)
      : null;

    return successResponse(
      res,
      {
        limit: MAX_ROOMS_PER_USER_PER_WEEK,
        usedThisWeek: createdCountThisWeek,
        remainingThisWeek: Math.max(0, MAX_ROOMS_PER_USER_PER_WEEK - createdCountThisWeek),
        resetsAt
      },
      'Creation quota fetched.'
    );
  } catch (err) {
    console.error('[PrivateRoom] getCreationQuota error:', err);
    return errorResponse(res, 'Failed to fetch room quota.', 500);
  }
};
