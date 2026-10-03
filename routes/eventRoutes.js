const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.get('/', eventController.getEvents);
router.get('/:id', eventController.getEventById);
router.post('/:id/rsvp', eventController.toggleRsvp);
router.post('/:id/join', eventController.toggleRsvp);
router.post('/:id/leave', eventController.toggleRsvp);
router.get('/:id/participants', eventController.getEventParticipants);

module.exports = router;
