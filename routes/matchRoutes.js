const express = require('express');
const router = express.Router();
const matchController = require('../controllers/matchController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.get('/', matchController.getMatches);
router.post('/unmatch', matchController.unmatch);
router.get('/:id', matchController.getMatchById);
router.post('/:id/unmatch', matchController.unmatch);

module.exports = router;
