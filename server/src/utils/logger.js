// server/src/utils/logger.js
// Structured logger with timestamps, levels, and request-id formatting

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

class Logger {
  constructor(level = process.env.LOG_LEVEL || 'info') {
    this.currentLevel = LEVELS[level.toLowerCase()] ?? LEVELS.info;
  }

  _timestamp() {
    return new Date().toISOString();
  }

  debug(...args) {
    if (this.currentLevel <= LEVELS.debug) {
      console.log(`${COLORS.dim}[${this._timestamp()}] [DEBUG]${COLORS.reset}`, ...args);
    }
  }

  info(...args) {
    if (this.currentLevel <= LEVELS.info) {
      console.log(`${COLORS.cyan}[${this._timestamp()}] [INFO]${COLORS.reset}`, ...args);
    }
  }

  warn(...args) {
    if (this.currentLevel <= LEVELS.warn) {
      console.warn(`${COLORS.yellow}[${this._timestamp()}] [WARN]${COLORS.reset}`, ...args);
    }
  }

  error(...args) {
    if (this.currentLevel <= LEVELS.error) {
      console.error(`${COLORS.red}[${this._timestamp()}] [ERROR]${COLORS.reset}`, ...args);
    }
  }

  incident(type, deviceId, details = '') {
    console.log(`${COLORS.magenta}[${this._timestamp()}] [INCIDENT] [${deviceId}] ${type}${COLORS.reset} ${details}`);
  }
}

export const logger = new Logger();
export default logger;
