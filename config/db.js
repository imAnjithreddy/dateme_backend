const mongoose = require('mongoose');

let memoryServer = null;

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/the_quad';

  try {
    // Attempt standard MongoDB connection with 4s timeout
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000
    });
    console.log(`[MongoDB] Connected successfully to host: ${conn.connection.host}, database: ${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.warn(`[MongoDB] Primary connection failed (${error.message}).`);

    if (process.env.USE_MEMORY_DB_FALLBACK === 'true') {
      try {
        console.log('[MongoDB] Starting embedded MongoDB Memory Server for local development...');
        const { MongoMemoryServer } = require('mongodb-memory-server');
        memoryServer = await MongoMemoryServer.create();
        const memUri = memoryServer.getUri();
        const conn = await mongoose.connect(memUri);
        console.log(`[MongoDB] In-memory database connected at: ${memUri}`);
        return conn;
      } catch (memError) {
        console.error('[MongoDB] Failed to start MongoMemoryServer:', memError.message);
        throw memError;
      }
    } else {
      throw error;
    }
  }
};

const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
    }
    console.log('[MongoDB] Disconnected.');
  } catch (err) {
    console.error('[MongoDB] Error during disconnection:', err.message);
  }
};

module.exports = {
  connectDB,
  disconnectDB
};
