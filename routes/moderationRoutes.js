const express = require('express');
const router = express.Router();
const moderationController = require('../controllers/moderationController');
const { authenticateUser, requireAdmin } = require('../middleware/auth');

const { reportRateLimiter } = require('../middleware/rateLimiter');

router.use(authenticateUser);

router.post('/block', moderationController.blockUser);
router.post('/unblock', moderationController.unblockUser);
router.get('/blocks', moderationController.getMyBlocks);
router.post('/report', reportRateLimiter(), moderationController.submitReport);
router.get('/my-reports', moderationController.getMyReports);

// Admin-only moderation endpoints
router.get('/admin/reports', requireAdmin, moderationController.getAdminReports);
router.put('/admin/reports/:id', requireAdmin, moderationController.updateAdminReport);

module.exports = router;
