import { Router, Request, Response } from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, getRedisClient } from '../middleware';
import { AppDataSource } from '../database';
import { VideoJob, JobStatus } from '@frameforge/shared-contracts';
import { publishToQueue } from '../queue';
import { invalidateJobCache } from '../cache';

const router = Router();

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

// Supported video formats
const SUPPORTED_FORMATS = ['video/mp4', 'video/avi', 'video/quicktime', 'video/x-matroska', 'video/webm'];
const SUPPORTED_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB in bytes
const PRESIGNED_URL_EXPIRATION = 15 * 60; // 15 minutes in seconds

interface UploadUrlRequest {
  filename: string;
  contentType: string;
  fileSize: number;
}

interface UploadUrlResponse {
  uploadUrl: string;
  videoId: string;
  expiresIn: number;
}

interface CreateJobRequest {
  videoId: string;
  filename: string;
}

interface CreateJobResponse {
  jobId: string;
  status: JobStatus;
  createdAt: string;
}

interface VideoProcessingMessage {
  jobId: string;
  userId: string;
  videoUrl: string;
  filename: string;
  timestamp: string;
}

interface JobSummary {
  jobId: string;
  filename: string;
  status: JobStatus;
  createdAt: string;
  completedAt?: string;
  downloadUrl?: string;
}

