import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { requestIdMiddleware, errorHandlerMiddleware, initializeRedis } from './middleware';
import { initializeDatabase } from './database';
import { initializeRabbitMQ } from './queue';
import videoRoutes from './routes/videos';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - order matters!
app.use(requestIdMiddleware); // Add request ID first
app.use(cors()); // Enable CORS
app.use(express.json()); // Parse JSON bodies

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

// API routes
app.use('/api/v1/videos', videoRoutes);

// Error handling middleware must be last
app.use(errorHandlerMiddleware);

// Initialize Redis, Database, RabbitMQ and start server
async function startServer() {
  try {
    await initializeRedis();
    await initializeDatabase();
    await initializeRabbitMQ();
    
    if (process.env.NODE_ENV !== 'test') {
      app.listen(PORT, () => {
        console.log(`API Gateway listening on port ${PORT}`);
      });
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Only start server if not in test environment
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

// Export cache utilities for use by other services
export { invalidateJobCache, invalidateUserJobListingCache } from './cache';

export default app;
