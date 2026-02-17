// Request and response types for API Gateway

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    requestId: string;
    timestamp: string;
  };
}

// Extend Express Request type to include requestId and user
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: {
        userId: string;
        username: string;
      };
    }
  }
}