interface ListJobsResponse {
  jobs: JobSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface JobDetailResponse {
  jobId: string;
  userId: string;
  filename: string;
  status: JobStatus;
  videoUrl: string;
  resultUrl?: string;
  frameCount?: number;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

const CACHE_TTL = 30; // 30 seconds
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// POST /api/v1/videos/upload-url
router.post('/upload-url', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { filename, contentType, fileSize } = req.body as UploadUrlRequest;

    // Validate required fields
    if (!filename || !contentType || fileSize === undefined) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required fields',
          details: {
            filename: !filename ? 'Filename is required' : undefined,
            contentType: !contentType ? 'Content type is required' : undefined,
            fileSize: fileSize === undefined ? 'File size is required' : undefined,
          },
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Validate file size
    if (fileSize > MAX_FILE_SIZE) {
      res.status(400).json({
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'File size exceeds maximum allowed size',
          details: {
            maxSize: MAX_FILE_SIZE,
            providedSize: fileSize,
          },
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Validate content type
    if (!SUPPORTED_FORMATS.includes(contentType.toLowerCase())) {
      res.status(400).json({
        error: {
          code: 'UNSUPPORTED_FORMAT',
          message: 'Unsupported video format',
          details: {
            supportedFormats: SUPPORTED_FORMATS,
            providedFormat: contentType,
          },
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Validate file extension
    const fileExtension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    if (!SUPPORTED_EXTENSIONS.includes(fileExtension)) {
      res.status(400).json({
        error: {
          code: 'UNSUPPORTED_FORMAT',
          message: 'Unsupported video file extension',
          details: {
            supportedExtensions: SUPPORTED_EXTENSIONS,
            providedExtension: fileExtension,
          },
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Generate unique video ID
    const videoId = uuidv4();
    const userId = req.user!.userId;

    // Construct S3 key
    const s3Key = `${userId}/${videoId}/${filename}`;
    const bucket = process.env.S3_VIDEOS_BUCKET || 'frameforge-videos';

    // Create S3 PutObject command
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      ContentType: contentType,
    });

    // Generate pre-signed URL
    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRATION,
    });

    // Return response
    const response: UploadUrlResponse = {
      uploadUrl,
      videoId,
      expiresIn: PRESIGNED_URL_EXPIRATION,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to generate upload URL',
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// POST /api/v1/videos/jobs
router.post('/jobs', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { videoId, filename } = req.body as CreateJobRequest;

    // Validate required fields
    if (!videoId || !filename) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required fields',
          details: {
            videoId: !videoId ? 'Video ID is required' : undefined,
            filename: !filename ? 'Filename is required' : undefined,
          },
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const userId = req.user!.userId;
    const bucket = process.env.S3_VIDEOS_BUCKET || 'frameforge-videos';
    
    // Construct S3 URL for the uploaded video
    const s3Key = `${userId}/${videoId}/${filename}`;
    const videoUrl = `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${s3Key}`;

    // Create VideoJob record with status "pending"
    const videoJobRepository = AppDataSource.getRepository(VideoJob);
    const videoJob = videoJobRepository.create({
      userId,
      filename,
      status: JobStatus.PENDING,
      videoUrl,
    });

    await videoJobRepository.save(videoJob);

    // Invalidate cache for user's job listings since a new job was created
    await invalidateJobCache(videoJob.jobId, userId);

    // Publish message to video.processing queue
    const message: VideoProcessingMessage = {
      jobId: videoJob.jobId,
      userId,
      videoUrl,
      filename,
      timestamp: new Date().toISOString(),
    };

    await publishToQueue('video.processing', message);

    // Return job details to client
    const response: CreateJobResponse = {
      jobId: videoJob.jobId,
      status: videoJob.status,
      createdAt: videoJob.createdAt.toISOString(),
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating video job:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create video job',
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// GET /api/v1/videos/jobs - List jobs with pagination and filtering
router.get('/jobs', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    
    // Parse query parameters
    const page = Math.max(1, parseInt(req.query.page as string) || DEFAULT_PAGE);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit as string) || DEFAULT_LIMIT));
    const statusFilter = req.query.status as string | undefined;

    // Validate status filter if provided
    if (statusFilter && !Object.values(JobStatus).includes(statusFilter as JobStatus)) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid status filter',
          details: {
            status: `Status must be one of: ${Object.values(JobStatus).join(', ')}`,
          },
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Create cache key
    const cacheKey = `jobs:${userId}:page:${page}:limit:${limit}:status:${statusFilter || 'all'}`;
    
    // Try to get from cache
    const redisClient = getRedisClient();
    if (redisClient && redisClient.isOpen) {
      try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          const response: ListJobsResponse = JSON.parse(cachedData);
          res.status(200).json(response);
          return;
        }
      } catch (cacheError) {
        console.warn('Cache read error:', cacheError);
        // Continue to database query on cache error
      }
    }

    // Query database
    const videoJobRepository = AppDataSource.getRepository(VideoJob);
    
    // Build query
    const queryBuilder = videoJobRepository
      .createQueryBuilder('job')
      .where('job.userId = :userId', { userId })
      .orderBy('job.createdAt', 'DESC');

    // Apply status filter if provided
    if (statusFilter) {
      queryBuilder.andWhere('job.status = :status', { status: statusFilter });
    }

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    // Execute query
    const jobs = await queryBuilder.getMany();

    // Map to response format
    const jobSummaries: JobSummary[] = jobs.map((job) => ({
      jobId: job.jobId,
      filename: job.filename,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString(),
      downloadUrl: job.resultUrl,
    }));

    // Calculate pagination info
    const totalPages = Math.ceil(total / limit);

    const response: ListJobsResponse = {
      jobs: jobSummaries,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };

    // Cache the response
    if (redisClient && redisClient.isOpen) {
      try {
        await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
      } catch (cacheError) {
        console.warn('Cache write error:', cacheError);
        // Continue without caching
      }
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Error listing video jobs:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to list video jobs',
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

// GET /api/v1/videos/jobs/:id - Get job details
router.get('/jobs/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const jobId = req.params.id;
    const userId = req.user!.userId;

    // Validate job ID format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(jobId)) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid job ID format',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Create cache key
    const cacheKey = `job:${jobId}`;

    // Try to get from cache
    const redisClient = getRedisClient();
    if (redisClient && redisClient.isOpen) {
      try {
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          const cachedJob: JobDetailResponse = JSON.parse(cachedData);
          
          // Verify job belongs to authenticated user
          if (cachedJob.userId !== userId) {
            res.status(403).json({
              error: {
                code: 'FORBIDDEN',
                message: 'You do not have permission to access this job',
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
              },
            });
            return;
          }
          
          res.status(200).json(cachedJob);
          return;
        }
      } catch (cacheError) {
        console.warn('Cache read error:', cacheError);
        // Continue to database query on cache error
      }
    }

    // Query database
    const videoJobRepository = AppDataSource.getRepository(VideoJob);
    const job = await videoJobRepository.findOne({
      where: { jobId },
    });

    // Check if job exists
    if (!job) {
      res.status(404).json({
        error: {
          code: 'JOB_NOT_FOUND',
          message: 'Job not found',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Verify job belongs to authenticated user
    if (job.userId !== userId) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to access this job',
          requestId: req.requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // Map to response format
    const response: JobDetailResponse = {
      jobId: job.jobId,
      userId: job.userId,
      filename: job.filename,
      status: job.status,
      videoUrl: job.videoUrl,
      createdAt: job.createdAt.toISOString(),
      ...(job.resultUrl && { resultUrl: job.resultUrl }),
      ...(job.frameCount !== null && job.frameCount !== undefined && { frameCount: job.frameCount }),
      ...(job.errorMessage && { errorMessage: job.errorMessage }),
      ...(job.startedAt && { startedAt: job.startedAt.toISOString() }),
      ...(job.completedAt && { completedAt: job.completedAt.toISOString() }),
    };

    // Cache the response
    if (redisClient && redisClient.isOpen) {
      try {
        await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(response));
      } catch (cacheError) {
        console.warn('Cache write error:', cacheError);
        // Continue without caching
      }
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Error getting video job details:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get video job details',
        requestId: req.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

export default router;
