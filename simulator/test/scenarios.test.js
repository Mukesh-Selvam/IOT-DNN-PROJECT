// simulator/test/scenarios.test.js
// Automated tests for all 8 driving scenarios over multiple seeds, clipping, and reproducibility

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  ACCIDENT_SCENARIOS,
  NON_ACCIDENT_SCENARIOS,
  SCENARIO_TYPES,
  ScenarioRunner,
} from '../src/scenarios.js';
import { MPU6050Sensor } from '../src/sensors.js';
import { createRNG, vec3Magnitude } from '../src/util.js';
import { Vehicle } from '../src/vehicle.js';

describe('Scenario Physics and Safety Threshold Verification', () => {
  const NUM_SEEDS = 30;

  // 1. Accident Scenarios: Peak |a| >= 4.2g and Final Speed < 1.0 km/h across 30 seeds
  for (const scenario of ACCIDENT_SCENARIOS) {
    test(`Accident "${scenario}" reaches peak |a| >= 4.2g and stops (< 1 km/h) over ${NUM_SEEDS} seeds`, () => {
      for (let s = 1; s <= NUM_SEEDS; s++) {
        const seed = s * 7919;
        const rng = createRNG(seed);
        const runner = new ScenarioRunner(rng);
        runner.setPostCrashHoldSec(20);
        runner.trigger(scenario);

        const mpu = new MPU6050Sensor({ deviceId: 'TEST-DEV', rng, noiseScale: 1.0 });

        let peakTotalG = 0;
        let speed = 60.0;
        const dt = 0.02; // 50 Hz

        // Run scenario through impact and stop deceleration (2.5 seconds)
        const maxSteps = Math.ceil(2.5 / dt);
        for (let step = 0; step < maxSteps; step++) {
          const { dynamicState, targetSpeedKmH } = runner.step(dt, speed, 60.0);
          speed = targetSpeedKmH;

          const sample = mpu.sample(dynamicState, speed, dt);
          const currentTotalG = vec3Magnitude(sample.accel);
          if (currentTotalG > peakTotalG) {
            peakTotalG = currentTotalG;
          }
        }

        assert.ok(
          peakTotalG >= 4.2,
          `Seed ${seed}: Expected peak |a| >= 4.2g for ${scenario}, got ${peakTotalG.toFixed(2)}g`
        );
        assert.ok(
          speed < 1.0,
          `Seed ${seed}: Expected final speed < 1 km/h for ${scenario}, got ${speed.toFixed(2)} km/h`
        );
      }
    });
  }

  // 2. Non-Accident Scenarios: Peak |a| strictly < 4.0g across 30 seeds
  for (const scenario of NON_ACCIDENT_SCENARIOS) {
    test(`Non-accident "${scenario}" strictly keeps peak |a| < 4.0g over ${NUM_SEEDS} seeds`, () => {
      for (let s = 1; s <= NUM_SEEDS; s++) {
        const seed = s * 6271;
        const rng = createRNG(seed);
        const runner = new ScenarioRunner(rng);
        runner.trigger(scenario);

        const mpu = new MPU6050Sensor({ deviceId: 'TEST-DEV', rng, noiseScale: 1.0 });

        let peakTotalG = 0;
        let speed = 55.0;
        const dt = 0.02; // 50 Hz

        const maxSteps = Math.ceil(4.0 / dt);
        for (let step = 0; step < maxSteps; step++) {
          const { dynamicState, targetSpeedKmH } = runner.step(dt, speed, 55.0);
          speed = targetSpeedKmH;

          const sample = mpu.sample(dynamicState, speed, dt);
          const currentTotalG = vec3Magnitude(sample.accel);
          if (currentTotalG > peakTotalG) {
            peakTotalG = currentTotalG;
          }
        }

        assert.ok(
          peakTotalG < 4.0,
          `Seed ${seed}: Non-accident ${scenario} exceeded 4.0g! Peak was ${peakTotalG.toFixed(2)}g`
        );
      }
    });
  }

  // 3. Pothole Specifics: Vertical impulse spike up to ~3.5g without altering vehicle speed
  test('Pothole scenario stays below 4.0g threshold and preserves speed', () => {
    const rng = createRNG(4242);
    const runner = new ScenarioRunner(rng);
    runner.trigger(SCENARIO_TYPES.POTHOLE);
    const mpu = new MPU6050Sensor({ deviceId: 'TEST-DEV', rng, noiseScale: 1.0 });

    let peakTotalG = 0;
    const initialSpeed = 50.0;
    let speed = initialSpeed;
    const dt = 0.02;

    for (let step = 0; step < 50; step++) {
      const { dynamicState, targetSpeedKmH } = runner.step(dt, speed, initialSpeed);
      speed = targetSpeedKmH;

      const sample = mpu.sample(dynamicState, speed, dt);
      const totalG = vec3Magnitude(sample.accel);
      if (totalG > peakTotalG) peakTotalG = totalG;
    }

    assert.ok(peakTotalG > 2.0, `Pothole should register a noticeable vertical spike, got ${peakTotalG}g`);
    assert.ok(peakTotalG < 4.0, `Pothole must strictly remain < 4.0g, got ${peakTotalG}g`);
    assert.equal(speed, initialSpeed, 'Pothole must not alter vehicle cruise speed');
  });

  // 4. Rollover: Gravity vector remains rotated while stopped
  test('Rollover accident keeps gravity vector rotated while stopped at rest', () => {
    const rng = createRNG(9999);
    const runner = new ScenarioRunner(rng);
    runner.setPostCrashHoldSec(10);
    runner.trigger(SCENARIO_TYPES.ROLLOVER);

    const dt = 0.02;
    let speed = 60.0;
    let lastGravity = { x: 0, y: 0, z: 1.0 };

    // Advance 3.5 seconds into the post-crash rest phase
    for (let step = 0; step < 175; step++) {
      const { dynamicState, targetSpeedKmH } = runner.step(dt, speed, 60.0);
      speed = targetSpeedKmH;
      lastGravity = {
        x: dynamicState.gravityX,
        y: dynamicState.gravityY,
        z: dynamicState.gravityZ,
      };
    }

    assert.equal(speed, 0, 'Vehicle must be stopped after rollover');
    // In a normal car, resting gravity is purely Z=1.0g, Y=0g.
    // In a rolled car, gravity shifted to Y (side) or negative Z (roof).
    const isRotated = Math.abs(lastGravity.y) > 0.8 || lastGravity.z < 0.0;
    assert.ok(
      isRotated,
      `Gravity vector must remain rotated when stopped! Gravity was: (${lastGravity.x}, ${lastGravity.y}, ${lastGravity.z})`
    );
  });

  // 5. Sensor Saturation Clipping at ±16g and ±2000 dps
  test('MPU6050 output is strictly clipped to +-16g and +-2000 deg/s', () => {
    const mpu = new MPU6050Sensor({ deviceId: 'TEST-DEV', noiseScale: 1.0 });
    // Inject extreme dynamic forces that exceed hardware bounds
    const extremeDynamics = {
      ax: -80.0,
      ay: 120.0,
      az: 60.0,
      gx: 5000.0,
      gy: -4000.0,
      gz: 3500.0,
    };

    const sample = mpu.sample(extremeDynamics, 0, 0.02);

    assert.ok(sample.accel.x >= -16.0 && sample.accel.x <= 16.0, `Accel X exceeded ±16g: ${sample.accel.x}`);
    assert.ok(sample.accel.y >= -16.0 && sample.accel.y <= 16.0, `Accel Y exceeded ±16g: ${sample.accel.y}`);
    assert.ok(sample.accel.z >= -16.0 && sample.accel.z <= 16.0, `Accel Z exceeded ±16g: ${sample.accel.z}`);

    assert.ok(sample.gyro.x >= -2000.0 && sample.gyro.x <= 2000.0, `Gyro X exceeded ±2000 dps: ${sample.gyro.x}`);
    assert.ok(sample.gyro.y >= -2000.0 && sample.gyro.y <= 2000.0, `Gyro Y exceeded ±2000 dps: ${sample.gyro.y}`);
    assert.ok(sample.gyro.z >= -2000.0 && sample.gyro.z <= 2000.0, `Gyro Z exceeded ±2000 dps: ${sample.gyro.z}`);
  });

  // 6. Deterministic Reproducibility with identical seed
  test('Same seed produces identical motion and telemetry traces', () => {
    const seed = 12345;

    const v1 = new Vehicle({ index: 0, seed, dryRun: true });
    const v2 = new Vehicle({ index: 0, seed, dryRun: true });

    v1.triggerScenario(SCENARIO_TYPES.FRONTAL_COLLISION);
    v2.triggerScenario(SCENARIO_TYPES.FRONTAL_COLLISION);

    const dt = 0.02;
    const baseTime = 1710000000000;

    for (let step = 0; step < 100; step++) {
      const t1 = v1.tick(dt, baseTime + step * 20);
      const t2 = v2.tick(dt, baseTime + step * 20);

      assert.deepEqual(t1.accel, t2.accel, `Step ${step}: Accel mismatch between identical seeds`);
      assert.deepEqual(t1.gyro, t2.gyro, `Step ${step}: Gyro mismatch between identical seeds`);
      assert.equal(t1.gps.speed, t2.gps.speed, `Step ${step}: Speed mismatch between identical seeds`);
    }
  });
});
