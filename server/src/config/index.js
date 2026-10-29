// server/src/config/index.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from workspace root if present, fallback to server directory
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

function parseBool(val, fallback) {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'boolean') return val;
  return String(val).toLowerCase() === 'true' || String(val) === '1';
}

function parseNum(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseNum(process.env.PORT, 5000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/iot_accident_detection',
  mqttBrokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',

  // JWT Security
  jwtSecret: process.env.JWT_SECRET || 'iot_accident_detection_jwt_secret_key_2026_xyz',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',

  // CORS & Client
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  // ML Service & Fallback
  mlServiceUrl: process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000',
  mlTimeoutMs: parseNum(process.env.ML_TIMEOUT_MS, 1500),

  // Simulator HTTP Proxy
  simulatorUrl: process.env.SIMULATOR_URL || 'http://localhost:5055',
  simulatorApiKey: process.env.SIMULATOR_API_KEY || '',

  // Telemetry & Ground Truth
  telemetryTtlHours: parseNum(process.env.TELEMETRY_TTL_HOURS, 24),
  storeGroundTruth: parseBool(process.env.STORE_GROUND_TRUTH, false),

  // Default Detection Thresholds & Pipeline Settings (persistable via Setting model)
  defaultSettings: {
    impactThresholdG: parseNum(process.env.PEAK_G_THRESHOLD, 4.0),
    screeningThresholdG: parseNum(process.env.SCREENING_THRESHOLD_G, 2.5),
    mlConfidenceThreshold: parseNum(process.env.ACCIDENT_CONFIDENCE_THRESHOLD, 0.75),
    windowSeconds: parseNum(process.env.WINDOW_SECONDS, 2),
    overlapRatio: parseNum(process.env.OVERLAP_RATIO, 0.5),
    cancelCountdownSeconds: parseNum(process.env.CANCELLATION_WINDOW_SECONDS, 15),
    debounceSeconds: parseNum(process.env.ALERT_DEBOUNCE_SECONDS, 60),
    enabledAlertChannels: ['in_app', 'sms', 'email'],
  },

  // Alert Notifications
  email: {
    host: process.env.EMAIL_HOST || '',
    port: parseNum(process.env.EMAIL_PORT, 587),
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || '"IoT Accident Alert System" <alerts@iot-accident.local>',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },

  logLevel: process.env.LOG_LEVEL || 'info',
};

export default config;
