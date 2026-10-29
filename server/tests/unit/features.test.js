// server/tests/unit/features.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractWindowFeatures, magnitude } from '../../src/utils/features.js';

describe('Feature Extraction Utility (Parity & Kinematics)', () => {
  it('correctly calculates 3D Euclidean magnitude', () => {
    assert.equal(magnitude(0, 0, 0), 0);
    assert.equal(magnitude(3, 4, 0), 5);
    assert.equal(Math.round(magnitude(1, 1, 1) * 1000) / 1000, 1.732);
  });

  it('handles empty or null telemetry window gracefully with zero defaults', () => {
    const emptyFeatures = extractWindowFeatures([]);
    assert.equal(emptyFeatures.count, 0);
    assert.equal(emptyFeatures.peakG, 0);
    assert.equal(emptyFeatures.speedDropRatio, 0);
    assert.equal(emptyFeatures.peakIndex, -1);
  });

  it('extracts statistical and kinematic crash features accurately', () => {
    // Generate synthetic deceleration crash window: 50Hz, 100 points
    const baseTs = 1700000000000;
    const window = [];

    for (let i = 0; i < 100; i++) {
      const ts = baseTs + i * 20; // 20ms steps (50Hz)
      if (i < 40) {
        // Cruising at 60 km/h with 1.0g gravity on Z
        window.push({
          ts,
          accel: { x: 0.05, y: 0.02, z: 0.99 },
          gyro: { x: 1.0, y: 0.5, z: 0.2 },
          gps: { speed: 60, lat: 11.0, lng: 77.0 },
        });
      } else if (i === 40) {
        // Severe impact: 6.5g peak resultant spike
        window.push({
          ts,
          accel: { x: 5.2, y: 3.5, z: 2.1 }, // magnitude = sqrt(27.04 + 12.25 + 4.41) = ~6.61g
          gyro: { x: 120.0, y: 95.0, z: 45.0 }, // magnitude = ~159.8 dps
          gps: { speed: 55, lat: 11.0, lng: 77.0 },
        });
      } else {
        // Post-impact standstill at 0 km/h
        window.push({
          ts,
          accel: { x: 0.1, y: -0.1, z: 0.98 },
          gyro: { x: 0.2, y: 0.1, z: 0.0 },
          gps: { speed: 0, lat: 11.0, lng: 77.0 },
        });
      }
    }

    const feat = extractWindowFeatures(window);

    assert.equal(feat.count, 100);
    assert.ok(feat.peakG >= 6.5, `Expected peakG >= 6.5, got ${feat.peakG}`);
    assert.equal(feat.peakIndex, 40);
    assert.equal(feat.peakTimestamp, baseTs + 40 * 20);
    assert.ok(feat.maxJerkGPerS > 100, `Expected high jerk, got ${feat.maxJerkGPerS}`);
    assert.equal(feat.speedInitial, 60);
    assert.equal(feat.speedFinal, 0);
    assert.equal(feat.speedDelta, 60);
    assert.equal(feat.speedDropRatio, 1.0); // 100% speed drop
    assert.ok(feat.maxGyroDps >= 150, `Expected maxGyroDps >= 150, got ${feat.maxGyroDps}`);
  });
});
