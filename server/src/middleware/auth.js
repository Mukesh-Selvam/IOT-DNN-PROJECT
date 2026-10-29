// server/src/middleware/auth.js
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authenticate = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError('Authentication token missing. Please log in.', 401, null, 'AUTH_REQUIRED');
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(decoded.id).select('-passwordHash');

    if (!user) {
      throw new ApiError('User belonging to this token no longer exists.', 401, null, 'USER_NOT_FOUND');
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new ApiError('Authentication token expired. Please log in again.', 401, null, 'TOKEN_EXPIRED');
    }
    throw new ApiError('Invalid authentication token.', 401, null, 'INVALID_TOKEN');
  }
});

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ApiError('You do not have permission to perform this action.', 403, null, 'FORBIDDEN');
    }
    next();
  };
};

export default { authenticate, authorize };
