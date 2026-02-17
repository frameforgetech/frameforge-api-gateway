import { invalidateJobCache, invalidateUserJobListingCache } from './cache';
import { getRedisClient } from './middleware';

// Mock the middleware module
jest.mock('./middleware');

describe('Cache Invalidation', () => {
  let mockRedisClient: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock Redis client
    mockRedisClient = {
      isOpen: true,
      del: jest.fn().mockResolvedValue(1),
      scan: jest.fn(),
    };

    (getRedisClient as jest.Mock).mockReturnValue(mockRedisClient);
  });

  describe('invalidateJobCache', () => {
    it('should invalidate individual job cache and user job listings', async () => {
      const jobId = '123e4567-e89b-12d3-a456-426614174000';
      const userId = 'user-123';

      // Mock SCAN to return some matching keys
      mockRedisClient.scan
        .mockResolvedValueOnce({
          cursor: 1,
          keys: ['jobs:user-123:page:1:limit:20:status:all'],
        })
        .mockResolvedValueOnce({
          cursor: 0,
          keys: ['jobs:user-123:page:2:limit:20:status:all'],
        });

      await invalidateJobCache(jobId, userId);

      // Should delete individual job cache
      expect(mockRedisClient.del).toHaveBeenCalledWith(`job:${jobId}`);

      // Should delete all matching job listing keys
      expect(mockRedisClient.del).toHaveBeenCalledWith([
        'jobs:user-123:page:1:limit:20:status:all',
        'jobs:user-123:page:2:limit:20:status:all',
      ]);

      // Should call SCAN with correct pattern
      expect(mockRedisClient.scan).toHaveBeenCalledWith(0, {
        MATCH: `jobs:${userId}:*`,
        COUNT: 100,
      });
    });

    it('should handle case when no job listing keys exist', async () => {
      const jobId = '123e4567-e89b-12d3-a456-426614174000';
      const userId = 'user-123';

      // Mock SCAN to return no keys
      mockRedisClient.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: [],
      });

      await invalidateJobCache(jobId, userId);

      // Should still delete individual job cache
      expect(mockRedisClient.del).toHaveBeenCalledWith(`job:${jobId}`);

      // Should not call del with empty array
      expect(mockRedisClient.del).toHaveBeenCalledTimes(1);
    });

    it('should handle Redis client not available', async () => {
      (getRedisClient as jest.Mock).mockReturnValue(null);

      const jobId = '123e4567-e89b-12d3-a456-426614174000';
      const userId = 'user-123';

      // Should not throw error
      await expect(invalidateJobCache(jobId, userId)).resolves.not.toThrow();

      // Should not attempt any operations
      expect(mockRedisClient.del).not.toHaveBeenCalled();
      expect(mockRedisClient.scan).not.toHaveBeenCalled();
    });

    it('should handle Redis client not open', async () => {
      mockRedisClient.isOpen = false;

      const jobId = '123e4567-e89b-12d3-a456-426614174000';
      const userId = 'user-123';

      // Should not throw error
      await expect(invalidateJobCache(jobId, userId)).resolves.not.toThrow();

      // Should not attempt any operations
      expect(mockRedisClient.del).not.toHaveBeenCalled();
      expect(mockRedisClient.scan).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      const jobId = '123e4567-e89b-12d3-a456-426614174000';
      const userId = 'user-123';

      // Mock del to throw error
      mockRedisClient.del.mockRejectedValueOnce(new Error('Redis connection failed'));

      // Should not throw error
      await expect(invalidateJobCache(jobId, userId)).resolves.not.toThrow();
    });

    it('should handle SCAN errors gracefully', async () => {
      const jobId = '123e4567-e89b-12d3-a456-426614174000';
      const userId = 'user-123';

      // Mock SCAN to throw error
      mockRedisClient.scan.mockRejectedValueOnce(new Error('Redis SCAN failed'));

      // Should not throw error
      await expect(invalidateJobCache(jobId, userId)).resolves.not.toThrow();
    });

    it('should iterate through all SCAN cursors', async () => {
      const jobId = '123e4567-e89b-12d3-a456-426614174000';
      const userId = 'user-123';

      // Mock SCAN to return multiple pages
      mockRedisClient.scan
        .mockResolvedValueOnce({
          cursor: 1,
          keys: ['jobs:user-123:page:1:limit:20:status:all'],
        })
        .mockResolvedValueOnce({
          cursor: 2,
          keys: ['jobs:user-123:page:2:limit:20:status:all'],
        })
        .mockResolvedValueOnce({
          cursor: 0,
          keys: ['jobs:user-123:page:3:limit:20:status:all'],
        });

      await invalidateJobCache(jobId, userId);

      // Should call SCAN three times
      expect(mockRedisClient.scan).toHaveBeenCalledTimes(3);

      // Should delete all found keys
      expect(mockRedisClient.del).toHaveBeenCalledWith([
        'jobs:user-123:page:1:limit:20:status:all',
        'jobs:user-123:page:2:limit:20:status:all',
        'jobs:user-123:page:3:limit:20:status:all',
      ]);
    });
  });

  describe('invalidateUserJobListingCache', () => {
    it('should invalidate all job listing caches for a user', async () => {
      const userId = 'user-123';

      // Mock SCAN to return some matching keys
      mockRedisClient.scan
        .mockResolvedValueOnce({
          cursor: 1,
          keys: ['jobs:user-123:page:1:limit:20:status:all'],
        })
        .mockResolvedValueOnce({
          cursor: 0,
          keys: ['jobs:user-123:page:2:limit:20:status:completed'],
        });

      await invalidateUserJobListingCache(userId);

      // Should delete all matching keys
      expect(mockRedisClient.del).toHaveBeenCalledWith([
        'jobs:user-123:page:1:limit:20:status:all',
        'jobs:user-123:page:2:limit:20:status:completed',
      ]);

      // Should call SCAN with correct pattern
      expect(mockRedisClient.scan).toHaveBeenCalledWith(0, {
        MATCH: `jobs:${userId}:*`,
        COUNT: 100,
      });
    });

    it('should handle case when no keys exist', async () => {
      const userId = 'user-123';

      // Mock SCAN to return no keys
      mockRedisClient.scan.mockResolvedValueOnce({
        cursor: 0,
        keys: [],
      });

      await invalidateUserJobListingCache(userId);

      // Should not call del
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('should handle Redis client not available', async () => {
      (getRedisClient as jest.Mock).mockReturnValue(null);

      const userId = 'user-123';

      // Should not throw error
      await expect(invalidateUserJobListingCache(userId)).resolves.not.toThrow();

      // Should not attempt any operations
      expect(mockRedisClient.del).not.toHaveBeenCalled();
      expect(mockRedisClient.scan).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      const userId = 'user-123';

      // Mock SCAN to throw error
      mockRedisClient.scan.mockRejectedValueOnce(new Error('Redis connection failed'));

      // Should not throw error
      await expect(invalidateUserJobListingCache(userId)).resolves.not.toThrow();
    });
  });
});
