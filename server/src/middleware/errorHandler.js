// server/src/middleware/errorHandler.js
import { ApiError } from '../utils/apiResponse.js';
import logger from '../utils/logger.js';

export function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let details = err.details || null;
  let code = err.code || null;

  // Handle Mongoose Validation Error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
    details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    code = 'VALIDATION_ERROR';
  }

  // Handle Mongoose Cast Error (e.g. invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for parameter "${err.path}"`;
    code = 'INVALID_ID';
  }

  // Handle Duplicate Key Error (code 11000)
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    message = `Duplicate key error: "${field}" already exists`;
    code = 'DUPLICATE_KEY';
  }

  // Handle JWT Errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid authentication token';
    code = 'INVALID_TOKEN';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Authentication token expired';
    code = 'TOKEN_EXPIRED';
  }

  // Log non-4xx errors or in development
  if (statusCode >= 500) {
    logger.error(`[${req.method} ${req.originalUrl}] 500 Error:`, err.stack || err.message);
  } else {
    logger.debug(`[${req.method} ${req.originalUrl}] ${statusCode} Warning:`, message);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      statusCode,
      ...(code && { code }),
      ...(details && { details }),
    },
  });
}

export default errorHandler;
