const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const connectionRoutes = require('./connectionRoutes');
const discoveryRoutes = require('./discoveryRoutes');
const notificationRoutes = require('./notificationRoutes');
const messageRoutes = require('./messageRoutes');
const eventRoutes = require('./eventRoutes');
const clubRoutes = require('./clubRoutes');
const gameRoutes = require('./gameRoutes');
const gamificationRoutes = require('./gamificationRoutes');
const matchRoutes = require('./matchRoutes');
const moderationRoutes = require('./moderationRoutes');
const friendRoutes = require('./friendRoutes');
const conversationRoutes = require('./conversationRoutes');
const systemRoutes = require('./systemRoutes');
const adminRoutes = require('./adminRoutes');
const privateRoomRoutes = require('./privateRoomRoutes');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { successResponse } = require('../utils/apiResponse');

// Core Platform Routes
router.use('/auth', authRoutes);
router.use('/private-rooms', privateRoomRoutes);
router.use('/users', userRoutes);
router.use('/friends', friendRoutes);
router.use('/conversations', conversationRoutes);
router.use('/connections', connectionRoutes);
router.use('/matches', matchRoutes);
router.use('/moderation', moderationRoutes);
router.use('/discovery', discoveryRoutes);
router.use('/notifications', notificationRoutes);
router.use('/messages', messageRoutes);
router.use('/events', eventRoutes);
router.use('/clubs', clubRoutes);
router.use('/games', gameRoutes);
router.use('/gamification', gamificationRoutes);
router.use('/system', systemRoutes);
router.use('/admin', adminRoutes);

// Helper for modular placeholder endpoints (clearly indicating architecture readiness)
const createModulePlaceholder = (moduleName, description) => {
  return (req, res) => {
    return successResponse(
      res,
      {
        module: moduleName,
        status: 'architected_placeholder',
        version: 'v1-pending-chunk',
        description,
        supportedMethods: ['GET', 'POST', 'PUT', 'DELETE'],
        endpoint: req.originalUrl
      },
      `${moduleName} module architecture is registered and prepared for next chunk implementation.`,
      200
    );
  };
};

router.use(
  '/campus',
  createModulePlaceholder('Virtual Campus & Zones', 'Real-time zone occupancy, coordinates, and interactive hotspots')
);

module.exports = router;
