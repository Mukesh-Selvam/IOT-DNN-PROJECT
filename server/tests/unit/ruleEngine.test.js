// server/tests/unit/ruleEngine.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRuleBased } from '../../src/services/ruleEngineService.js';

describe('Rule-Based Fallback Engine (Kinematic Physics Classification)', () => {
  it('correctly classifies severe frontal impact crash with speed drop as ACCIDENT', () => {
    const crashFeatures = {
      peakG: 5.8,
      speedInitial: 55,
      speedFinal: 5,
      speedDropRatio: 0.91,
      maxGyroDps: 45,
    };

    const result = evaluateRuleBased(crashFeatures);
    assert.equal(result.isAccident, true);
    assert.equal(result.label, 'ACCIDENT');
    assert.ok(result.confidence >= 0.78, `Confidence should be high, got ${result.confidence}`);
  });

  it('correctly classifies rollover / side-impact crash with high angular rate as ACCIDENT', () => {
    const rolloverFeatures = {
      peakG: 4.5,
      speedInitial: 40,
      speedFinal: 30,
      speedDropRatio: 0.25, // minimal speed drop
      maxGyroDps: 185,      // violent chassis spin >= 140 dps
    };

    const result = evaluateRuleBased(rolloverFeatures);
    assert.equal(result.isAccident, true);
    assert.equal(result.label, 'ACCIDENT');
    assert.ok(result.confidence >= 0.75);
  });

  it('provides false alarm immunity for potholes and speed bumps (high G spike, NO speed drop or rotation)', () => {
    const potholeFeatures = {
      peakG: 4.8,          // High vertical spike from pothole
      speedInitial: 50,
      speedFinal: 48,
      speedDropRatio: 0.04, // Vehicle maintained cruising speed
      maxGyroDps: 25,       // No violent yaw/roll
    };

    const result = evaluateRuleBased(potholeFeatures);
    assert.equal(result.isAccident, false);
    assert.equal(result.label, 'NON_ACCIDENT');
    assert.ok(result.reason.includes('likely pothole') || result.reason.includes('false bump'), 
      `Reason should explain immunity, got: ${result.reason}`);
  });

  it('correctly classifies normal cruising or mild braking as NON_ACCIDENT', () => {
    const normalFeatures = {
      peakG: 1.2,
      speedInitial: 60,
      speedFinal: 58,
      speedDropRatio: 0.03,
      maxGyroDps: 8,
    };

    const result = evaluateRuleBased(normalFeatures);
    assert.equal(result.isAccident, false);
    assert.equal(result.label, 'NON_ACCIDENT');
  });
});
