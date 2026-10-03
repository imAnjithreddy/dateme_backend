const mongoose = require('mongoose');
const { CAMPUS_ZONES } = require('../config/constants');
const { successResponse } = require('../utils/apiResponse');

const getHealth = (req, res) => {
  const mongoStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbStatus = mongoStates[mongoose.connection.readyState] || 'unknown';

  const healthData = {
    service: 'The Quad Campus API',
    version: '1.0.0',
    status: 'online',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatus,
      host: mongoose.connection.host || 'embedded-memory'
    },
    zones: CAMPUS_ZONES.map((z) => ({
      id: z.id,
      name: z.name,
      accentColor: z.accentColor
    }))
  };

  return successResponse(res, healthData, 'The Quad Campus API is operational');
};

const getCampusZones = (req, res) => {
  return successResponse(res, CAMPUS_ZONES, 'Campus zones retrieved');
};

module.exports = {
  getHealth,
  getCampusZones
};
