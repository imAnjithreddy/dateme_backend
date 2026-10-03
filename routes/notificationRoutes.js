const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.get('/', notificationController.getNotifications);
router.put('/read', notificationController.markAsRead);

module.exports = router;
