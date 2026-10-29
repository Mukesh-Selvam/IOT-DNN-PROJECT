// simulator/src/config.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from workspace root if present, fallback to simulator directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
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
  // MQTT settings
  mqttUrl: process.env.MQTT_URL || process.env.SIMULATOR_MQTT_URL || 'mqtt://localhost:1883',

  // Fleet settings
  vehicleCount: parseNum(process.env.VEHICLE_COUNT || process.env.SIMULATOR_NUM_VEHICLES, 3),
  sampleRateHz: parseNum(process.env.SAMPLE_RATE_HZ || process.env.SIMULATOR_SAMPLE_RATE_HZ, 50),
  noiseScale: parseNum(process.env.NOISE_SCALE || process.env.SIMULATOR_NOISE_LEVEL, 1.0),
  autoEvents: parseBool(process.env.AUTO_EVENTS, true),
  includeGroundTruth: parseBool(process.env.INCLUDE_GROUND_TRUTH, true),
  postCrashHoldSec: parseNum(process.env.POST_CRASH_HOLD_SEC, 20),
  seed: process.env.SEED ? parseNum(process.env.SEED, null) : null,

  // Firmware-like local alert settings
  localTrigger: parseBool(process.env.LOCAL_TRIGGER, true),
  localThresholdG: parseNum(process.env.LOCAL_THRESHOLD_G, 4.0),
  cancelWindowSec: parseNum(process.env.CANCEL_WINDOW_SEC, 15),
  cooldownSec: parseNum(process.env.COOLDOWN_SEC, 30),
  buzzerAutoOffSec: parseNum(process.env.BUZZER_AUTO_OFF_SEC, 60),

  // Control API settings
  controlPort: parseNum(process.env.CONTROL_PORT, 5055),
  controlApiKey: process.env.CONTROL_API_KEY || '',
  logLevel: process.env.LOG_LEVEL || 'info',
};

/**
 * Validate and dynamically update settings at runtime (used by Control API /settings)
 */
export function updateSettings(newSettings = {}) {
  if (typeof newSettings.sampleRateHz === 'number') {
    const rate = Math.round(newSettings.sampleRateHz);
    if (rate >= 10 && rate <= 200) {
      config.sampleRateHz = rate;
    }
  }
  if (typeof newSettings.noiseScale === 'number' && newSettings.noiseScale >= 0) {
    config.noiseScale = newSettings.noiseScale;
  }
  if (typeof newSettings.autoEvents === 'boolean') {
    config.autoEvents = newSettings.autoEvents;
  }
  if (typeof newSettings.localThresholdG === 'number' && newSettings.localThresholdG > 0) {
    config.localThresholdG = newSettings.localThresholdG;
  }
  if (typeof newSettings.cancelWindowSec === 'number' && newSettings.cancelWindowSec > 0) {
    config.cancelWindowSec = newSettings.cancelWindowSec;
  }
  if (typeof newSettings.postCrashHoldSec === 'number' && newSettings.postCrashHoldSec >= 0) {
    config.postCrashHoldSec = newSettings.postCrashHoldSec;
  }
  if (typeof newSettings.includeGroundTruth === 'boolean') {
    config.includeGroundTruth = newSettings.includeGroundTruth;
  }
  return { ...config };
}

export default config;
