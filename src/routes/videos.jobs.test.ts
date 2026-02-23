import request from 'supertest';
import express from 'express';
import videoRoutes from './videos';
import { requestIdMiddleware } from '../middleware';

// Mock all external dependencies
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');
jest.mock('axios');
jest.mock('../database', () => ({
  AppDataSource: {
    initialize: jest.fn().mockResolvedValue(undefined),
    getRepository: jest.fn(),
  },
}));
jest.mock('../queue', () => ({
  publishToQueue: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../cache', () => ({
  invalidateJobCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../middleware', () => {
  const original = jest.requireActual('../middleware');
  return {
    ...original,
    getRedisClient: jest.fn().mockReturnValue(null), // No Redis in unit tests
  };
});

const axios = require('axios');
const { AppDataSource } = require('../database');

// Create test app
const app = express();
app.use(express.json());
app.use(requestIdMiddleware);

const { authMiddleware } = require('../middleware');
app.use(authMiddleware);
app.use('/api/v1/videos', videoRoutes);

// Mock auth to succeed
const mockAuthResponse = {
  data: { valid: true, userId: 'user-abc-123', username: 'testuser' },
};

describe('POST /api/v1/videos/jobs', () => {
  let mockJobRepository: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock auth
    axios.post.mockResolvedValue(mockAuthResponse);

    // Mock job repository
    mockJobRepository = {
      create: jest.fn().mockImplementation((data: any) => ({
        jobId: 'job-uuid-123',
        ...data,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      })),
      save: jest.fn().mockImplementation((job: any) => Promise.resolve(job)),
    };
    AppDataSource.getRepository.mockReturnValue(mockJobRepository);
  });

  it('should create a video job and return 201', async () => {
    const response = await request(app)
      .post('/api/v1/videos/jobs')
      .set('Authorization', 'Bearer test-token')
      .send({ videoId: 'vid-uuid-456', filename: 'my-video.mp4' });

    expect(response.status).toBe(201);
    expect(response.body.jobId).toBe('job-uuid-123');
    expect(response.body.status).toBe('pending');
    expect(mockJobRepository.save).toHaveBeenCalledTimes(1);
  });

  it('should return 400 when videoId is missing', async () => {
    const response = await request(app)
      .post('/api/v1/videos/jobs')
      .set('Authorization', 'Bearer test-token')
      .send({ filename: 'my-video.mp4' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.videoId).toBeDefined();
  });

  it('should return 400 when filename is missing', async () => {
    const response = await request(app)
      .post('/api/v1/videos/jobs')
      .set('Authorization', 'Bearer test-token')
      .send({ videoId: 'vid-uuid-456' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.filename).toBeDefined();
  });

  it('should return 500 on database error', async () => {
    mockJobRepository.save.mockRejectedValue(new Error('DB connection lost'));

    const response = await request(app)
      .post('/api/v1/videos/jobs')
      .set('Authorization', 'Bearer test-token')
      .send({ videoId: 'vid-uuid-456', filename: 'my-video.mp4' });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('GET /api/v1/videos/jobs', () => {
  let mockJobRepository: any;

  const mockJobs = [
    {
      jobId: 'job-1',
      filename: 'video1.mp4',
      status: 'pending',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: null,
      resultUrl: null,
    },
    {
      jobId: 'job-2',
      filename: 'video2.mp4',
      status: 'completed',
      createdAt: new Date('2026-01-02T00:00:00Z'),
      completedAt: new Date('2026-01-02T01:00:00Z'),
      resultUrl: 'https://s3.example.com/frames.zip',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue(mockAuthResponse);

    const mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(2),
      getMany: jest.fn().mockResolvedValue(mockJobs),
    };

    mockJobRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };
    AppDataSource.getRepository.mockReturnValue(mockJobRepository);
  });

  it('should list jobs with default pagination', async () => {
    const response = await request(app)
      .get('/api/v1/videos/jobs')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.jobs).toHaveLength(2);
    expect(response.body.pagination.total).toBe(2);
    expect(response.body.pagination.page).toBe(1);
  });

  it('should return 400 for invalid status filter', async () => {
    const response = await request(app)
      .get('/api/v1/videos/jobs?status=invalid_status')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should accept valid status filter', async () => {
    const response = await request(app)
      .get('/api/v1/videos/jobs?status=pending')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
  });

  it('should return 500 on database error', async () => {
    mockJobRepository.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockRejectedValue(new Error('DB error')),
      getMany: jest.fn(),
    });

    const response = await request(app)
      .get('/api/v1/videos/jobs')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(500);
  });
});

describe('GET /api/v1/videos/jobs/:jobId', () => {
  let mockJobRepository: any;

  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue(mockAuthResponse);

    mockJobRepository = {
      findOne: jest.fn(),
    };
    AppDataSource.getRepository.mockReturnValue(mockJobRepository);
  });

  it('should return job details for the owner', async () => {
    mockJobRepository.findOne.mockResolvedValue({
      jobId: '550e8400-e29b-41d4-a716-446655440001',
      userId: 'user-abc-123', // Same as authenticated user
      filename: 'my-video.mp4',
      status: 'completed',
      videoUrl: 'https://s3.example.com/video.mp4',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      completedAt: new Date('2026-01-01T01:00:00Z'),
      resultUrl: 'https://s3.example.com/frames.zip',
      frameCount: 300,
      errorMessage: null,
      startedAt: new Date('2026-01-01T00:05:00Z'),
    });

    const response = await request(app)
      .get('/api/v1/videos/jobs/550e8400-e29b-41d4-a716-446655440001')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.jobId).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(response.body.frameCount).toBe(300);
  });

  it('should return 404 when job does not exist', async () => {
    mockJobRepository.findOne.mockResolvedValue(null);

    const response = await request(app)
      .get('/api/v1/videos/jobs/550e8400-e29b-41d4-a716-446655440002')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('JOB_NOT_FOUND');
  });

  it('should return 403 when job belongs to another user', async () => {
    mockJobRepository.findOne.mockResolvedValue({
      jobId: '550e8400-e29b-41d4-a716-446655440003',
      userId: 'different-user-id', // Different user
      filename: 'their-video.mp4',
      status: 'pending',
      videoUrl: 'https://s3.example.com/video.mp4',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const response = await request(app)
      .get('/api/v1/videos/jobs/550e8400-e29b-41d4-a716-446655440003')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('should return 500 on database error', async () => {
    mockJobRepository.findOne.mockRejectedValue(new Error('DB connection lost'));

    const response = await request(app)
      .get('/api/v1/videos/jobs/550e8400-e29b-41d4-a716-446655440004')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(500);
  });
});
