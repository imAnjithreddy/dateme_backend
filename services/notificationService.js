/**
 * notificationService.js
 * Centralized Real-time Notification Engine for Datee_me
 *
 * SPECIFICATION:
 * - Persists notifications to MongoDB.
 * - Enforces Clean URL compliance on actionUrl (removes ID query parameters).
 * - Immediately calculates updated unread count.
 * - Broadcasts real-time WebSocket events to recipient's private room:
 *   - 'notification:new'
 *   - 'notification:count'
 * - Handles mark-as-read synchronization across all open client tabs:
 *   - 'notification:marked_read'
 */

const Notification = require('../models/Notification');

class NotificationService {
  /**
   * Helper to safely get the active Socket.IO server instance
   */
  getIOInstance() {
    try {
      const socketModule = require('../socket');
      if (typeof socketModule.getIO === 'function') {
        return socketModule.getIO();
      }
    } catch (e) {
      // In testing or bootstrap before socket init
    }
    return null;
  }

  /**
   * Sanitize actionUrl to ensure clean routing without query parameter IDs
   */
  sanitizeActionUrl(url) {
    if (!url || typeof url !== 'string') return '/notifications';
    // Strip query parameters to comply with Clean URL policy
    const [path] = url.split('?');
    return path || '/notifications';
  }

  /**
   * Create and immediately broadcast a new notification
   */
  async createAndEmitNotification({
    recipient,
    sender = null,
    type,
    title,
    message,
    data = {}
  }) {
    if (!recipient) {
      console.warn('[NotificationService] Missing recipient for notification');
      return null;
    }

    const cleanData = { ...data };
    if (cleanData.actionUrl) {
      cleanData.actionUrl = this.sanitizeActionUrl(cleanData.actionUrl);
    }

    // 1. Persist notification to database
    const notification = await Notification.create({
      recipient,
      sender: sender || null,
      type: type || 'system',
      title: title || 'New Notification',
      message: message || '',
      data: cleanData,
      isRead: false
    });

    // 2. Populate sender details if available
    if (sender) {
      await notification.populate('sender', 'name displayName avatar role city');
    }

    // 3. Compute accurate unread count for recipient
    const recipientIdStr = recipient.toString();
    const unreadCount = await Notification.countDocuments({
      recipient,
      isRead: false
    });

    // 4. Instant WebSocket broadcast to recipient's private room
    const io = this.getIOInstance();
    if (io) {
      const userRoom = `user:${recipientIdStr}`;
      const payload = {
        notification: notification.toObject ? notification.toObject() : notification,
        unreadCount
      };

      io.to(userRoom).emit('notification:new', payload);
      io.to(userRoom).emit('notification:count', { unreadCount });
    }

    return {
      notification,
      unreadCount
    };
  }

  /**
   * Mark notification(s) as read and sync all user tabs via WebSockets
   */
  async markAndEmitRead({ userId, notificationId = null, markAll = false }) {
    if (!userId) return { unreadCount: 0 };

    if (markAll) {
      await Notification.updateMany(
        { recipient: userId, isRead: false },
        { isRead: true }
      );
    } else if (notificationId) {
      await Notification.updateOne(
        { _id: notificationId, recipient: userId },
        { isRead: true }
      );
    }

    const unreadCount = await Notification.countDocuments({
      recipient: userId,
      isRead: false
    });

    const io = this.getIOInstance();
    if (io) {
      const userRoom = `user:${userId.toString()}`;
      io.to(userRoom).emit('notification:count', { unreadCount });
      io.to(userRoom).emit('notification:marked_read', {
        notificationId: notificationId ? notificationId.toString() : null,
        markAll: Boolean(markAll),
        unreadCount
      });
    }

    return { unreadCount };
  }

  /**
   * Get current unread notification count
   */
  async getUnreadCount(userId) {
    if (!userId) return 0;
    return await Notification.countDocuments({
      recipient: userId,
      isRead: false
    });
  }
}

// Global Singleton
const notificationService = new NotificationService();
module.exports = notificationService;
