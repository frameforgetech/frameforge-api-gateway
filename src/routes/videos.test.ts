import request from 'supertest';
import express from 'express';
import videoRoutes from './videos';
import { requestIdMiddleware } from '../middleware';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

// Mock axios for auth middleware
jest.mock('axios');

const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const axios = require('axios');

// Create test app
const app = express();
app.use(express.json());
app.use(requestIdMiddleware);

// Import auth middleware after mocking axios
const { authMiddleware } = require('../middleware');
app.use(authMiddleware);

app.use('/api/v1/videos', videoRoutes);

describe('POST /api/v1/videos/upload-url', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock getSignedUrl to return a test URL
    getSignedUrl.mockResolvedValue('https://s3.amazonaws.com/test-bucket/test-key?signature=test');
    
    // Mock axios auth validation to succeed
    axios.post.mockResolvedValue({
      data: {
        valid: true,
        userId: 'test-user-id',
        username: 'testuser',
      },
    });
  });

  it('should generate upload URL for valid request', async () => {
    const response = await request(app)
      .post('/api/v1/videos/upload-url')
      .set('Authorization', 'Bearer test-token')
      .send({
        filename: 'test-video.mp4',
        contentType: 'video/mp4',
        fileSize: 10 * 1024 * 1024, // 10MB
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('uploadUrl');
    expect(response.body).toHaveProperty('videoId');
    expect(response.body).toHaveProperty('expiresIn');
    expect(response.body.expiresIn).toBe(900); // 15 minutes
    expect(response.body.uploadUrl).toContain('s3.amazonaws.com');
  });

  it('should reject request with missing filename', async () => {
    const response = await request(app)
      .post('/api/v1/videos/upload-url')
      .set('Authorization', 'Bearer test-token')
      .send({
        contentType: 'video/mp4',
        fileSize: 10 * 1024 * 1024,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.filename).toBeDefined();
  });

  it('should reject request with missing contentType', async () => {
    const response = await request(app)
      .post('/api/v1/videos/upload-url')
      .set('Authorization', 'Bearer test-token')
      .send({
        filename: 'test-video.mp4',
        fileSize: 10 * 1024 * 1024,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.contentType).toBeDefined();
  });

  it('should reject request with missing fileSize', async () => {
    const response = await request(app)
      .post('/api/v1/videos/upload-url')
      .set('Authorization', 'Bearer test-token')
      .send({
        filename: 'test-video.mp4',
        contentType: 'video/mp4',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.fileSize).toBeDefined();
  });

  it('should reject file larger than 500MB', async () => {
    const response = await request(app)
      .post('/api/v1/videos/upload-url')
      .set('Authorization', 'Bearer test-token')
      .send({
        filename: 'large-video.mp4',
        contentType: 'video/mp4',
        fileSize: 600 * 1024 * 1024, // 600MB
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('FILE_TOO_LARGE');
    expect(response.body.error.details.maxSize).toBe(500 * 1024 * 1024);
  });

  it('should reject unsupported content type', async () => {
    const response = await request(app)
      .post('/api/v1/videos/upload-url')
      .set('Authorization', 'Bearer test-token')
      .send({
        filename: 'test-video.wmv',
        contentType: 'video/x-ms-wmv',
        fileSize: 10 * 1024 * 1024,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNSUPPORTED_FORMAT');
    expect(response.body.error.message).toContain('Unsupported video format');
  });

  it('should reject unsupported file extension', async () => {
    const response = await request(app)
      .post('/api/v1/videos/upload-url')
      .set('Authorization', 'Bearer test-token')
      .send({
        filename: 'test-video.wmv',
        contentType: 'video/mp4',
        fileSize: 10 * 1024 * 1024,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNSUPPORTED_FORMAT');
    expect(response.body.error.message).toContain('Unsupported video file extension');
  });

  it('should accept all supported video formats', async () => {
    const supportedFormats = [
      { filename: 'video.mp4', contentType: 'video/mp4' },
      { filename: 'video.avi', contentType: 'video/avi' },
      { filename: 'video.mov', contentType: 'video/quicktime' },
      { filename: 'video.mkv', contentType: 'video/x-matroska' },
      { filename: 'video.webm', contentType: 'video/webm' },
    ];

    for (const format of supportedFormats) {
      const response = await request(app)
        .post('/api/v1/videos/upload-url')
        .set('Authorization', 'Bearer test-token')
        .send({
          filename: format.filename,
          contentType: format.contentType,
          fileSize: 10 * 1024 * 1024,
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('uploadUrl');
      expect(response.body).toHaveProperty('videoId');
    }
  });

  it('should include requestId in error responses', async () => {
    const response = await request(app)
      .post('/api/v1/videos/upload-url')
      .set('Authorization', 'Bearer test-token')
      .send({
        filename: 'test-video.mp4',
        contentType: 'video/mp4',
        fileSize: 600 * 1024 * 1024, // Too large
      });

    expect(response.status).toBe(400);
    expect(response.body.error.requestId).toBeDefined();
    expect(response.body.error.timestamp).toBeDefined();
  });

  it('should handle S3 errors gracefully', async () => {
    getSignedUrl.mockRejectedValueOnce(new Error('S3 connection failed'));

    const response = await request(app)
      .post('/api/v1/videos/upload-url')
      .set('Authorization', 'Bearer test-token')
      .send({
        filename: 'test-video.mp4',
        contentType: 'video/mp4',
        fileSize: 10 * 1024 * 1024,
      });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).toContain('Failed to generate upload URL');
  });

  it('should reject request without authorization token', async () => {
    const response = await request(app)
      .post('/api/v1/videos/upload-url')
      .send({
        filename: 'test-video.mp4',
        contentType: 'video/mp4',
        fileSize: 10 * 1024 * 1024,
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('MISSING_TOKEN');
  });
});

describe('GET /api/v1/videos/jobs/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock axios auth validation to succeed
    axios.post.mockResolvedValue({
      data: {
        valid: true,
        userId: 'test-user-id',
        username: 'testuser',
      },
    });
  });

  it('should return job details for valid job ID', async () => {
    // Mock database to return a job
    const mockJob = {
      jobId: '123e4567-e89b-12d3-a456-426614174000',
      userId: 'test-user-id',
      filename: 'test-video.mp4',
      status: 'completed',
      videoUrl: 'https://s3.amazonaws.com/bucket/video.mp4',
      resultUrl: 'https://s3.amazonaws.com/bucket/result.zip',
      frameCount: 120,
      errorMessage: null,
      createdAt: new Date('2024-01-15T10:00:00Z'),
      startedAt: new Date('2024-01-15T10:01:00Z'),
      completedAt: new Date('2024-01-15T10:05:00Z'),
    };

    // Mock AppDataSource
    const mockRepository = {
      findOne: jest.fn().mockResolvedValue(mockJob),
    };
    
    const AppDataSource = require('../database').AppDataSource;
    AppDataSource.getRepository = jest.fn().mockReturnValue(mockRepository);

    const response = await request(app)
      .get('/api/v1/videos/jobs/123e4567-e89b-12d3-a456-426614174000')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.jobId).toBe(mockJob.jobId);
    expect(response.body.userId).toBe(mockJob.userId);
    expect(response.body.filename).toBe(mockJob.filename);
    expect(response.body.status).toBe(mockJob.status);
    expect(response.body.videoUrl).toBe(mockJob.videoUrl);
    expect(response.body.resultUrl).toBe(mockJob.resultUrl);
    expect(response.body.frameCount).toBe(mockJob.frameCount);
    expect(response.body.createdAt).toBe('2024-01-15T10:00:00.000Z');
    expect(response.body.startedAt).toBe('2024-01-15T10:01:00.000Z');
    expect(response.body.completedAt).toBe('2024-01-15T10:05:00.000Z');
  });

  it('should return 404 for non-existent job', async () => {
    // Mock database to return null
    const mockRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    
    const AppDataSource = require('../database').AppDataSource;
    AppDataSource.getRepository = jest.fn().mockReturnValue(mockRepository);

    const response = await request(app)
      .get('/api/v1/videos/jobs/123e4567-e89b-12d3-a456-426614174000')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('JOB_NOT_FOUND');
    expect(response.body.error.message).toBe('Job not found');
  });

  it('should return 403 when accessing another user\'s job', async () => {
    // Mock database to return a job belonging to a different user
    const mockJob = {
      jobId: '123e4567-e89b-12d3-a456-426614174000',
      userId: 'different-user-id',
      filename: 'test-video.mp4',
      status: 'completed',
      videoUrl: 'https://s3.amazonaws.com/bucket/video.mp4',
      resultUrl: 'https://s3.amazonaws.com/bucket/result.zip',
      frameCount: 120,
      errorMessage: null,
      createdAt: new Date('2024-01-15T10:00:00Z'),
      startedAt: new Date('2024-01-15T10:01:00Z'),
      completedAt: new Date('2024-01-15T10:05:00Z'),
    };

    const mockRepository = {
      findOne: jest.fn().mockResolvedValue(mockJob),
    };
    
    const AppDataSource = require('../database').AppDataSource;
    AppDataSource.getRepository = jest.fn().mockReturnValue(mockRepository);

    const response = await request(app)
      .get('/api/v1/videos/jobs/123e4567-e89b-12d3-a456-426614174000')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toBe('You do not have permission to access this job');
  });

  it('should return 400 for invalid job ID format', async () => {
    const response = await request(app)
      .get('/api/v1/videos/jobs/invalid-job-id')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Invalid job ID format');
  });

  it('should include requestId in responses', async () => {
    const response = await request(app)
      .get('/api/v1/videos/jobs/invalid-job-id')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(400);
    expect(response.body.error.requestId).toBeDefined();
    expect(response.body.error.timestamp).toBeDefined();
  });

  it('should handle database errors gracefully', async () => {
    // Mock database to throw an error
    const mockRepository = {
      findOne: jest.fn().mockRejectedValue(new Error('Database connection failed')),
    };
    
    const AppDataSource = require('../database').AppDataSource;
    AppDataSource.getRepository = jest.fn().mockReturnValue(mockRepository);

    const response = await request(app)
      .get('/api/v1/videos/jobs/123e4567-e89b-12d3-a456-426614174000')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).toBe('Failed to get video job details');
  });

  it('should reject request without authorization token', async () => {
    const response = await request(app)
      .get('/api/v1/videos/jobs/123e4567-e89b-12d3-a456-426614174000');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('MISSING_TOKEN');
  });

  it('should return job with pending status', async () => {
    const mockJob = {
      jobId: '123e4567-e89b-12d3-a456-426614174000',
      userId: 'test-user-id',
      filename: 'test-video.mp4',
      status: 'pending',
      videoUrl: 'https://s3.amazonaws.com/bucket/video.mp4',
      resultUrl: null,
      frameCount: null,
      errorMessage: null,
      createdAt: new Date('2024-01-15T10:00:00Z'),
      startedAt: null,
      completedAt: null,
    };

    const mockRepository = {
      findOne: jest.fn().mockResolvedValue(mockJob),
    };
    
    const AppDataSource = require('../database').AppDataSource;
    AppDataSource.getRepository = jest.fn().mockReturnValue(mockRepository);

    const response = await request(app)
      .get('/api/v1/videos/jobs/123e4567-e89b-12d3-a456-426614174000')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('pending');
    expect(response.body.resultUrl).toBeUndefined();
    expect(response.body.frameCount).toBeUndefined();
    expect(response.body.startedAt).toBeUndefined();
    expect(response.body.completedAt).toBeUndefined();
  });

  it('should return job with failed status and error message', async () => {
    const mockJob = {
      jobId: '123e4567-e89b-12d3-a456-426614174000',
      userId: 'test-user-id',
      filename: 'test-video.mp4',
      status: 'failed',
      videoUrl: 'https://s3.amazonaws.com/bucket/video.mp4',
      resultUrl: null,
      frameCount: null,
      errorMessage: 'Video file is corrupted',
      createdAt: new Date('2024-01-15T10:00:00Z'),
      startedAt: new Date('2024-01-15T10:01:00Z'),
      completedAt: new Date('2024-01-15T10:02:00Z'),
    };

    const mockRepository = {
      findOne: jest.fn().mockResolvedValue(mockJob),
    };
    
    const AppDataSource = require('../database').AppDataSource;
    AppDataSource.getRepository = jest.fn().mockReturnValue(mockRepository);

    const response = await request(app)
      .get('/api/v1/videos/jobs/123e4567-e89b-12d3-a456-426614174000')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('failed');
    expect(response.body.errorMessage).toBe('Video file is corrupted');
    expect(response.body.resultUrl).toBeUndefined();
    expect(response.body.frameCount).toBeUndefined();
  });
});
