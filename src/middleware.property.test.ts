// Feature: frameforge-video-processing-system
// Property-based tests for API Gateway middleware
//
// NOTE: These tests require Redis to be running on localhost:6379
// To run Redis: docker run -d -p 6379:6379 redis:alpine
// Or skip these tests if Redis is not available

import fc from 'fast-check';
import { Request } from 'express';
import { rateLimitMiddleware, initializeRedis, closeRedis, getRedisClient } from './middleware';

// Mock Express Request and Response
function createMockRequest(userId: string): Partial<Request> {
  return {
    requestId: 'test-request-id',
    user: {
      userId,
      username: 'testuser',
    },
  };
}

function createMockResponse(): any {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    jsonData: null,
    setHeader: jest.fn((key: string, value: string) => {
      res.headers[key] = value;
    }),
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((data: any) => {
      res.jsonData = data;
      return res;
    }),
  };
  return res;
}

describe('Rate Limiting Property Tests', () => {
  let redisAvailable = false;

  beforeAll(async () => {
    // Set environment variables
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    process.env.RATE_LIMIT_MAX = '100';
    
    try {
      await initializeRedis();
      const client = getRedisClient();
      redisAvailable = client !== null && client.isOpen;
      
      if (!redisAvailable) {
        console.warn('⚠️  Redis is not available. Rate limiting tests will be skipped.');
        console.warn('   To run these tests, start Redis: docker run -d -p 6379:6379 redis:alpine');
      }
    } catch (error) {
      console.warn('⚠️  Failed to connect to Redis. Rate limiting tests will be skipped.');
      redisAvailable = false;
    }
  }, 30000);

  afterAll(async () => {
    if (redisAvailable) {
      await closeRedis();
    }
  });

  beforeEach(async () => {
    if (redisAvailable) {
      // Clear Redis before each test
      const client = getRedisClient();
      if (client) {
        await client.flushDb();
      }
    }
  });

  /**
   * Property 31: Rate limiting prevents abuse
   * 
   * For any user making more than 100 requests per minute, subsequent requests
   * must be rejected with HTTP 429 status until the rate window resets.
   * 
   * Validates: Requirements 6.5, 6.6
   */
  test('Property 31: Rate limiting prevents abuse', async () => {
    if (!redisAvailable) {
      console.log('⏭️  Skipping test - Redis not available');
      return;
    }

    await fc.assert(
      fc.asyncProperty(
        // Generate a random user ID
        fc.uuid(),
        // Generate a number of requests (between 1 and 150)
        fc.integer({ min: 1, max: 150 }),
        async (userId, requestCount) => {
          // Abort if Redis was closed (e.g. afterAll ran mid-iteration)
          const client = getRedisClient();
          if (!client || !client.isOpen) return;

          const RATE_LIMIT_MAX = 100;
          let rejectedCount = 0;
          let acceptedCount = 0;
          let lastResponse: any = null;

          // Make the specified number of requests
          for (let i = 0; i < requestCount; i++) {
            const req = createMockRequest(userId) as Request;
            const res = createMockResponse();
            let nextCalled = false;

            const next = () => {
              nextCalled = true;
            };

            await rateLimitMiddleware(req, res, next);

            if (res.statusCode === 429) {
              rejectedCount++;
              lastResponse = res;
              
              // Verify error response format (Requirement 6.6)
              expect(res.jsonData).toBeDefined();
              expect(res.jsonData.error).toBeDefined();
              expect(res.jsonData.error.code).toBe('RATE_LIMIT_EXCEEDED');
              expect(res.jsonData.error.message).toBeTruthy();
              expect(res.jsonData.error.requestId).toBe('test-request-id');
              
              // Verify Retry-After header is present (Requirement 6.6)
              expect(res.headers['Retry-After']).toBeDefined();
              const retryAfter = parseInt(res.headers['Retry-After'], 10);
              expect(retryAfter).toBeGreaterThan(0);
              expect(retryAfter).toBeLessThanOrEqual(60);
            } else if (nextCalled) {
              acceptedCount++;
              
              // Verify rate limit headers are present
              expect(res.headers['X-RateLimit-Limit']).toBe(RATE_LIMIT_MAX.toString());
              expect(res.headers['X-RateLimit-Remaining']).toBeDefined();
              expect(res.headers['X-RateLimit-Reset']).toBeDefined();
            }
          }

          // Property assertions
          if (requestCount <= RATE_LIMIT_MAX) {
            // All requests should be accepted if under limit
            expect(acceptedCount).toBe(requestCount);
            expect(rejectedCount).toBe(0);
          } else {
            // Exactly RATE_LIMIT_MAX requests should be accepted
            expect(acceptedCount).toBe(RATE_LIMIT_MAX);
            // Remaining requests should be rejected
            expect(rejectedCount).toBe(requestCount - RATE_LIMIT_MAX);
          }

          // Verify that once limit is exceeded, ALL subsequent requests are rejected
          if (requestCount > RATE_LIMIT_MAX) {
            expect(lastResponse).toBeDefined();
            expect(lastResponse.statusCode).toBe(429);
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 60000);

  /**
   * Property 31.1: Rate limiting is per-user
   * 
   * Different users should have independent rate limits.
   */
  test('Property 31.1: Rate limiting is per-user', async () => {
    if (!redisAvailable) {
      console.log('⏭️  Skipping test - Redis not available');
      return;
    }

    await fc.assert(
      fc.asyncProperty(
        // Generate 2-5 different user IDs
        fc.array(fc.uuid(), { minLength: 2, maxLength: 5 }),
        // Each user makes 50-120 requests
        fc.integer({ min: 50, max: 120 }),
        async (userIds, requestsPerUser) => {
          // Reset Redis state between property runs to avoid counter accumulation
          // across fast-check iterations (especially during shrinking)
          const client = getRedisClient();
          if (!client || !client.isOpen) return; // Redis closed (e.g. afterAll ran) — abort silently
          await client.flushDb();

          const RATE_LIMIT_MAX = 100;
          const uniqueUsers = [...new Set(userIds)]; // Remove duplicates

          // Track results per user
          const userResults = new Map<string, { accepted: number; rejected: number }>();

          for (const userId of uniqueUsers) {
            let accepted = 0;
            let rejected = 0;

            for (let i = 0; i < requestsPerUser; i++) {
              const req = createMockRequest(userId) as Request;
              const res = createMockResponse();
              let nextCalled = false;

              const next = () => {
                nextCalled = true;
              };

              await rateLimitMiddleware(req, res, next);

              if (res.statusCode === 429) {
                rejected++;
              } else if (nextCalled) {
                accepted++;
              }
            }

            userResults.set(userId, { accepted, rejected });
          }

          // Each user should have independent rate limiting
          for (const [_userId, results] of userResults.entries()) {
            if (requestsPerUser <= RATE_LIMIT_MAX) {
              expect(results.accepted).toBe(requestsPerUser);
              expect(results.rejected).toBe(0);
            } else {
              expect(results.accepted).toBe(RATE_LIMIT_MAX);
              expect(results.rejected).toBe(requestsPerUser - RATE_LIMIT_MAX);
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  }, 120000);

  /**
   * Property 31.2: Rate limit resets after time window
   * 
   * After the rate limit window expires, users should be able to make requests again.
   */
  test('Property 31.2: Rate limit resets after time window', async () => {
    if (!redisAvailable) {
      console.log('⏭️  Skipping test - Redis not available');
      return;
    }

    const userId = 'test-user-reset';
    const RATE_LIMIT_MAX = 100;

    // Make exactly RATE_LIMIT_MAX requests
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const req = createMockRequest(userId) as Request;
      const res = createMockResponse();
      let nextCalled = false;

      const next = () => {
        nextCalled = true;
      };

      await rateLimitMiddleware(req, res, next);
      expect(nextCalled).toBe(true);
      expect(res.statusCode).not.toBe(429);
    }

    // Next request should be rejected
    const req1 = createMockRequest(userId) as Request;
    const res1 = createMockResponse();
    let next1Called = false;

    await rateLimitMiddleware(req1, res1, () => {
      next1Called = true;
    });

    expect(next1Called).toBe(false);
    expect(res1.statusCode).toBe(429);

    // Simulate rate limit window expiring by clearing the key
    const client = getRedisClient();
    if (client) {
      const currentMinute = Math.floor(Date.now() / 1000 / 60);
      const key = `ratelimit:${userId}:${currentMinute}`;
      await client.del(key);
    }

    // After reset, requests should be accepted again
    const req2 = createMockRequest(userId) as Request;
    const res2 = createMockResponse();
    let next2Called = false;

    await rateLimitMiddleware(req2, res2, () => {
      next2Called = true;
    });

    expect(next2Called).toBe(true);
    expect(res2.statusCode).not.toBe(429);
  }, 30000);

  /**
   * Property 31.3: Unauthenticated requests bypass rate limiting
   * 
   * Requests without user information should not be rate limited.
   */
  test('Property 31.3: Unauthenticated requests bypass rate limiting', async () => {
    // This test doesn't require Redis since unauthenticated requests bypass rate limiting
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 200 }),
        async (requestCount) => {
          let nextCalledCount = 0;

          for (let i = 0; i < requestCount; i++) {
            const req: Partial<Request> = {
              requestId: 'test-request-id',
              // No user property - unauthenticated
            };
            const res = createMockResponse();

            await rateLimitMiddleware(req as Request, res, () => {
              nextCalledCount++;
            });

            // Should never return 429 for unauthenticated requests
            expect(res.statusCode).not.toBe(429);
          }

          // All requests should pass through
          expect(nextCalledCount).toBe(requestCount);
        }
      ),
      { numRuns: 50 }
    );
  }, 30000);
});
