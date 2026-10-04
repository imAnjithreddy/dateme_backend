const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateUser, requireAdmin } = require('../middleware/auth');

// STRICT SECURITY ENFORCEMENT:
// All routes in this router MUST verify:
// 1. Valid JWT authentication token
// 2. PLATFORM_ADMIN role exclusively
router.use(authenticateUser);
router.use(requireAdmin);

// 1. Overview
router.get('/overview', adminController.getOverviewStats);

// 2. Users Management
router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUserDetails);
router.get('/users/:id/moderation-history', adminController.getUserModerationHistory);
router.post('/users/:id/suspend', adminController.suspendUser);
router.post('/users/:id/unsuspend', adminController.unsuspendUser);
router.post('/users/:id/ban', adminController.banUser);
router.post('/users/:id/unban', adminController.unbanUser);
router.post('/users/:id/verify', adminController.verifyUser);

// 3. Reports & 4. Moderation
router.get('/reports', adminController.getReports);
router.put('/reports/:id', adminController.updateReport);
router.post('/moderation/action', adminController.takeModerationAction);

// 5. Events Management
router.get('/events', adminController.getAdminEvents);
router.post('/events', adminController.createEvent);
router.put('/events/:id', adminController.updateEvent);
router.post('/events/:id/cancel', adminController.cancelEvent);
router.delete('/events/:id', adminController.deleteEvent);
router.get('/events/:id/participants', adminController.getEventParticipants);

// 6. Clubs Management
router.get('/clubs', adminController.getAdminClubs);
router.post('/clubs', adminController.createClub);
router.put('/clubs/:id', adminController.updateClub);
router.post('/clubs/:id/archive', adminController.archiveClub);
router.get('/clubs/:id/members', adminController.getClubMembers);

// 7. Campus Management
router.get('/campus/config', adminController.getCampusConfig);
router.put('/campus/areas/:areaId', adminController.updateCampusArea);

// 8. Analytics
router.get('/analytics', adminController.getAnalytics);

// 9. Subscriptions
router.get('/subscriptions', adminController.getSubscriptionsOverview);

// 10. Platform Settings
router.get('/settings', adminController.getPlatformSettings);
router.put('/settings', adminController.updatePlatformSettings);

module.exports = router;
