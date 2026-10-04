const express = require('express');
const router = express.Router();
const privateRoomController = require('../controllers/privateRoomController');
const { authenticateUser } = require('../middleware/auth');

// All private room operations strictly require authentication
router.use(authenticateUser);

// 1. Create Room
router.post('/create', privateRoomController.createRoom);

// 2. Get My Rooms (Rooms where user is Owner or Member)
router.get('/my-rooms', privateRoomController.getMyRooms);

// 2b. Get Weekly Room Creation Quota
router.get('/quota', privateRoomController.getCreationQuota);

// 3. Join Room by Code
router.post('/join', privateRoomController.joinRoom);

// 4. Verify & Authorize Room Entry
router.get('/:roomId/access', privateRoomController.getRoomAccess);

// 5. Invite User to Room
router.post('/:roomId/invite', privateRoomController.inviteUser);

module.exports = router;
