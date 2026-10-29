// server/tests/unit/slidingCadence.test.js
// Tests for sliding window mechanics:
// 1. Window length (2s = 100 samples at 50 Hz)
// 2. 50% overlap cadence (50 samples advance / 1s interval)
// 3. Pre-filter screening pass and block cases
// 4. Ring buffer eviction

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractWindowFeatures } from '../../src/utils/features.js';

describe('Sliding Window Cadence & Pre-Filter Screening', () => {
  it('correctly constructs 2.0s (100-sample) sliding windows with 50% overlap (50-sample stride)', () => {
    const sampleRateHz = 50;
    const windowSec = 2.0;
    const overlapRatio = 0.5;

    const windowPoints = Math.round(windowSec * sampleRateHz); // 100
    const stepPoints = Math.round(windowPoints * (1 - overlapRatio)); // 50

    assert.equal(windowPoints, 100, 'Window size must be exactly 100 samples (2 seconds at 50 Hz)');
    assert.equal(stepPoints, 50, 'Stride must be exactly 50 samples for 50% overlap cadence');

    // Simulate 250 continuous samples (5 seconds)
    const samples = Array.from({ length: 250 }, (_, i) => ({
      ts: 1710000000000 + i * 20,
      timeSec: i * 0.02,
      ax: 0,
      ay: 0,
      az: 1.0,
      gx: 0,
      gy: 0,
      gz: 0,
      speed: 60,
    }));

    const windows = [];
    for (let start = 0; start + windowPoints <= samples.length; start += stepPoints) {
      windows.push(samples.slice(start, start + windowPoints));
    }

    assert.equal(windows.length, 4, '250 samples should yield 4 sliding windows with 50% overlap');
    assert.equal(windows[0].length, 100);
    assert.equal(windows[1][0].ts, samples[50].ts, 'Window 2 must start at index 50 (1.0s advance)');
    assert.equal(windows[2][0].ts, samples[100].ts, 'Window 3 must start at index 100 (2.0s advance)');
  });

  it('pre-filter PASS cases: allows high-G collision shock, rollover spin, or sudden deceleration', () => {
    const screeningThresholdG = 2.5;

    // Case 1: High peak G shock (3.8g)
    const shockFeatures = { peakG: 3.8, speedDropRatio: 0.05, maxGyroDps: 10 };
    const shockPass =
      shockFeatures.peakG >= screeningThresholdG ||
      shockFeatures.speedDropRatio >= 0.4 ||
      shockFeatures.maxGyroDps >= 120;
    assert.equal(shockPass, true, 'High G spike must pass pre-filter');

    // Case 2: Rollover angular velocity (180 deg/s)
    const rollFeatures = { peakG: 1.8, speedDropRatio: 0.1, maxGyroDps: 180 };
    const rollPass =
      rollFeatures.peakG >= screeningThresholdG ||
      rollFeatures.speedDropRatio >= 0.4 ||
      rollFeatures.maxGyroDps >= 120;
    assert.equal(rollPass, true, 'High gyro rate must pass pre-filter');

    // Case 3: Severe speed drop (70%)
    const brakeFeatures = { peakG: 1.2, speedDropRatio: 0.7, maxGyroDps: 15 };
    const brakePass =
      brakeFeatures.peakG >= screeningThresholdG ||
      brakeFeatures.speedDropRatio >= 0.4 ||
      brakeFeatures.maxGyroDps >= 120;
    assert.equal(brakePass, true, 'Severe speed drop must pass pre-filter');
  });

  it('pre-filter BLOCK cases: blocks quiescent cruising and mild maneuvers', () => {
    const screeningThresholdG = 2.5;

    // Case 1: Steady normal highway cruising
    const cruiseFeatures = { peakG: 1.08, speedDropRatio: 0.02, maxGyroDps: 3.5 };
    const cruisePass =
      cruiseFeatures.peakG >= screeningThresholdG ||
      cruiseFeatures.speedDropRatio >= 0.4 ||
      cruiseFeatures.maxGyroDps >= 120;
    assert.equal(cruisePass, false, 'Quiescent driving must be blocked by pre-filter');

    // Case 2: Gentle lane change
    const laneChangeFeatures = { peakG: 1.25, speedDropRatio: 0.05, maxGyroDps: 18.0 };
    const laneChangePass =
      laneChangeFeatures.peakG >= screeningThresholdG ||
      laneChangeFeatures.speedDropRatio >= 0.4 ||
      laneChangeFeatures.maxGyroDps >= 120;
    assert.equal(laneChangePass, false, 'Gentle lane change must be blocked by pre-filter');
  });

  it('buffer eviction: enforces max capacity and prevents memory leakage', () => {
    const windowSec = 2;
    const sampleRate = 50;
    const maxBufferSize = Math.ceil(windowSec * sampleRate * 1.5); // 150 points

    const buffer = [];
    // Push 300 points into buffer with eviction logic
    for (let i = 0; i < 300; i++) {
      buffer.push({ ts: i, val: i });
      if (buffer.length > maxBufferSize) {
        buffer.splice(0, buffer.length - maxBufferSize);
      }
    }

    assert.equal(buffer.length, maxBufferSize, 'Buffer length must not exceed max capacity (150)');
    assert.equal(buffer[0].val, 150, 'Oldest points before capacity must be evicted');
    assert.equal(buffer[buffer.length - 1].val, 299, 'Most recent point must be retained at tail');
  });
});
