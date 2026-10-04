const express = require('express');
const router = express.Router();
const connectionController = require('../controllers/connectionController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.get('/', connectionController.getConnections);
router.get('/pending', connectionController.getPendingRequests);
router.get('/sent', connectionController.getSentRequests);
router.post('/request', connectionController.sendRequest);
router.post('/respond', connectionController.respondRequest);
router.put('/:connectionId/respond', connectionController.respondRequest);
router.post('/:connectionId/respond', connectionController.respondRequest);
router.post('/cancel', connectionController.cancelRequest);
router.post('/remove', connectionController.removeConnection);
router.post('/unmatch', connectionController.removeConnection);
router.post('/pass', connectionController.passUser);

module.exports = router;
