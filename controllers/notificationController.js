const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');
const { successResponse, errorResponse } = require('../utils/apiResponse');

/**
 * Get user notifications
 * GET /api/notifications
 */
const getNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.find({ recipient: req.user._id })
      .populate('sender', 'name avatar role city')
      .populate({
        path: 'data.connectionId',
        select: 'status requester recipient createdAt'
      })
      .sort({ createdAt: -1 })
      .limit(50);

    const unreadCount = await notificationService.getUnreadCount(req.user._id);

    return successResponse(
      res,
      {
        notifications,
        unreadCount
      },
      'Notifications retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Mark notification(s) as read
 * PUT /api/notifications/read
 */
const markAsRead = async (req, res, next) => {
  try {
    const { notificationId, markAll = false } = req.body;

    if (!markAll && !notificationId) {
      return errorResponse(res, 'Notification ID or markAll flag required.', 400);
    }

    const { unreadCount } = await notificationService.markAndEmitRead({
      userId: req.user._id,
      notificationId,
      markAll
    });

    return successResponse(
      res,
      { unreadCount },
      markAll ? 'All notifications marked as read.' : 'Notification marked as read.'
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNotifications,
  markAsRead
};
