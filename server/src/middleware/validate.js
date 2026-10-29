// server/src/middleware/validate.js
import { ApiError } from '../utils/apiResponse.js';

/**
 * Joi request validation middleware
 * @param {Object} schemas Object with optional `body`, `query`, and `params` Joi schemas
 */
export const validate = (schemas = {}) => {
  return (req, res, next) => {
    const targets = ['body', 'query', 'params'];
    const errors = [];

    for (const target of targets) {
      if (schemas[target]) {
        const { error, value } = schemas[target].validate(req[target], {
          abortEarly: false,
          stripUnknown: target === 'body', // Strip unknown body fields
          allowUnknown: target === 'query' || target === 'params',
        });

        if (error) {
          error.details.forEach((detail) => {
            errors.push({
              target,
              field: detail.path.join('.'),
              message: detail.message.replace(/['"]/g, ''),
            });
          });
        } else {
          req[target] = value;
        }
      }
    }

    if (errors.length > 0) {
      return next(new ApiError('Invalid request parameters', 400, errors, 'VALIDATION_FAILED'));
    }

    next();
  };
};

export default validate;
