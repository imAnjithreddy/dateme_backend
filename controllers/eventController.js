const Event = require('../models/Event');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { awardParticipationXp } = require('../services/gamificationService');

/**
 * Get upcoming campus events
 * GET /api/events
 */
const getEvents = async (req, res, next) => {
  try {
    const { category, status, virtualArea, search } = req.query;
    const query = {};

    if (category && category !== 'all') {
      query.category = category.toLowerCase();
    }
    if (status && status !== 'all') {
      query.status = status;
    }
    if (virtualArea && virtualArea !== 'all') {
      query.$or = [{ virtualArea }, { zoneId: virtualArea }];
    }
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } }
      ];
    }

    const events = await Event.find(query).sort({ startTime: 1 });

    const formatted = events.map((ev) => {
      const isAttending = req.user
        ? ev.participants.some((p) => p.toString() === req.user._id.toString()) ||
          ev.attendeeIds.some((p) => p.toString() === req.user._id.toString())
        : false;

      return {
        ...ev.toObject(),
        isAttending,
        participantsCount: ev.participants.length || ev.attendeesCount || 0
      };
    });

    return successResponse(res, { events: formatted, count: formatted.length }, 'Events retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Get single event details
 * GET /api/events/:id
 */
const getEventById = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id).populate(
      'participants',
      'name displayName avatar city bio onlineStatus role relationshipIntent'
    );

    if (!event) {
      return errorResponse(res, 'Event not found.', 404);
    }

    const isAttending = req.user
      ? event.participants.some((p) => p._id.toString() === req.user._id.toString())
      : false;

    return successResponse(
      res,
      {
        event: {
          ...event.toObject(),
          isAttending,
          participantsCount: event.participants.length
        }
      },
      'Event details retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Join (RSVP) or leave an event
 * POST /api/events/:id/rsvp or POST /api/events/:id/join
 */
const toggleRsvp = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return errorResponse(res, 'Event not found.', 404);
    }

    const userId = req.user._id;
    const isAttending =
      event.participants.some((p) => p.toString() === userId.toString()) ||
      event.attendeeIds.some((p) => p.toString() === userId.toString());

    if (isAttending) {
      event.participants = event.participants.filter((id) => id.toString() !== userId.toString());
      event.attendeeIds = event.participants;
      event.attendeesCount = event.participants.length;
    } else {
      event.participants.push(userId);
      event.attendeeIds = event.participants;
      event.attendeesCount = event.participants.length;

      // Award XP & Event Explorer badge for joining a campus event
      await awardParticipationXp(userId, `joined_event_${event._id}`, 75, { badgeId: 'event_explorer' });
    }

    await event.save();

    return successResponse(
      res,
      {
        isAttending: !isAttending,
        participantsCount: event.participants.length,
        attendeesCount: event.attendeesCount,
        event
      },
      !isAttending ? 'RSVP confirmed! See you at the event.' : 'RSVP cancelled.'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get event participants list
 * GET /api/events/:id/participants
 */
const getEventParticipants = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id).populate(
      'participants',
      'name displayName avatar city bio onlineStatus role relationshipIntent'
    );

    if (!event) {
      return errorResponse(res, 'Event not found.', 404);
    }

    return successResponse(
      res,
      { participants: event.participants, count: event.participants.length },
      'Event participants retrieved'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getEvents,
  getEventById,
  toggleRsvp,
  getEventParticipants
};
