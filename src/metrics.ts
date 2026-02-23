// Prometheus metrics for API Gateway

import { Request, Response, NextFunction } from 'express';
import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

// Create a Registry to register the metrics
export const register = new Registry();

// Collect default metrics (CPU, memory, etc.)
collectDefaultMetrics({ register });

// HTTP request counter
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// HTTP request duration histogram
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

// Video upload requests counter
export const videoUploadRequestsTotal = new Counter({
  name: 'video_upload_requests_total',
  help: 'Total number of video upload URL requests',
  labelNames: ['status'],
  registers: [register],
});

// Video job queries counter
export const videoJobQueriesTotal = new Counter({
  name: 'video_job_queries_total',
  help: 'Total number of video job queries',
  labelNames: ['type'], // 'single' or 'list'
  registers: [register],
});

// Middleware to track HTTP metrics
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  
  // Capture response finish event
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000; // Convert to seconds
    const route = req.route ? req.route.path : req.path;
    
    httpRequestsTotal.labels(req.method, route, res.statusCode.toString()).inc();
    httpRequestDuration.labels(req.method, route, res.statusCode.toString()).observe(duration);
  });
  
  next();
}

// Metrics endpoint handler
export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (error) {
    console.error('Error generating metrics:', error);
    res.status(500).end('Error generating metrics');
  }
}
