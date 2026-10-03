const express = require('express');
const router = express.Router();
const {
  createInvite,
  respondInvite,
  getGameSession,
  submitMove,
  resetGame
} = require('../controllers/gameController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.post('/invite', createInvite);
router.post('/:id/respond', respondInvite);
router.get('/:id', getGameSession);
router.post('/:id/move', submitMove);
router.post('/:id/reset', resetGame);

module.exports = router;
