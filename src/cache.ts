import { getRedisClient } from './middleware';

/**
 * Invalidates all cache entries related to a specific job
 * This includes:
 * - Individual job detail cache (job:{jobId})
 * - All job listing caches for the user (jobs:{userId}:*)
 * 
 * Should be called whenever a job status or any job data is updated
 * 
 * @param jobId - The ID of the job that was updated
 * @param userId - The ID of the user who owns the job
 */
export async function invalidateJobCache(jobId: string, userId: string): Promise<void> {
  const redisClient = getRedisClient();
  
  if (!redisClient || !redisClient.isOpen) {
    console.warn('Redis client not available for cache invalidation');
    return;
  }

  try {
    // Invalidate individual job cache
    const jobCacheKey = `job:${jobId}`;
    await redisClient.del(jobCacheKey);

    // Invalidate all job listing caches for this user
    // Pattern: jobs:{userId}:page:*:limit:*:status:*
    const listingPattern = `jobs:${userId}:*`;
    
    // Use SCAN to find all matching keys (safer than KEYS for production)
    const keysToDelete: string[] = [];
    let cursor = 0;
    
    do {
      const result = await redisClient.scan(cursor, {
        MATCH: listingPattern,
        COUNT: 100,
      });
      
      cursor = result.cursor;
      keysToDelete.push(...result.keys);
    } while (cursor !== 0);

    // Delete all matching keys
    if (keysToDelete.length > 0) {
      await redisClient.del(keysToDelete);
      console.log(`Invalidated ${keysToDelete.length + 1} cache entries for job ${jobId}`);
    } else {
      console.log(`Invalidated 1 cache entry for job ${jobId}`);
    }
  } catch (error) {
    console.error('Error invalidating job cache:', error);
    // Don't throw - cache invalidation failure shouldn't break the application
  }
}

/**
 * Invalidates cache for a specific user's job listings
 * Useful when multiple jobs are affected or when user-level changes occur
 * 
 * @param userId - The ID of the user whose job listing cache should be invalidated
 */
export async function invalidateUserJobListingCache(userId: string): Promise<void> {
  const redisClient = getRedisClient();
  
  if (!redisClient || !redisClient.isOpen) {
    console.warn('Redis client not available for cache invalidation');
    return;
  }

  try {
    const listingPattern = `jobs:${userId}:*`;
    const keysToDelete: string[] = [];
    let cursor = 0;
    
    do {
      const result = await redisClient.scan(cursor, {
        MATCH: listingPattern,
        COUNT: 100,
      });
      
      cursor = result.cursor;
      keysToDelete.push(...result.keys);
    } while (cursor !== 0);

    if (keysToDelete.length > 0) {
      await redisClient.del(keysToDelete);
      console.log(`Invalidated ${keysToDelete.length} job listing cache entries for user ${userId}`);
    }
  } catch (error) {
    console.error('Error invalidating user job listing cache:', error);
    // Don't throw - cache invalidation failure shouldn't break the application
  }
}
