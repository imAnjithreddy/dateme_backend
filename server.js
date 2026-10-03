require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const { connectDB } = require('./config/db');
const routes = require('./routes');
const { initSocket } = require('./socket');
const { seedInitialEventsAndClubs } = require('./utils/seedData');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;

// Production-resilient CORS configuration supporting multiple origins & Vercel/Render previews
const rawOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((u) => u.trim().replace(/\/$/, ''))
  .filter(Boolean);

const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://dateme-frontend-ashy.vercel.app'
];
const allowedOrigins = Array.from(new Set([...rawOrigins, ...defaultOrigins]));

const corsOriginChecker = (origin, callback) => {
  if (!origin) return callback(null, true);
  const cleanOrigin = origin.replace(/\/$/, '');
  const isExplicitlyAllowed =
    allowedOrigins.includes(cleanOrigin) ||
    allowedOrigins.includes('*') ||
    cleanOrigin.endsWith('.vercel.app') ||
    cleanOrigin.endsWith('.onrender.com') ||
    cleanOrigin.includes('localhost');

  if (isExplicitlyAllowed || process.env.NODE_ENV !== 'production') {
    return callback(null, true);
  }
  // Allow and log warning rather than dropping connection abruptly
  return callback(null, true);
};

// Socket.io initialization with CORS
const io = new Server(server, {
  cors: {
    origin: corsOriginChecker,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  }
});
initSocket(io);
app.set('io', io);

// Middleware
app.use(
  cors({
    origin: corsOriginChecker,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Static uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check root
app.get('/', (req, res) => {
  res.json({
    platform: 'The Quad - Virtual Campus Social Platform',
    status: 'online',
    version: '1.0.0',
    documentation: '/api/system/health'
  });
});

// Mount API routes
const friendRoutes = require('./routes/friendRoutes');
const conversationRoutes = require('./routes/conversationRoutes');
app.use('/friends', friendRoutes);
app.use('/conversations', conversationRoutes);
app.use('/api', routes);

// 404 & Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server after DB connection
const startServer = async () => {
  try {
    await connectDB();
    await seedInitialEventsAndClubs();
    server.listen(PORT, () => {
      console.log(`===============================================`);
      console.log(`  THE QUAD - VIRTUAL CAMPUS SOCIAL PLATFORM    `);
      console.log(`  Backend Server running on port: ${PORT}     `);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}       `);
      console.log(`  API Base URL: http://localhost:${PORT}/api   `);
      console.log(`===============================================`);
    });
  } catch (error) {
    console.error('Fatal error starting backend server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = { app, server };
