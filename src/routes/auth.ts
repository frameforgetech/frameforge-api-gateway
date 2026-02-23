import { Router } from 'express';
import axios from 'axios';

const router = Router();

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://frameforge-auth-service:3001';

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: johndoe
 *               password:
 *                 type: string
 *                 format: password
 *                 example: SecurePass123!
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       409:
 *         description: Username already exists
 *       503:
 *         description: Auth service unavailable
 */
// Proxy all auth requests to auth-service
router.post('/register', async (req, res) => {
  try {
    const response = await axios.post(`${AUTH_SERVICE_URL}/api/v1/auth/register`, req.body);
    res.status(response.status).json(response.data);
  } catch (error: any) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      console.error('Auth service error:', error.message);
      res.status(503).json({ 
        error: 'Auth service unavailable',
        message: error.message 
      });
    }
  }
});

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: johndoe
 *               password:
 *                 type: string
 *                 format: password
 *                 example: SecurePass123!
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: JWT authentication token
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Invalid credentials
 *       503:
 *         description: Auth service unavailable
 */
router.post('/login', async (req, res) => {
  try {
    const response = await axios.post(`${AUTH_SERVICE_URL}/api/v1/auth/login`, req.body);
    res.status(response.status).json(response.data);
  } catch (error: any) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      console.error('Auth service error:', error.message);
      res.status(503).json({ 
        error: 'Auth service unavailable',
        message: error.message 
      });
    }
  }
});

/**
 * @swagger
 * /api/v1/auth/validate:
 *   get:
 *     summary: Validate JWT token
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Token is valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       503:
 *         description: Auth service unavailable
 */
router.get('/validate', async (req, res) => {
  try {
    const response = await axios.get(`${AUTH_SERVICE_URL}/api/v1/auth/validate`, {
      headers: {
        Authorization: req.headers.authorization,
      },
    });
    res.status(response.status).json(response.data);
  } catch (error: any) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      console.error('Auth service error:', error.message);
      res.status(503).json({ 
        error: 'Auth service unavailable',
        message: error.message 
      });
    }
  }
});

export default router;
