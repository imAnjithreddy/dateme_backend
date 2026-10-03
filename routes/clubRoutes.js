const express = require('express');
const router = express.Router();
const clubController = require('../controllers/clubController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.get('/', clubController.getClubs);
router.get('/:id', clubController.getClubById);
router.post('/:id/join', clubController.toggleJoinClub);
router.post('/:id/leave', clubController.toggleJoinClub);
router.get('/:id/members', clubController.getClubMembers);
router.get('/:id/posts', clubController.getClubPosts);
router.post('/:id/posts', clubController.createClubPost);
router.post('/posts/:postId/like', clubController.toggleLikePost);
router.get('/:id/events', clubController.getClubEvents);

module.exports = router;
