const express = require('express');
const router = express.Router();
const friendController = require('../controllers/friendController');
const { authenticateUser } = require('../middleware/auth');

// All friendship actions require authenticated user
router.use(authenticateUser);

// 1. Send friend request
router.post('/request', friendController.sendFriendRequest);

// 2. Incoming friend requests (must be before /:requestId routes to prevent parameter collision)
router.get('/requests', friendController.getIncomingRequests);

// 3. Outgoing sent friend requests
router.get('/requests/sent', friendController.getSentRequests);

// 4. Friendship history (all interactions: accepted, declined, cancelled, removed, blocked)
router.get('/history', friendController.getFriendshipHistory);

// 5. Blocked users list
router.get('/blocked', friendController.getBlockedUsers);

// 6. Proximity & relationship status check for 2D campus
router.get('/status/:targetUserId', friendController.getFriendshipStatus);

// 7. Block a user relationship
router.post('/:targetUserId/block', friendController.blockUserRelationship);

// 7. Unblock a user relationship
router.post('/:targetUserId/unblock', friendController.unblockUserRelationship);

// 8. Accept friend request
router.post('/:requestId/accept', friendController.acceptFriendRequest);

// 9. Decline friend request
router.post('/:requestId/decline', friendController.declineFriendRequest);

// 10. Cancel sent friend request
router.post('/:requestId/cancel', friendController.cancelFriendRequest);

// 11. Unfriend / remove friend (Transitions state to REMOVED, preserving permanent history)
router.delete('/:friendId', friendController.unfriend);

// 12. Get list of active accepted friends
router.get('/', friendController.getFriends);

module.exports = router;
