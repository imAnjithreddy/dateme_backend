const User = require('../models/User');
const Report = require('../models/Report');
const Event = require('../models/Event');
const Club = require('../models/Club');
const ClubPost = require('../models/ClubPost');
const Match = require('../models/Match');
const Message = require('../models/Message');
const Connection = require('../models/Connection');
const PlatformSetting = require('../models/PlatformSetting');
const { getOnlineUsersCount, getOnlinePlayersList } = require('../socket');
const { successResponse, errorResponse } = require('../utils/apiResponse');

/**
 * 1. OVERVIEW: High-level platform KPIs and live metrics
 * GET /api/admin/overview
 */
const getOverviewStats = async (req, res, next) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers24h,
      activeUsers7d,
      activeUsers30d,
      newUsers24h,
      newUsers7d,
      matchesCount,
      messagesCount,
      eventsCount,
      totalReports,
      pendingReports,
      investigatingReports,
      suspendedAccounts,
      bannedAccounts,
      verifiedUsers,
      clubsCount,
      premiumUsers
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ lastActive: { $gte: oneDayAgo } }),
      User.countDocuments({ lastActive: { $gte: sevenDaysAgo } }),
      User.countDocuments({ lastActive: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: oneDayAgo } }),
      User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Match.countDocuments(),
      Message.countDocuments(),
      Event.countDocuments(),
      Report.countDocuments(),
      Report.countDocuments({ status: 'pending' }),
      Report.countDocuments({ status: 'investigating' }),
      User.countDocuments({ isSuspended: true }),
      User.countDocuments({ isBanned: true }),
      User.countDocuments({ isVerified: true }),
      Club.countDocuments(),
      User.countDocuments({ subscriptionStatus: { $ne: 'free' } })
    ]);

    const onlineCount = getOnlineUsersCount();
    const onlinePlayers = getOnlinePlayersList();

    const stats = {
      users: {
        total: totalUsers,
        active24h: activeUsers24h,
        active7d: activeUsers7d,
        active30d: activeUsers30d,
        new24h: newUsers24h,
        new7d: newUsers7d,
        online: onlineCount,
        suspended: suspendedAccounts,
        banned: bannedAccounts,
        verified: verifiedUsers,
        premium: premiumUsers
      },
      engagement: {
        matches: matchesCount,
        messages: messagesCount,
        events: eventsCount,
        clubs: clubsCount
      },
      trustAndSafety: {
        totalReports,
        pendingReports,
        investigatingReports,
        actionedOrResolved: totalReports - pendingReports - investigatingReports
      },
      liveCampus: {
        activeSocketConnections: onlineCount,
        players: onlinePlayers.map((p) => ({
          userId: p.userId,
          displayName: p.displayName,
          zone: p.campusArea || p.currentZone,
          role: p.role,
          avatar: p.avatar,
          connectedAt: p.connectedAt || new Date()
        }))
      }
    };

    return successResponse(res, stats, 'Admin overview statistics retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * 2. USERS: Search, filter, view details & account activity
 * GET /api/admin/users
 */
const getUsers = async (req, res, next) => {
  try {
    const { search = '', status = 'all', role = 'all', page = 1, limit = 20 } = req.query;

    const filter = {};

    if (search.trim()) {
      const term = search.trim();
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
        { city: { $regex: term, $options: 'i' } }
      ];
    }

    if (status === 'suspended') {
      filter.isSuspended = true;
    } else if (status === 'banned') {
      filter.isBanned = true;
    } else if (status === 'verified') {
      filter.isVerified = true;
    } else if (status === 'active') {
      filter.isSuspended = false;
      filter.isBanned = false;
    }

    if (role && role !== 'all') {
      filter.role = role;
    }

    const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const totalCount = await User.countDocuments(filter);

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return successResponse(
      res,
      {
        users,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          pages: Math.ceil(totalCount / parseInt(limit)),
          limit: parseInt(limit)
        }
      },
      'Users retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * View Single User Details & Activity Summary
 * Rule: Do not expose private messages unnecessarily.
 * GET /api/admin/users/:id
 */
const getUserDetails = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).select('-password');
    if (!user) {
      return errorResponse(res, 'User not found.', 404);
    }

    // Aggregate user account activity safely without exposing private message texts
    const [
      sentConnectionsCount,
      receivedConnectionsCount,
      acceptedConnectionsCount,
      matchesCount,
      messagesSentCount,
      reportsAgainstCount,
      reportsFiledCount,
      clubsJoined,
      eventsAttending
    ] = await Promise.all([
      Connection.countDocuments({ requester: id }),
      Connection.countDocuments({ recipient: id }),
      Connection.countDocuments({
        $or: [{ requester: id }, { recipient: id }],
        status: 'accepted'
      }),
      Match.countDocuments({ users: id, status: 'active' }),
      Message.countDocuments({ sender: id }),
      Report.countDocuments({ reportedUser: id }),
      Report.countDocuments({ reporter: id }),
      Club.find({ members: id }).select('name icon category memberCount'),
      Event.find({ participants: id }).select('title date time virtualArea')
    ]);

    const activitySummary = {
      connections: {
        sent: sentConnectionsCount,
        received: receivedConnectionsCount,
        mutual: acceptedConnectionsCount
      },
      matches: matchesCount,
      messagesSent: messagesSentCount,
      trustMetrics: {
        reportsAgainstUser: reportsAgainstCount,
        reportsFiledByUser: reportsFiledCount
      },
      communities: {
        clubs: clubsJoined,
        events: eventsAttending
      }
    };

    return successResponse(res, { user, activity: activitySummary }, 'User profile and safe activity telemetry retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Suspend User
 * POST /api/admin/users/:id/suspend
 */
const suspendUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason = 'Terms of service violation' } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 'User not found.', 404);
    }

    if (user.role === 'PLATFORM_ADMIN') {
      return errorResponse(res, 'Cannot suspend another Platform Admin.', 400);
    }

    user.isSuspended = true;
    user.suspendReason = reason;
    await user.save();

    return successResponse(res, { user }, `User ${user.name} has been suspended.`);
  } catch (error) {
    next(error);
  }
};

