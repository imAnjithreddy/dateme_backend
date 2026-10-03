const express = require('express');
const router = express.Router();
const conversationController = require('../controllers/conversationController');
const { authenticateUser } = require('../middleware/auth');

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
router.post('/:conversationId/messages', conversationController.sendMessage);
router.delete('/:conversationId', conversationController.deleteConversation);

module.exports = router;

