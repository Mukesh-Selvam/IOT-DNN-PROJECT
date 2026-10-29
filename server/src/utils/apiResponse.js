// server/src/utils/apiResponse.js
// Standardized API response formatters

export class ApiResponse {
  static success(res, data = null, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

  static created(res, data = null, message = 'Resource created successfully') {
    return ApiResponse.success(res, data, message, 201);
  }

  static error(res, message = 'Internal Server Error', statusCode = 500, details = null, code = null) {
    const response = {
      success: false,
      error: {
        message,
        statusCode,
      },
    };
    if (details) response.error.details = details;
    if (code) response.error.code = code;
    return res.status(statusCode).json(response);
  }
}

export class ApiError extends Error {
  constructor(message, statusCode = 500, details = null, code = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export default ApiResponse;
