// server/src/utils/asyncHandler.js
// Express async route handler wrapper to forward errors to central error middleware

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
