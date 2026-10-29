// server/src/services/settingsService.js
// Runtime system settings persisted in MongoDB and cached in memory

import config from '../config/index.js';
import { Setting } from '../models/Setting.js';
import logger from '../utils/logger.js';

let cachedSettings = { ...config.defaultSettings };
let isInitialized = false;

export async function initSettings() {
  if (isInitialized) return cachedSettings;
  try {
    const doc = await Setting.findOne({ key: 'system_settings' });
    if (doc && doc.value) {
      cachedSettings = { ...config.defaultSettings, ...doc.value };
      logger.info('[Settings] Loaded persisted runtime settings from MongoDB');
    } else {
      await Setting.create({
        key: 'system_settings',
        value: config.defaultSettings,
        description: 'Global IoT crash detection and alerting thresholds',
      });
      logger.info('[Settings] Seeded default runtime settings into MongoDB');
    }
  } catch (err) {
    logger.warn('[Settings] Failed to query settings from DB, using defaults:', err.message);
  }
  isInitialized = true;
  return cachedSettings;
}

export function getCachedSettings() {
  return { ...cachedSettings };
}

export async function updateSystemSettings(newValues = {}) {
  cachedSettings = {
    ...cachedSettings,
    ...newValues,
  };

  try {
    await Setting.findOneAndUpdate(
      { key: 'system_settings' },
      { value: cachedSettings },
      { upsert: true, new: true }
    );
    logger.info('[Settings] Updated system settings in MongoDB and memory cache');
  } catch (err) {
    logger.error('[Settings] Error saving settings to MongoDB:', err.message);
  }

  return { ...cachedSettings };
}

export default {
  initSettings,
  getCachedSettings,
  updateSystemSettings,
};
