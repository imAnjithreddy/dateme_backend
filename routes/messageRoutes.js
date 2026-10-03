const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.get('/conversations', messageController.getConversations);
router.get('/:connectionId', messageController.getMessages);
router.post('/:connectionId', messageController.sendMessage);

module.exports = router;
