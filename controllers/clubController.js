const Club = require('../models/Club');
const ClubPost = require('../models/ClubPost');
const Event = require('../models/Event');
const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { awardParticipationXp } = require('../services/gamificationService');

/**
 * Get all campus clubs
 * GET /api/clubs
 */
const getClubs = async (req, res, next) => {
  try {
    const { category, search } = req.query;
    const ALLOWED_CATEGORIES = ['gaming', 'music', 'technology'];
    const query = {
      category: { $in: ALLOWED_CATEGORIES }
    };

    if (category && category !== 'all' && ALLOWED_CATEGORIES.includes(category.toLowerCase())) {
      query.category = category.toLowerCase();
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tagline: { $regex: search, $options: 'i' } }
      ];
    }

    const clubs = await Club.find(query).sort({ memberCount: -1 });

    const formatted = clubs.map((c) => {
      const isMember = req.user
        ? c.members.some((m) => m.toString() === req.user._id.toString()) ||
          c.memberIds.some((m) => m.toString() === req.user._id.toString())
        : false;
      return {
        ...c.toObject(),
        isMember
      };
    });

    return successResponse(res, { clubs: formatted, count: formatted.length }, 'Clubs retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Get single club details by ID
 * GET /api/clubs/:id
 */
const getClubById = async (req, res, next) => {
  try {
    const club = await Club.findById(req.params.id).populate(
      'members',
      'name displayName avatar city bio onlineStatus relationshipIntent role'
    );

    if (!club) {
      return errorResponse(res, 'Club not found.', 404);
    }

    const isMember = req.user
      ? club.members.some((m) => m._id.toString() === req.user._id.toString())
      : false;

    return successResponse(res, { club: { ...club.toObject(), isMember } }, 'Club details retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Join or leave a club
 * POST /api/clubs/:id/join
 */
const toggleJoinClub = async (req, res, next) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return errorResponse(res, 'Club not found.', 404);
    }

    const userId = req.user._id;
    const isMember =
      club.members.some((m) => m.toString() === userId.toString()) ||
      club.memberIds.some((m) => m.toString() === userId.toString());

    if (isMember) {
      club.members = club.members.filter((id) => id.toString() !== userId.toString());
      club.memberIds = club.members;
      club.memberCount = club.members.length;
    } else {
      club.members.push(userId);
      club.memberIds = club.members;
      club.memberCount = club.members.length;

      // Award XP for joining club
      let badgeId = null;
      if (club.category?.toLowerCase() === 'music') badgeId = 'music_lover';
      if (club.category?.toLowerCase() === 'books') badgeId = 'bookworm';
      await awardParticipationXp(userId, `joined_club_${club.category?.toLowerCase()}_${club._id}`, 50, { badgeId });
    }

    await club.save();

    return successResponse(
      res,
      { isMember: !isMember, memberCount: club.memberCount, club },
      !isMember ? `You joined the ${club.name} club!` : `You left the ${club.name} club.`
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get discussions / posts in a club
 * GET /api/clubs/:id/posts
 */
const getClubPosts = async (req, res, next) => {
  try {
    const { id } = req.params;
    const posts = await ClubPost.find({ club: id })
      .populate('author', 'name displayName avatar city role')
      .populate('comments.author', 'name displayName avatar role')
      .sort({ createdAt: -1 });

    const formatted = posts.map((p) => {
      const isLiked = req.user ? p.likes.some((u) => u.toString() === req.user._id.toString()) : false;
      return {
        ...p.toObject(),
        likesCount: p.likes.length,
        isLiked
      };
    });

    return successResponse(res, { posts: formatted, count: formatted.length }, 'Discussions retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new discussion post in a club
 * POST /api/clubs/:id/posts
 */
const createClubPost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, content } = req.body;

    if (!title || !content || !title.trim() || !content.trim()) {
      return errorResponse(res, 'Post title and content are required.', 400);
    }

    const club = await Club.findById(id);
    if (!club) {
      return errorResponse(res, 'Club not found.', 404);
    }

    const post = await ClubPost.create({
      club: id,
      author: req.user._id,
      title: title.trim().substring(0, 120),
      content: content.trim().substring(0, 2000),
      likes: []
    });

    const populated = await ClubPost.findById(post._id).populate('author', 'name displayName avatar city role');

    // Award XP & Community Member badge for participating in club discussions
    await awardParticipationXp(req.user._id, `created_club_post_${post._id}`, 50, { badgeId: 'community_member' });

    return successResponse(res, { post: populated }, 'Discussion post published!', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * Like or unlike a discussion post
 * POST /api/clubs/posts/:postId/like
 */
const toggleLikePost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const post = await ClubPost.findById(postId);
    if (!post) {
      return errorResponse(res, 'Post not found.', 404);
    }

    const userId = req.user._id;
    const alreadyLiked = post.likes.some((u) => u.toString() === userId.toString());

    if (alreadyLiked) {
      post.likes = post.likes.filter((u) => u.toString() !== userId.toString());
    } else {
      post.likes.push(userId);
    }

    await post.save();

    return successResponse(
      res,
      { isLiked: !alreadyLiked, likesCount: post.likes.length },
      !alreadyLiked ? 'Post liked' : 'Post unliked'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get members of a club
 * GET /api/clubs/:id/members
 */
const getClubMembers = async (req, res, next) => {
  try {
    const club = await Club.findById(req.params.id).populate(
      'members',
      'name displayName avatar city bio onlineStatus role relationshipIntent'
    );
    if (!club) {
      return errorResponse(res, 'Club not found.', 404);
    }
    return successResponse(res, { members: club.members, count: club.members.length }, 'Club members retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Get upcoming events associated with club
 * GET /api/clubs/:id/events
 */
const getClubEvents = async (req, res, next) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) {
      return errorResponse(res, 'Club not found.', 404);
    }

    const events = await Event.find({
      $or: [
        { club: club._id },
        { category: club.category },
        { virtualArea: club.virtualArea }
      ]
    }).sort({ startTime: 1 });

    const formatted = events.map((ev) => {
      const isAttending = req.user
        ? ev.participants.some((p) => p.toString() === req.user._id.toString()) ||
          ev.attendeeIds.some((p) => p.toString() === req.user._id.toString())
        : false;
      return {
        ...ev.toObject(),
        isAttending
      };
    });

    return successResponse(res, { events: formatted, count: formatted.length }, 'Club events retrieved');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getClubs,
  getClubById,
  toggleJoinClub,
  getClubPosts,
  createClubPost,
  toggleLikePost,
  getClubMembers,
  getClubEvents
};
