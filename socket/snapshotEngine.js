/**
 * snapshotEngine.js
 * Authoritative Server Snapshot & Movement Engine for Datee_me Campus
 *
 * SPECIFICATION:
 * - Server remains strictly authoritative for position and movement state.
 * - 15 Hz tick loop (emits snapshots every ~66.6ms).
 * - Monotonically increasing sequence numbers per snapshot.
 * - Movement validation: speed limit enforcement, world bounds, teleport rejection.
 * - Area-of-interest zone filtering to optimize multiplayer bandwidth.
 * - Compact snapshot payloads containing only movement-critical data.
 */

const TICK_RATE_HZ = 15;
const TICK_INTERVAL_MS = 1000 / TICK_RATE_HZ; // ~66.67ms

const { resolveLobbyMovement } = require('./DateeHomesLobbyCollision');

// Speed thresholds (pixels per second in 2D coordinate space)
const MAX_WALK_SPEED = 240;  // Normal walk speed is ~150-180 px/s
const MAX_RUN_SPEED = 340;   // Sprint speed is ~280 px/s
const MAX_TELEPORT_DIST = 180; // Distance beyond which moves are rejected as teleports unless seated/teleport flag

class SnapshotEngine {
  constructor() {
    this.players = new Map(); // socketId -> AuthoritativePlayerState
    this.playerByUserId = new Map(); // userId -> socketId
    this.sequence = 0;
    this.tickTimer = null;
    this.io = null;
    this.isRunning = false;
  }

  /**
   * Initialize and start the authoritative tick loop
   */
  start(ioInstance) {
    this.io = ioInstance;
    if (this.isRunning) return;
    this.isRunning = true;

    this.tickTimer = setInterval(() => {
      this.tick();
    }, TICK_INTERVAL_MS);

    console.log(`[SnapshotEngine] Authoritative 15 Hz snapshot engine started (tick interval: ${TICK_INTERVAL_MS.toFixed(1)}ms).`);
  }

