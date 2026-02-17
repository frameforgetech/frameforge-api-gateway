# Cache Invalidation Guide

## Overview

The API Gateway implements Redis caching for job status queries to reduce database load. When job data is updated, the cache must be invalidated to ensure users see fresh data.

## When to Invalidate Cache

Cache invalidation should be called whenever:
- A new job is created
- A job status changes (pending → processing → completed/failed)
- Any job data is updated (result URL, frame count, error message, etc.)

## How to Use

### In API Gateway

The cache invalidation is already integrated into the job creation endpoint. For any future endpoints that update jobs, import and call the function:

```typescript
import { invalidateJobCache } from '../cache';

// After updating a job
await invalidateJobCache(jobId, userId);
```

### In Video Processor (Future Implementation)

When the video processor updates job status, it should invalidate the cache. Here's how:

```typescript
// Import from the API Gateway package
import { invalidateJobCache } from '@frameforge/api-gateway';

// After updating job status to "processing"
await videoJobRepository.save(videoJob);
await invalidateJobCache(videoJob.jobId, videoJob.userId);

// After completing or failing a job
videoJob.status = JobStatus.COMPLETED;
videoJob.resultUrl = zipUrl;
videoJob.frameCount = frameCount;
videoJob.completedAt = new Date();
await videoJobRepository.save(videoJob);
await invalidateJobCache(videoJob.jobId, videoJob.userId);
```

## Functions Available

### `invalidateJobCache(jobId: string, userId: string)`

Invalidates both:
- Individual job detail cache (`job:{jobId}`)
- All job listing caches for the user (`jobs:{userId}:*`)

This is the primary function to use after any job update.

### `invalidateUserJobListingCache(userId: string)`

Invalidates only the job listing caches for a user. Use this when multiple jobs are affected or for user-level changes.

## Error Handling

Cache invalidation failures are logged but do not throw errors. This ensures that cache issues don't break the application flow. The system will continue to work, just with potentially stale cache data until the TTL expires (30 seconds).

## Cache Keys

The following cache key patterns are used:

- **Job Detail**: `job:{jobId}`
  - TTL: 30 seconds
  - Contains: Full job details including status, URLs, timestamps

- **Job Listings**: `jobs:{userId}:page:{page}:limit:{limit}:status:{status}`
  - TTL: 30 seconds
  - Contains: Paginated list of jobs with filters

## Testing

Unit tests are available in `cache.test.ts` that verify:
- Cache invalidation works correctly
- SCAN iteration handles multiple pages
- Errors are handled gracefully
- Redis unavailability doesn't break the application
