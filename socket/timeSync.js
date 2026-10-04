/**
 * timeSync.js
 * High-precision server time synchronization handler for Datee_me
 *
 * Implements lightweight NTP-style ping/pong handshake:
 * Client sends: { clientTime: performance.now() }
 * Server responds: { clientTime, serverTime: Date.now() }
 */

function attachTimeSyncHandlers(socket) {
  socket.on('sync:ping', (data = {}) => {
    socket.emit('sync:pong', {
      clientTime: data.clientTime || 0,
      serverTime: Date.now()
    });
  });
}

module.exports = { attachTimeSyncHandlers };
