import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { requestIdMiddleware, errorHandlerMiddleware, initializeRedis } from './middleware';
import { initializeDatabase } from './database';
import { initializeRabbitMQ } from './queue';
import { metricsHandler, metricsMiddleware } from './metrics';
import { swaggerSpec } from './swagger';
import videoRoutes from './routes/videos';
import authRoutes from './routes/auth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - order matters!
app.use(requestIdMiddleware); // Add request ID first
app.use(metricsMiddleware); // Track HTTP metrics
app.use(cors()); // Enable CORS
app.use(express.json()); // Parse JSON bodies

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

// Metrics endpoint
app.get('/metrics', metricsHandler);

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'FrameForge API Documentation',
}));

// Swagger JSON endpoint
app.get('/api-docs.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// API routes
app.use('/api/v1/auth', authRoutes);
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
