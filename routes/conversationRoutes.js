const express = require('express');
const router = express.Router();
const conversationController = require('../controllers/conversationController');
const { authenticateUser } = require('../middleware/auth');

const { messageRateLimiter } = require('../middleware/rateLimiter');

// All direct messaging routes strictly require authentication
router.use(authenticateUser);

/**
 * Direct Messaging API Endpoints:
 * GET  /conversations
 * GET  /conversations/:conversationId/messages
 * POST /conversations/:conversationId/messages
 */
router.get('/', conversationController.getConversations);
router.get('/with/:targetUserId', conversationController.getOrCreateWithUser);
router.get('/:conversationId/messages', conversationController.getMessages);
router.post('/:conversationId/messages', messageRateLimiter(), conversationController.sendMessage);
router.post('/:conversationId/mute', conversationController.muteConversation);
router.post('/:conversationId/unmute', conversationController.unmuteConversation);
router.delete('/:conversationId', conversationController.deleteConversation);

module.exports = router;

