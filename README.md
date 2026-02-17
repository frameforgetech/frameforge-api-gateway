# FrameForge API Gateway

Central API Gateway for FrameForge microservices - handles routing, authentication, caching, and video uploads.

## 🚀 Features

- **Authentication** - JWT token validation via auth-service
- **Video Management** - Upload, list, and track video processing jobs  
- **Caching** - Redis caching for improved performance
- **Message Queue** - RabbitMQ integration for async processing
- **Prometheus Metrics** - Performance and health monitoring

## 📋 API Endpoints

### Videos
- `GET /api/v1/videos/upload-url` - Get presigned upload URL
- `POST /api/v1/videos/jobs` - Create new video processing job
- `GET /api/v1/videos/jobs` - List user's jobs (paginated)
- `GET /api/v1/videos/jobs/:jobId` - Get job details
- `GET /api/v1/videos/jobs/:jobId/download` - Download processed frames

### Health & Metrics
- `GET /health` - Health check endpoint
- `GET /metrics` - Prometheus metrics

## 🔧 Environment Variables

Create a `.env` file:

```env
PORT=3000
AUTH_SERVICE_URL=http://localhost:3001
DATABASE_URL=postgresql://user:password@localhost:5432/frameforge
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://user:pass@localhost:5672
S3_BUCKET=frameforge-videos
AWS_REGION=us-east-1
NODE_ENV=development
```

## 💻 Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Start production server
npm start
```

## 📦 Dependencies

- Express.js for HTTP server
- Redis for caching
- RabbitMQ for message queue
- TypeORM for database
- Multer for file uploads
- Axios for service communication

---

**Part of the FrameForge microservices ecosystem**
