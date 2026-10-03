const Notification = require('../models/Notification');
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

    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false
    });

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

    if (markAll) {
      await Notification.updateMany({ recipient: req.user._id }, { isRead: true });
      return successResponse(res, null, 'All notifications marked as read.');
    }

    if (notificationId) {
      await Notification.findOneAndUpdate(
        { _id: notificationId, recipient: req.user._id },
        { isRead: true }
      );
      return successResponse(res, null, 'Notification marked as read.');
    }

    return errorResponse(res, 'Notification ID or markAll flag required.', 400);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNotifications,
  markAsRead
};