  /**
   * Stop the tick loop
   */
  stop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.isRunning = false;
    console.log('[SnapshotEngine] Stopped.');
  }

  /**
   * Register or update a player in the authoritative engine
   */
  registerPlayer(socketId, user, initialData = {}) {
    if (!socketId || !user) return;
    const userId = (user._id || user.id || user.userId || socketId).toString();

    const x = typeof initialData.x === 'number' ? initialData.x : (typeof user.x === 'number' ? user.x : 1800);
    const y = typeof initialData.y === 'number' ? initialData.y : (typeof user.y === 'number' ? user.y : 1700);
    const campusArea = initialData.campusArea || initialData.zone || user.campusArea || user.zone || 'main-plaza';

    const playerState = {
      socketId,
      userId,
      name: user.name || user.displayName || 'Campus Student',
      displayName: user.displayName || user.name || 'Campus Student',
      avatar: user.avatar || {},
      x,
      y,
      vx: 0,
      vy: 0,
      direction: initialData.direction || initialData.facing || user.direction || user.facing || 'down',
      movementState: initialData.movementState || user.movementState || (initialData.isSeated || user.isSeated ? 'sit' : 'idle'),
      isSeated: Boolean(initialData.isSeated || user.isSeated),
      seatId: initialData.seatId || user.seatId || null,
      campusArea,
      lastUpdateTimestamp: Date.now(),
      lastClientSequence: 0
    };

    this.players.set(socketId, playerState);
    this.playerByUserId.set(userId, socketId);
  }

  /**
   * Remove a player on disconnect
   */
  unregisterPlayer(socketId) {
    const player = this.players.get(socketId);
    if (player) {
      this.playerByUserId.delete(player.userId);
      this.players.delete(socketId);
    }
  }

  /**
   * Authoritative validation and state update for incoming player movement inputs
   */
  processMovementInput(socketId, inputData = {}) {
    const player = this.players.get(socketId);
    if (!player) return null;

    const now = Date.now();
    const dt = Math.max(0.001, (now - player.lastUpdateTimestamp) / 1000); // in seconds

    // Client sequence tracking
    const clientSeq = typeof inputData.sequence === 'number' ? inputData.sequence : player.lastClientSequence + 1;
    if (clientSeq < player.lastClientSequence) {
      // Discard older out-of-order input packet
      return null;
    }
    player.lastClientSequence = clientSeq;
    player.lastInputSeq = clientSeq;

    // Seated players cannot move unless standing up first
    if (player.isSeated && !inputData.standUp) {
      return null;
    }

    const targetX = typeof inputData.x === 'number' ? inputData.x : player.x;
    const targetY = typeof inputData.y === 'number' ? (typeof inputData.z === 'number' ? inputData.z : inputData.y) : player.y;

    // 1. Boundary Validation (Clamp to map boundaries [0, 3800])
    const clampedX = Math.max(20, Math.min(3780, targetX));
    const clampedY = Math.max(20, Math.min(3780, targetY));

    // 2. Speed and Teleport Validation
    const dx = clampedX - player.x;
    const dy = clampedY - player.y;
    const distanceMoved = Math.hypot(dx, dy);

    // Calculate maximum allowable distance in this time step
    const isRunning = inputData.movementState === 'run';
    const allowedSpeed = isRunning ? MAX_RUN_SPEED : MAX_WALK_SPEED;
    const maxAllowedDist = allowedSpeed * dt + 15; // +15px tolerance for minor network jitter

    let validatedX = clampedX;
    let validatedY = clampedY;
    let validatedVx = 0;
    let validatedVy = 0;

    if (distanceMoved > MAX_TELEPORT_DIST && !inputData.isTeleport) {
      // Reject large teleport attempt: clamp to max allowed distance in the movement direction
      const angle = Math.atan2(dy, dx);
      validatedX = player.x + Math.cos(angle) * maxAllowedDist;
      validatedY = player.y + Math.sin(angle) * maxAllowedDist;
      validatedVx = Math.cos(angle) * allowedSpeed;
      validatedVy = Math.sin(angle) * allowedSpeed;
    } else if (distanceMoved > maxAllowedDist && dt < 1.0) {
      // Minor speed cap
      const angle = Math.atan2(dy, dx);
      validatedX = player.x + Math.cos(angle) * maxAllowedDist;
      validatedY = player.y + Math.sin(angle) * maxAllowedDist;
      validatedVx = Math.cos(angle) * allowedSpeed;
      validatedVy = Math.sin(angle) * allowedSpeed;
    } else if (distanceMoved > 0.5) {
      // Valid continuous movement
      validatedVx = dx / dt;
      validatedVy = dy / dt;
    }

    // 2B. Authoritative Interior Collision Validation (Datee Homes Lobby)
    const effectiveArea = inputData.campusArea || player.campusArea;
    if (effectiveArea === 'datee-homes-lobby' || effectiveArea === 'DATEE_HOMES_LOBBY') {
      const lobbyRes = resolveLobbyMovement(player.x, player.y, validatedX, validatedY, 9);
      validatedX = lobbyRes.x;
      validatedY = lobbyRes.y;
    }

    // 3. Direction and Animation State Derivation
    let direction = player.direction;
    if (inputData.direction || inputData.facing || inputData.rotation) {
      direction = inputData.direction || inputData.facing || inputData.rotation;
    } else if (distanceMoved > 1.0) {
      const angle = Math.atan2(dy, dx);
      if (angle > -Math.PI / 4 && angle <= Math.PI / 4) direction = 'right';
      else if (angle > Math.PI / 4 && angle <= (3 * Math.PI) / 4) direction = 'down';
      else if (angle > -(3 * Math.PI) / 4 && angle <= -Math.PI / 4) direction = 'up';
      else direction = 'left';
    }

    const movementState = distanceMoved > 1.0 ? (isRunning ? 'run' : 'walk') : 'idle';

    // Update authoritative state
    player.x = validatedX;
    player.y = validatedY;
    player.vx = validatedVx;
    player.vy = validatedVy;
    player.direction = direction;
    player.movementState = movementState;
    if (inputData.campusArea) player.campusArea = inputData.campusArea;
    player.lastUpdateTimestamp = now;

    return player;
  }

  /**
   * Update seating status authoritatively
   */
  /**
   * Update seating status authoritatively
   */
  setPlayerSeated(socketId, isSeatedOrObj, seatId = null, x = null, y = null, facing = null) {
    const player = this.players.get(socketId);
    if (!player) return;

    if (typeof isSeatedOrObj === 'object' && isSeatedOrObj !== null) {
      player.isSeated = true;
      player.seatId = isSeatedOrObj.seatId || isSeatedOrObj.chairId || null;
      player.chairId = player.seatId;
      if (typeof isSeatedOrObj.chairX === 'number') player.x = isSeatedOrObj.chairX;
      else if (typeof isSeatedOrObj.x === 'number') player.x = isSeatedOrObj.x;
      if (typeof isSeatedOrObj.chairY === 'number') player.y = isSeatedOrObj.chairY;
      else if (typeof isSeatedOrObj.y === 'number') player.y = isSeatedOrObj.y;
      if (isSeatedOrObj.facing) player.direction = isSeatedOrObj.facing;
      player.movementState = 'sit';
      player.vx = 0;
      player.vy = 0;
      player.lastUpdateTimestamp = Date.now();
      return;
    }

    player.isSeated = Boolean(isSeatedOrObj);
    player.seatId = seatId;
    player.chairId = seatId;
    player.movementState = player.isSeated ? 'sit' : 'idle';
    player.vx = 0;
    player.vy = 0;
    if (typeof x === 'number') player.x = x;
    if (typeof y === 'number') player.y = y;
    if (facing) player.direction = facing;
    player.lastUpdateTimestamp = Date.now();
  }

  /**
   * Update player campus zone
   */
  setPlayerZone(socketId, newArea) {
    const player = this.players.get(socketId);
    if (player && newArea) {
      player.campusArea = newArea;
    }
  }

  /**
   * Generate and broadcast authoritative world snapshots at 15 Hz
   */
  tick() {
    if (!this.io || this.players.size === 0) return;

    this.sequence++;
    const serverTimestamp = Date.now();

    // Group players by campusArea for Interest Management
    const areaGroups = new Map();

    for (const player of this.players.values()) {
      const area = player.campusArea || 'main-plaza';
      if (!areaGroups.has(area)) {
        areaGroups.set(area, []);
      }
      // Compact record
      areaGroups.get(area).push({
        id: player.userId,
        sId: player.socketId,
        x: Math.round(player.x * 10) / 10,
        y: Math.round(player.y * 10) / 10,
        vx: Math.round(player.vx * 10) / 10,
        vy: Math.round(player.vy * 10) / 10,
        dir: player.direction,
        st: player.movementState,
        sit: player.isSeated,
        seat: player.seatId
      });
    }

    // 1. Emit localized snapshots per campus area
    for (const [area, playerRecords] of areaGroups.entries()) {
      const snapshotPayload = {
        serverTimestamp,
        t: serverTimestamp,
        seq: this.sequence,
        sequence: this.sequence,
        area,
        players: playerRecords
      };
      this.io.to(`area:${area}`).emit('world:snapshot', snapshotPayload);
    }

    // 2. Also emit global world snapshot to campus:world for outdoor campus observers.
    // Strictly isolate interior players (e.g. private-room, datee-homes-lobby) so they never leak as ghost avatars outdoors.
    const outdoorPlayersCompact = Array.from(this.players.values())
      .filter((p) => p.campusArea !== 'private-room' && p.campusArea !== 'datee-homes-lobby')
      .map((p) => ({
        id: p.userId,
        sId: p.socketId,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        vx: Math.round(p.vx * 10) / 10,
        vy: Math.round(p.vy * 10) / 10,
        dir: p.direction,
        st: p.movementState,
        sit: p.isSeated,
        seat: p.seatId,
        area: p.campusArea
      }));

    this.io.to('campus:world').emit('world:snapshot', {
      serverTimestamp,
      t: serverTimestamp,
      seq: this.sequence,
      sequence: this.sequence,
      players: outdoorPlayersCompact
    });
  }

  /**
   * Get current player state
   */
  getPlayer(socketId) {
    return this.players.get(socketId);
  }

  getPlayerByUserId(userId) {
    const sId = this.playerByUserId.get(userId);
    return sId ? this.players.get(sId) : null;
  }

  getAllPlayers() {
    return Array.from(this.players.values());
  }
}

// Global Singleton
const snapshotEngine = new SnapshotEngine();
module.exports = snapshotEngine;