/**
 * Unsuspend User
 * POST /api/admin/users/:id/unsuspend
 */
const unsuspendUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 'User not found.', 404);
    }

    user.isSuspended = false;
    user.suspendReason = '';
    await user.save();

    return successResponse(res, { user }, `User ${user.name} has been unsuspended.`);
  } catch (error) {
    next(error);
  }
};

/**
 * Ban User (Permanent exclusion)
 * POST /api/admin/users/:id/ban
 */
const banUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason = 'Severe platform safety infraction' } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 'User not found.', 404);
    }

    if (user.role === 'PLATFORM_ADMIN') {
      return errorResponse(res, 'Cannot ban a Platform Admin.', 400);
    }

    user.isBanned = true;
    user.isBlocked = true;
    user.banReason = reason;
    await user.save();

    return successResponse(res, { user }, `User ${user.name} has been banned permanently.`);
  } catch (error) {
    next(error);
  }
};

/**
 * Unban User
 * POST /api/admin/users/:id/unban
 */
const unbanUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 'User not found.', 404);
    }

    user.isBanned = false;
    user.isBlocked = false;
    user.banReason = '';
    await user.save();

    return successResponse(res, { user }, `User ${user.name} ban has been lifted.`);
  } catch (error) {
    next(error);
  }
};

/**
 * Verify / Unverify User Badge
 * POST /api/admin/users/:id/verify
 */
const verifyUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isVerified = true } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 'User not found.', 404);
    }

    user.isVerified = Boolean(isVerified);
    await user.save();

    return successResponse(
      res,
      { user },
      `User ${user.name} verification status set to ${user.isVerified}.`
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 3. REPORTS & 4. MODERATION: Complete Trust & Safety Suite
 * GET /api/admin/reports
 */
const getReports = async (req, res, next) => {
  try {
    const { status = 'all', reason = 'all', page = 1, limit = 20 } = req.query;

    const filter = {};
    if (status && status !== 'all') {
      filter.status = status;
    }
    if (reason && reason !== 'all') {
      filter.reason = reason;
    }

    const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const totalCount = await Report.countDocuments(filter);

    const reports = await Report.find(filter)
      .populate('reporter', 'name email role avatar')
      .populate('reportedUser', 'name email role avatar bio isSuspended isBanned isVerified')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const statusCounts = {
      pending: await Report.countDocuments({ status: 'pending' }),
      investigating: await Report.countDocuments({ status: 'investigating' }),
      resolved: await Report.countDocuments({ status: 'resolved' }),
      action_taken: await Report.countDocuments({ status: 'action_taken' }),
      dismissed: await Report.countDocuments({ status: 'dismissed' })
    };

    return successResponse(
      res,
      {
        reports,
        statusCounts,
        pagination: {
          total: totalCount,
          page: parseInt(page),
          pages: Math.ceil(totalCount / parseInt(limit)),
          limit: parseInt(limit)
        }
      },
      'Reports retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Update Report Status & Admin Review
 * PUT /api/admin/reports/:id
 */
const updateReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, adminNotes = '', action = null } = req.body;

    const report = await Report.findById(id);
    if (!report) {
      return errorResponse(res, 'Report not found.', 404);
    }

    if (status) {
      report.status = status;
    }
    if (adminNotes) {
      report.adminNotes = adminNotes;
    }
    report.reviewedBy = req.user._id;
    report.reviewedAt = new Date();

    await report.save();

    // Optionally apply automatic enforcement action
    if (action === 'suspend') {
      await User.findByIdAndUpdate(report.reportedUser, {
        isSuspended: true,
        suspendReason: `Enforced via Report #${report._id}: ${adminNotes || report.reason}`
      });
    } else if (action === 'ban') {
      await User.findByIdAndUpdate(report.reportedUser, {
        isBanned: true,
        isBlocked: true,
        banReason: `Enforced via Report #${report._id}: ${adminNotes || report.reason}`
      });
    }

    return successResponse(res, { report }, 'Report updated successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Direct Moderation Action (Suspend, Ban, Content Removal)
 * POST /api/admin/moderation/action
 */
const takeModerationAction = async (req, res, next) => {
  try {
    const { actionType, targetUserId, reason = '', reportId = null } = req.body;

    if (!targetUserId) {
      return errorResponse(res, 'Target user ID is required.', 400);
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return errorResponse(res, 'Target user not found.', 404);
    }

    if (targetUser.role === 'PLATFORM_ADMIN') {
      return errorResponse(res, 'Cannot perform moderation actions against an administrator.', 403);
    }

    let resultMessage = '';

    switch (actionType) {
      case 'suspend':
        targetUser.isSuspended = true;
        targetUser.suspendReason = reason || 'Suspended by admin moderation';
        await targetUser.save();
        resultMessage = `User ${targetUser.name} suspended.`;
        break;

      case 'ban':
        targetUser.isBanned = true;
        targetUser.isBlocked = true;
        targetUser.banReason = reason || 'Banned permanently by trust & safety';
        await targetUser.save();
        resultMessage = `User ${targetUser.name} banned permanently.`;
        break;

      case 'remove_content':
        // Clears inappropriate bio and resets avatar styling to default safe preset
        targetUser.bio = 'This profile bio was cleared for community guidelines compliance.';
        targetUser.avatar = {
          ...targetUser.avatar,
          hairStyle: 'undercut',
          hairColor: '#18181b',
          outfitStyle: 'varsity-jacket',
          outfitColor: '#E85D75',
          accessory: 'none'
        };
        await targetUser.save();
        resultMessage = `Inappropriate content on ${targetUser.name}'s profile reset to safe defaults.`;
        break;

      case 'unsuspend':
        targetUser.isSuspended = false;
        targetUser.suspendReason = '';
        await targetUser.save();
        resultMessage = `User ${targetUser.name} unsuspended.`;
        break;

      case 'unban':
        targetUser.isBanned = false;
        targetUser.isBlocked = false;
        targetUser.banReason = '';
        await targetUser.save();
        resultMessage = `User ${targetUser.name} unbanned.`;
        break;

      default:
        return errorResponse(res, `Unknown moderation action: ${actionType}`, 400);
    }

    // If linked to a report, mark report resolved with notes
    if (reportId) {
      await Report.findByIdAndUpdate(reportId, {
        status: actionType === 'remove_content' ? 'action_taken' : 'resolved',
        adminNotes: `Action executed: ${actionType}. Reason: ${reason}`,
        reviewedBy: req.user._id,
        reviewedAt: new Date()
      });
    }

    return successResponse(res, { user: targetUser }, resultMessage);
  } catch (error) {
    next(error);
  }
};

/**
 * 5. EVENTS: Create, Edit, Cancel, Delete & View Participants
 * GET /api/admin/events
 */
const getAdminEvents = async (req, res, next) => {
  try {
    const events = await Event.find()
      .populate('participants', 'name email avatar isVerified')
      .populate('club', 'name icon category')
      .sort({ createdAt: -1 });

    return successResponse(res, { events, count: events.length }, 'Admin events list retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Create Campus Event
 * POST /api/admin/events
 */
const createEvent = async (req, res, next) => {
  try {
    const {
      title,
      description,
      date,
      time,
      location,
      virtualArea = 'event-area',
      category = 'social',
      accentColor = '#E85D75',
      image = '',
      hostName = 'Quad Platform Team'
    } = req.body;

    if (!title || !description) {
      return errorResponse(res, 'Event title and description are required.', 400);
    }

    const event = await Event.create({
      title,
      description,
      date: date || 'Friday, Upcoming',
      time: time || '8:00 PM',
      location: location || 'Campus Amphitheater',
      virtualArea,
      zoneId: virtualArea,
      category,
      accentColor,
      image,
      hostName,
      status: 'upcoming'
    });

    return successResponse(res, { event }, 'Event created successfully', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * Update Campus Event
 * PUT /api/admin/events/:id
 */
const updateEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const event = await Event.findByIdAndUpdate(id, updates, { new: true });
    if (!event) {
      return errorResponse(res, 'Event not found.', 404);
    }

    return successResponse(res, { event }, 'Event updated successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel Campus Event
 * POST /api/admin/events/:id/cancel
 */
const cancelEvent = async (req, res, next) => {
  try {
    const { id } = req.params;

    const event = await Event.findByIdAndUpdate(id, { status: 'cancelled' }, { new: true });
    if (!event) {
      return errorResponse(res, 'Event not found.', 404);
    }

    return successResponse(res, { event }, `Event "${event.title}" has been cancelled.`);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete Campus Event
 * DELETE /api/admin/events/:id
 */
const deleteEvent = async (req, res, next) => {
  try {
    const { id } = req.params;

    const event = await Event.findByIdAndDelete(id);
    if (!event) {
      return errorResponse(res, 'Event not found.', 404);
    }

    return successResponse(res, null, `Event "${event.title}" deleted.`);
  } catch (error) {
    next(error);
  }
};

/**
 * View Event Participants
 * GET /api/admin/events/:id/participants
 */
const getEventParticipants = async (req, res, next) => {
  try {
    const { id } = req.params;

    const event = await Event.findById(id).populate(
      'participants',
      'name email avatar isVerified city relationshipIntent level'
    );
    if (!event) {
      return errorResponse(res, 'Event not found.', 404);
    }

    return successResponse(
      res,
      {
        eventTitle: event.title,
        attendeesCount: event.participants.length,
        participants: event.participants
      },
      'Event participants retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 6. CLUBS: Create, Edit, Archive, View Membership
 * GET /api/admin/clubs
 */
const getAdminClubs = async (req, res, next) => {
  try {
    const clubs = await Club.find()
      .populate('members', 'name email avatar isVerified')
      .sort({ createdAt: -1 });

    return successResponse(res, { clubs, count: clubs.length }, 'Admin clubs list retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Create Club
 * POST /api/admin/clubs
 */
const createClub = async (req, res, next) => {
  try {
    const {
      name,
      tagline,
      description,
      icon = '👥',
      category = 'gaming',
      virtualArea = 'club-house',
      accentColor = '#E85D75',
      image = ''
    } = req.body;

    if (!name || !tagline || !description) {
      return errorResponse(res, 'Club name, tagline, and description are required.', 400);
    }

    const existing = await Club.findOne({ name: name.trim() });
    if (existing) {
      return errorResponse(res, 'A club with this name already exists.', 400);
    }

    const club = await Club.create({
      name: name.trim(),
      tagline,
      description,
      icon,
      category,
      virtualArea,
      accentColor,
      image,
      status: 'active'
    });

    return successResponse(res, { club }, 'Club created successfully', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * Update Club
 * PUT /api/admin/clubs/:id
 */
const updateClub = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const club = await Club.findByIdAndUpdate(id, updates, { new: true });
    if (!club) {
      return errorResponse(res, 'Club not found.', 404);
    }

    return successResponse(res, { club }, 'Club updated successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Archive / Unarchive Club
 * POST /api/admin/clubs/:id/archive
 */
const archiveClub = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { archive = true } = req.body;

    const newStatus = archive ? 'archived' : 'active';
    const club = await Club.findByIdAndUpdate(id, { status: newStatus }, { new: true });
    if (!club) {
      return errorResponse(res, 'Club not found.', 404);
    }

    return successResponse(res, { club }, `Club "${club.name}" status set to ${newStatus}.`);
  } catch (error) {
    next(error);
  }
};

/**
 * View Club Membership
 * GET /api/admin/clubs/:id/members
 */
const getClubMembers = async (req, res, next) => {
  try {
    const { id } = req.params;

    const club = await Club.findById(id).populate(
      'members',
      'name email avatar isVerified city relationshipIntent level'
    );
    if (!club) {
      return errorResponse(res, 'Club not found.', 404);
    }

    return successResponse(
      res,
      {
        clubName: club.name,
        memberCount: club.members.length,
        members: club.members
      },
      'Club membership retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 7. CAMPUS MANAGEMENT: Areas, availability, capacity, featured
 * GET /api/admin/campus/config
 */
const getCampusConfig = async (req, res, next) => {
  try {
    const settings = await PlatformSetting.getOrCreateDefault();
    const onlinePlayers = getOnlinePlayersList();

    // Calculate current live occupancy per zone from socket telemetry
    const occupancyByZone = {};
    onlinePlayers.forEach((p) => {
      const z = p.campusArea || p.currentZone || 'main-plaza';
      occupancyByZone[z] = (occupancyByZone[z] || 0) + 1;
    });

    const enrichedAreas = settings.campusAreas.map((area) => ({
      ...area.toObject(),
      currentOccupancy: occupancyByZone[area.id] || 0
    }));

    return successResponse(
      res,
      {
        campusAreas: enrichedAreas,
        maxCampusCapacity: settings.maxCampusCapacity,
        maintenanceMode: settings.maintenanceMode,
        maintenanceMessage: settings.maintenanceMessage
      },
      'Campus configuration retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Update Campus Area Availability & Settings
 * PUT /api/admin/campus/areas/:areaId
 */
const updateCampusArea = async (req, res, next) => {
  try {
    const { areaId } = req.params;
    const { status, capacity, description, isFeatured, announcement, ambientTrack } = req.body;

    const settings = await PlatformSetting.getOrCreateDefault();
    const areaIndex = settings.campusAreas.findIndex((a) => a.id === areaId);

    if (areaIndex === -1) {
      return errorResponse(res, `Campus area "${areaId}" not found.`, 404);
    }

    if (status !== undefined) settings.campusAreas[areaIndex].status = status;
    if (capacity !== undefined) settings.campusAreas[areaIndex].capacity = capacity;
    if (description !== undefined) settings.campusAreas[areaIndex].description = description;
    if (isFeatured !== undefined) settings.campusAreas[areaIndex].isFeatured = isFeatured;
    if (announcement !== undefined) settings.campusAreas[areaIndex].announcement = announcement;
    if (ambientTrack !== undefined) settings.campusAreas[areaIndex].ambientTrack = ambientTrack;

    await settings.save();

    return successResponse(
      res,
      { area: settings.campusAreas[areaIndex] },
      `Campus area "${areaId}" updated successfully`
    );
  } catch (error) {
    next(error);
  }
};

/**
 * 8. ANALYTICS: DAU, WAU, MAU, Trends, Participation Charts
 * GET /api/admin/analytics
 */
const getAnalytics = async (req, res, next) => {
  try {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;

    // Daily registrations over last 7 days
    const last7DaysRegistrations = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - (i + 1) * dayMs);
      const dayEnd = new Date(now.getTime() - i * dayMs);
      const label = dayEnd.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });

      const count = await User.countDocuments({
        createdAt: { $gte: dayStart, $lt: dayEnd }
      });

      last7DaysRegistrations.push({ date: label, count });
    }

    // Active metrics
    const dau = await User.countDocuments({ lastActive: { $gte: new Date(now.getTime() - dayMs) } });
    const wau = await User.countDocuments({ lastActive: { $gte: new Date(now.getTime() - 7 * dayMs) } });
    const mau = await User.countDocuments({ lastActive: { $gte: new Date(now.getTime() - 30 * dayMs) } });

    // Connections & Matches & Messages volume
    const [totalConnections, totalMatches, totalMessages] = await Promise.all([
      Connection.countDocuments(),
      Match.countDocuments(),
      Message.countDocuments()
    ]);

    // Event participation breakdown
    const events = await Event.find().select('title participants attendeeIds status attendeesCount').limit(10);
    const eventStats = events.map((e) => ({
      title: e.title,
      attendees: e.participants?.length || e.attendeesCount || 0,
      status: e.status
    }));

    // Club membership breakdown
    const clubs = await Club.find().select('name memberCount icon category').limit(10);
    const clubStats = clubs.map((c) => ({
      name: c.name,
      icon: c.icon,
      members: c.memberCount || 0,
      category: c.category
    }));

    // Reports breakdown by reason
    const reportReasons = await Report.aggregate([
      { $group: { _id: '$reason', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const reportStatusStats = await Report.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const analyticsData = {
      users: {
        dau,
        wau,
        mau,
        stickiness: mau > 0 ? ((dau / mau) * 100).toFixed(1) : '0'
      },
      growth: {
        registrationsTrend: last7DaysRegistrations
      },
      socialEngagement: {
        totalConnections,
        totalMatches,
        totalMessages,
        matchRate: totalConnections > 0 ? ((totalMatches / totalConnections) * 100).toFixed(1) : '0'
      },
      eventParticipation: eventStats,
      clubParticipation: clubStats,
      safetyMetrics: {
        reportsByReason: reportReasons.map((r) => ({ reason: r._id, count: r.count })),
        reportsByStatus: reportStatusStats.map((s) => ({ status: s._id, count: s.count }))
      }
    };

    return successResponse(res, analyticsData, 'Platform analytics retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * 9. SUBSCRIPTIONS: Tiers, subscriber counts, conversion
 * GET /api/admin/subscriptions
 */
const getSubscriptionsOverview = async (req, res, next) => {
  try {
    const settings = await PlatformSetting.getOrCreateDefault();

    const [totalUsers, freeUsers, premiumUsers] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ subscriptionStatus: 'free' }),
      User.countDocuments({ subscriptionStatus: { $ne: 'free' } })
    ]);

    const conversionRate = totalUsers > 0 ? ((premiumUsers / totalUsers) * 100).toFixed(1) : '0';
    const estimatedMonthlyRevenue = (premiumUsers * 14.99).toFixed(2);

    const subscriptionData = {
      overview: {
        totalUsers,
        freeUsers,
        premiumUsers,
        conversionRate: `${conversionRate}%`,
        estimatedMonthlyRevenue: `$${estimatedMonthlyRevenue}`
      },
      tiers: settings.subscriptionTiers
    };

    return successResponse(res, subscriptionData, 'Subscription telemetry retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * 10. PLATFORM SETTINGS: System configuration & controls
 * GET /api/admin/settings
 */
const getPlatformSettings = async (req, res, next) => {
  try {
    const settings = await PlatformSetting.getOrCreateDefault();
    return successResponse(res, { settings }, 'Platform settings retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Update Platform Settings
 * PUT /api/admin/settings
 */
const updatePlatformSettings = async (req, res, next) => {
  try {
    const {
      maintenanceMode,
      maintenanceMessage,
      minAgeRequirement,
      registrationStatus,
      maxCampusCapacity,
      allowDirectWhispers,
      contentAutoFilter,
      flaggedKeywords
    } = req.body;

    const settings = await PlatformSetting.getOrCreateDefault();

    if (maintenanceMode !== undefined) settings.maintenanceMode = maintenanceMode;
    if (maintenanceMessage !== undefined) settings.maintenanceMessage = maintenanceMessage;
    if (minAgeRequirement !== undefined) settings.minAgeRequirement = minAgeRequirement;
    if (registrationStatus !== undefined) settings.registrationStatus = registrationStatus;
    if (maxCampusCapacity !== undefined) settings.maxCampusCapacity = maxCampusCapacity;
    if (allowDirectWhispers !== undefined) settings.allowDirectWhispers = allowDirectWhispers;
    if (contentAutoFilter !== undefined) settings.contentAutoFilter = contentAutoFilter;
    if (flaggedKeywords !== undefined) settings.flaggedKeywords = flaggedKeywords;

    await settings.save();

    return successResponse(res, { settings }, 'Platform settings updated successfully');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  // 1. Overview
  getOverviewStats,
  // 2. Users
  getUsers,
  getUserDetails,
  suspendUser,
  unsuspendUser,
  banUser,
  unbanUser,
  verifyUser,
  // 3 & 4. Reports & Moderation
  getReports,
  updateReport,
  takeModerationAction,
  // 5. Events
  getAdminEvents,
  createEvent,
  updateEvent,
  cancelEvent,
  deleteEvent,
  getEventParticipants,
  // 6. Clubs
  getAdminClubs,
  createClub,
  updateClub,
  archiveClub,
  getClubMembers,
  // 7. Campus
  getCampusConfig,
  updateCampusArea,
  // 8. Analytics
  getAnalytics,
  // 9. Subscriptions
  getSubscriptionsOverview,
  // 10. Platform Settings
  getPlatformSettings,
  updatePlatformSettings
};
