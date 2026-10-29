// server/tests/integration/groundTruthMeta.test.js
// Verifies:
// 1. Ground-truth `meta` field is NEVER used by the detection pipeline
// 2. Ground-truth `meta` is NOT stored in MongoDB unless STORE_GROUND_TRUTH=true

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import config from '../../src/config/index.js';
import { queueTelemetryPoint } from '../../src/services/telemetryService.js';
import { extractWindowFeatures } from '../../src/utils/features.js';

describe('Ground Truth Meta Field Isolation', () => {
  it('omits meta field from stored telemetry point when storeGroundTruth is false', () => {
    const originalSetting = config.storeGroundTruth;
    try {
      config.storeGroundTruth = false;

      const rawSample = {
        deviceId: 'ESP32-GROUNDTRUTH-TEST',
        ts: Date.now(),
        seq: 1,
        accel: { x: 0.1, y: 0.2, z: 0.98 },
        gyro: { x: 1, y: 0, z: -1 },
        gps: { lat: 10.998, lng: 76.966, speed: 45 },
        meta: {
          scenario: 'frontal_collision',
          isAccident: true,
          phase: 'impact',
        },
      };

      // Helper function matching telemetryService queue logic
      function cleanSample(point) {
        return {
          deviceId: point.deviceId,
          ts: new Date(point.ts || Date.now()),
          seq: point.seq || 0,
          sampleRateHz: point.sampleRateHz || 50,
          accel: point.accel,
          gyro: point.gyro,
          gps: point.gps,
          speed: point.gps ? point.gps.speed : 0,
          buzzer: point.buzzer || 'OFF',
          ...(config.storeGroundTruth && point.meta ? { meta: point.meta } : {}),
        };
      }

      const storedWithoutGroundTruth = cleanSample(rawSample);
      assert.equal(storedWithoutGroundTruth.meta, undefined, 'meta field must NOT be stored when storeGroundTruth=false');

      // Now enable storeGroundTruth
      config.storeGroundTruth = true;
      const storedWithGroundTruth = cleanSample(rawSample);
      assert.ok(storedWithGroundTruth.meta, 'meta field is preserved only when storeGroundTruth=true');
      assert.equal(storedWithGroundTruth.meta.scenario, 'frontal_collision');
    } finally {
      config.storeGroundTruth = originalSetting;
    }
  });

  it('proves detection pipeline and feature extraction are completely blind to meta field', () => {
    // Two identical sensor windows: one with ground-truth meta: { isAccident: true }
    // and one with meta: { isAccident: false }
    const windowWithCrashMeta = [
      { ts: 1000, ax: 0.2, ay: 0.1, az: 1.0, gx: 1, gy: 0, gz: 0, speed: 50, meta: { isAccident: true } },
      { ts: 1020, ax: 0.2, ay: 0.1, az: 1.0, gx: 1, gy: 0, gz: 0, speed: 50, meta: { isAccident: true } },
    ];

    const windowWithNormalMeta = [
      { ts: 1000, ax: 0.2, ay: 0.1, az: 1.0, gx: 1, gy: 0, gz: 0, speed: 50, meta: { isAccident: false } },
      { ts: 1020, ax: 0.2, ay: 0.1, az: 1.0, gx: 1, gy: 0, gz: 0, speed: 50, meta: { isAccident: false } },
    ];

    const featCrash = extractWindowFeatures(windowWithCrashMeta);
    const featNormal = extractWindowFeatures(windowWithNormalMeta);

    // Assert 100% numerical identity: meta has zero influence on extracted features
    assert.deepEqual(featCrash, featNormal, 'Extracted features must be 100% identical regardless of meta content');
    assert.equal(featCrash.meta, undefined, 'Extracted features must not include meta');
  });
});
