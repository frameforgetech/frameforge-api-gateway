import request from 'supertest';
import express from 'express';
import authRoutes from './auth';

// Mock axios
jest.mock('axios');
const axios = require('axios');

// Create test app
const app = express();
app.use(express.json());
app.use('/api/v1/auth', authRoutes);

describe('Auth Routes (proxy to auth-service)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/auth/register
  // -------------------------------------------------------------------------
  describe('POST /api/v1/auth/register', () => {
    it('should proxy registration to auth-service and return 201', async () => {
      axios.post.mockResolvedValue({
        status: 201,
        data: {
          userId: 'abc-123',
          username: 'testuser',
          email: 'test@example.com',
        },
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'testuser', email: 'test@example.com', password: 'TestPass1' });

      expect(response.status).toBe(201);
      expect(response.body.username).toBe('testuser');
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('should forward 400 validation errors from auth-service', async () => {
      axios.post.mockRejectedValue({
        response: { status: 400, data: { error: 'Validation failed' } },
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'x' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation failed');
    });

    it('should return 503 when auth-service is unreachable', async () => {
      axios.post.mockRejectedValue(new Error('Connection refused'));

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'testuser', password: 'TestPass1' });

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Auth service unavailable');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/auth/login
  // -------------------------------------------------------------------------
  describe('POST /api/v1/auth/login', () => {
    it('should proxy login and return token on success', async () => {
      axios.post.mockResolvedValue({
        status: 200,
        data: { token: 'jwt-token-here', expiresIn: 3600 },
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'TestPass1' });

      expect(response.status).toBe(200);
      expect(response.body.token).toBe('jwt-token-here');
    });

    it('should forward 401 from auth-service on bad credentials', async () => {
      axios.post.mockRejectedValue({
        response: { status: 401, data: { error: 'Invalid credentials' } },
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'wrong' });

      expect(response.status).toBe(401);
    });

    it('should return 503 when auth-service is unreachable', async () => {
      axios.post.mockRejectedValue(new Error('ECONNREFUSED'));

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'TestPass1' });

      expect(response.status).toBe(503);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/auth/validate
  // -------------------------------------------------------------------------
  describe('GET /api/v1/auth/validate', () => {
    it('should proxy token validation and return valid response', async () => {
      axios.get.mockResolvedValue({
        status: 200,
        data: { valid: true, userId: 'abc-123', username: 'testuser' },
      });

      const response = await request(app)
        .get('/api/v1/auth/validate')
        .set('Authorization', 'Bearer jwt-token-here');

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('should forward 401 for invalid tokens', async () => {
      axios.get.mockRejectedValue({
        response: { status: 401, data: { valid: false, error: 'Invalid token' } },
      });

      const response = await request(app)
        .get('/api/v1/auth/validate')
        .set('Authorization', 'Bearer bad-token');

      expect(response.status).toBe(401);
    });

    it('should return 503 when auth-service is unreachable', async () => {
      axios.get.mockRejectedValue(new Error('ECONNREFUSED'));

      const response = await request(app)
        .get('/api/v1/auth/validate')
        .set('Authorization', 'Bearer some-token');

      expect(response.status).toBe(503);
    });
  });
});
