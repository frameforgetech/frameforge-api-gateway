import swaggerJsdoc from 'swagger-jsdoc';
import { SwaggerDefinition } from 'swagger-jsdoc';

const swaggerDefinition: SwaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'FrameForge API Gateway',
    version: '1.0.0',
    description: 'API Gateway for FrameForge Video Processing System - Scalable microservices architecture for video frame extraction',
    contact: {
      name: 'FrameForge Team',
      email: 'support@frameforge.tech',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: process.env.API_BASE_URL || 'http://localhost:3000',
      description: 'Development server',
    },
    {
      url: 'https://api.frameforge.tech',
      description: 'Production server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token in the format: Bearer {token}',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'string',
            description: 'Error message',
          },
          requestId: {
            type: 'string',
            description: 'Unique request identifier for tracking',
          },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['ok'],
            description: 'Service health status',
          },
          service: {
            type: 'string',
            description: 'Service name',
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'User unique identifier',
          },
          username: {
            type: 'string',
            description: 'Username',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Account creation timestamp',
          },
        },
      },
      Job: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Job unique identifier',
          },
          userId: {
            type: 'string',
            format: 'uuid',
            description: 'User who created the job',
          },
          videoUrl: {
            type: 'string',
            format: 'uri',
            description: 'URL of the video to process',
          },
          status: {
            type: 'string',
            enum: ['pending', 'processing', 'completed', 'failed'],
            description: 'Current job status',
          },
          frameCount: {
            type: 'integer',
            nullable: true,
            description: 'Number of frames extracted',
          },
          outputPath: {
            type: 'string',
            nullable: true,
            description: 'Path to extracted frames',
          },
          errorMessage: {
            type: 'string',
            nullable: true,
            description: 'Error message if job failed',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'Job creation timestamp',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'Job last update timestamp',
          },
        },
      },
      CreateJobRequest: {
        type: 'object',
        required: ['videoUrl'],
        properties: {
          videoUrl: {
            type: 'string',
            format: 'uri',
            description: 'URL of the video to process',
            example: 'https://example.com/video.mp4',
          },
        },
      },
      CreateJobResponse: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            format: 'uuid',
            description: 'Created job identifier',
          },
          message: {
            type: 'string',
            description: 'Success message',
          },
        },
      },
    },
    responses: {
      UnauthorizedError: {
        description: 'Access token is missing or invalid',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'Unauthorized',
              requestId: '123e4567-e89b-12d3-a456-426614174000',
            },
          },
        },
      },
      NotFoundError: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'Resource not found',
              requestId: '123e4567-e89b-12d3-a456-426614174000',
            },
          },
        },
      },
      ValidationError: {
        description: 'Validation error',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'Validation failed',
              requestId: '123e4567-e89b-12d3-a456-426614174000',
            },
          },
        },
      },
      InternalServerError: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              error: 'Internal server error',
              requestId: '123e4567-e89b-12d3-a456-426614174000',
            },
          },
        },
      },
    },
  },
  tags: [
    {
      name: 'Health',
      description: 'Service health check endpoints',
    },
    {
      name: 'Authentication',
      description: 'Authentication and authorization endpoints (proxied to auth service)',
    },
    {
      name: 'Videos',
      description: 'Video processing job management endpoints',
    },
  ],
};

const options: swaggerJsdoc.Options = {
  definition: swaggerDefinition,
  apis: [
    './src/routes/*.ts',
    './src/index.ts',
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
