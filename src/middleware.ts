// Express middleware for API Gateway

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { createClient, RedisClientType } from 'redis';
import { ErrorResponse } from './types';

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
const RATE_LIMIT_WINDOW = 60; // 60 seconds

let redisClient: RedisClientType | null = null;

// Initialize Redis client
export async function initializeRedis(): Promise<void> {
  if (!redisClient) {
    redisClient = createClient({ 
      url: REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          // In test environment, don't retry
          if (process.env.NODE_ENV === 'test') {
            return false;
          }
          // In production, retry with exponential backoff up to 10 times
          if (retries > 10) {
            return new Error('Max retries reached');
          }
          return Math.min(retries * 100, 3000);
        },
      },
    });
    
    redisClient.on('error', (err) => {
      // Only log in non-test environments to avoid test pollution
      if (process.env.NODE_ENV !== 'test') {
        console.error('Redis Client Error:', err);
      }
    });

    try {
      await redisClient.connect();
      console.log('Redis client connected');
    } catch (error) {
      // In test environment, silently fail and continue without Redis
      if (process.env.NODE_ENV === 'test') {
        console.warn('Redis not available in test environment, continuing without cache');
        redisClient = null;
      } else {
        throw error;
      }
    }
  }
}

// Get Redis client (for testing)
export function getRedisClient(): RedisClientType | null {
  return redisClient;
}

// Close Redis connection
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

// Add requestId to all requests for traceability
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = uuidv4();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

// JWT authentication middleware - validates tokens via Auth Service
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const errorResponse: ErrorResponse = {
        error: {
          code: 'MISSING_TOKEN',
          message: 'Authorization token is required',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(401).json(errorResponse);
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Validate token with Auth Service
    try {
      const response = await axios.post<{
        valid: boolean;
        userId?: string;
        username?: string;
      }>(
        `${AUTH_SERVICE_URL}/api/v1/auth/validate`,
        { token },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 5000, // 5 second timeout
        }
      );

      if (response.data.valid) {
        // Attach user information to request
        req.user = {
          userId: response.data.userId!,
          username: response.data.username!,
        };
        next();
      } else {
        // Token is invalid or expired
        const errorResponse: ErrorResponse = {
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid or expired token',
            requestId: req.requestId,
            timestamp: new Date().toISOString(),
          },
        };
        res.status(401).json(errorResponse);
      }
    } catch (error) {
      // Auth service communication error
      console.error('Auth service error:', error);
      const errorResponse: ErrorResponse = {
        error: {
          code: 'AUTH_SERVICE_ERROR',
          message: 'Unable to validate token',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      };
      res.status(503).json(errorResponse);
    }
  } catch (error) {
    next(error);
  }
}

// Rate limiting middleware - limits requests per user per minute
export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Rate limiting requires authenticated user
    if (!req.user) {
      next();
      return;
    }

    // If Redis is not available, skip rate limiting (graceful degradation)
    if (!redisClient || !redisClient.isOpen) {
      console.warn('Redis not available, skipping rate limiting');
      next();
      return;
    }

    const userId = req.user.userId;
    const currentMinute = Math.floor(Date.now() / 1000 / 60); // Current minute timestamp
    const key = `ratelimit:${userId}:${currentMinute}`;

    try {
      // Increment request count
      const count = await redisClient.incr(key);

      // Set expiration on first request in this minute
      if (count === 1) {
        await redisClient.expire(key, RATE_LIMIT_WINDOW);
      }

      // Check if limit exceeded
      if (count > RATE_LIMIT_MAX) {
        const errorResponse: ErrorResponse = {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later',
            requestId: req.requestId,
            timestamp: new Date().toISOString(),
          },
        };

        // Add Retry-After header (seconds until next minute)
        const secondsUntilNextMinute = 60 - (Math.floor(Date.now() / 1000) % 60);
        res.setHeader('Retry-After', secondsUntilNextMinute.toString());
        res.status(429).json(errorResponse);
        return;
      }

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX - count).toString());
      res.setHeader('X-RateLimit-Reset', ((currentMinute + 1) * 60).toString());

      next();
    } catch (redisError) {
      // Redis operation failed, log and continue (graceful degradation)
      console.error('Redis rate limit error:', redisError);
      next();
    }
  } catch (error) {
    next(error);
  }
}

// Global error handling middleware with consistent format
export function errorHandlerMiddleware(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error:', err);

  // Default to 500 if no status code is set
  const statusCode = err.statusCode || 500;

  const errorResponse: ErrorResponse = {
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred',
      details: err.details,
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
    },
  };

  res.status(statusCode).json(errorResponse);
}
