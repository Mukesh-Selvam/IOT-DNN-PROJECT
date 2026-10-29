// simulator/src/sensors.js
// Physical MPU6050 (6-DoF IMU) and GPS u-blox Neo-6M sensor emulation models

import { addGPSJitter } from './geo.js';
import { clamp, quantize, randomGaussian, randomRange, roundTo } from './util.js';

const G_ACCEL = 1.0; // 1.0 g gravity vector
const MPU6050_ACCEL_LSB_PER_G = 2048; // ±16g range: 2^16 / 32 ≈ 2048 LSB/g
const MPU6050_GYRO_LSB_PER_DPS = 16.384; // ±2000 deg/s range: 2^16 / 4000 ≈ 16.384 LSB/dps
const MAX_ACCEL_G = 16.0;
const MAX_GYRO_DPS = 2000.0;

export class MPU6050Sensor {
  /**
   * @param {Object} options
   * @param {string} options.deviceId Device identifier
   * @param {Function} options.rng Seeded random number generator
   * @param {number} options.noiseScale User noise multiplier
   */
  constructor({ deviceId, rng = Math.random, noiseScale = 1.0 }) {
    this.deviceId = deviceId;
    this.rng = rng;
    this.noiseScale = noiseScale;

    // Per-device hardware bias offsets (typical MEMS manufacturing tolerances)
    this.accelBias = {
      x: randomRange(this.rng, -0.02, 0.02),
      y: randomRange(this.rng, -0.02, 0.02),
      z: randomRange(this.rng, -0.03, 0.03),
    };
    this.gyroBias = {
      x: randomRange(this.rng, -0.8, 0.8),
      y: randomRange(this.rng, -0.8, 0.8),
      z: randomRange(this.rng, -0.8, 0.8),
    };

    // Low-frequency chassis vibration phase tracking
    this.phase = randomRange(this.rng, 0, Math.PI * 2);
  }

  setNoiseScale(scale) {
    if (typeof scale === 'number' && scale >= 0) {
      this.noiseScale = scale;
    }
  }

  /**
   * Sample the MPU6050 at a specific instant
   * @param {Object} dynamicState Motion dynamics from active scenario or vehicle state
   * @param {number} speedKmH Current vehicle speed
   * @param {number} dt Delta time in seconds (e.g. 0.02s for 50Hz)
   * @returns {{ accel: { x: number, y: number, z: number }, gyro: { x: number, y: number, z: number } }}
   */
  sample(dynamicState, speedKmH = 0, dt = 0.02) {
    this.phase += dt * 15; // chassis harmonic progression

    // 1. Baseline speed-dependent road vibration
    // Parked car (speed ~ 0) is almost silent; cruising car has realistic engine/asphalt vibration
    const speedRatio = clamp(speedKmH / 60, 0, 1.5);
    const vibrationStdDev = (0.015 + 0.045 * speedRatio) * this.noiseScale;
    const gyroVibrationStdDev = (0.2 + 0.8 * speedRatio) * this.noiseScale;

    // Sensor white Gaussian noise
    const noiseAx = randomGaussian(this.rng, 0, vibrationStdDev);
    const noiseAy = randomGaussian(this.rng, 0, vibrationStdDev);
    const noiseAz = randomGaussian(this.rng, 0, vibrationStdDev * 1.2); // Z has higher suspension bounce

    const noiseGx = randomGaussian(this.rng, 0, gyroVibrationStdDev);
    const noiseGy = randomGaussian(this.rng, 0, gyroVibrationStdDev);
    const noiseGz = randomGaussian(this.rng, 0, gyroVibrationStdDev);

    // Subtle chassis roll/pitch drift while moving
    const chassisPitch = speedKmH > 2 ? Math.sin(this.phase * 0.7) * 0.015 * speedRatio : 0;
    const chassisRoll = speedKmH > 2 ? Math.cos(this.phase * 0.5) * 0.012 * speedRatio : 0;

    // 2. Dynamic state from physics / scenario
    const dynAx = dynamicState.ax ?? 0;
    const dynAy = dynamicState.ay ?? 0;
    const dynAz = dynamicState.az ?? 0;

    const dynGx = dynamicState.gx ?? 0;
    const dynGy = dynamicState.gy ?? 0;
    const dynGz = dynamicState.gz ?? 0;

    // Gravity vector:
    // Standard resting car has gravity: ax = 0, ay = 0, az = +1.0g
    // If the scenario models orientation/tilt (e.g. rollover), dynamicState provides gravity vector override
    const gravX = dynamicState.gravityX ?? 0;
    const gravY = dynamicState.gravityY ?? 0;
    const gravZ = dynamicState.gravityZ ?? G_ACCEL;

    // 3. Aggregate forces
    let rawAx = dynAx + gravX + chassisPitch + this.accelBias.x + noiseAx;
    let rawAy = dynAy + gravY + chassisRoll + this.accelBias.y + noiseAy;
    let rawAz = dynAz + gravZ + this.accelBias.z + noiseAz;

    let rawGx = dynGx + this.gyroBias.x + noiseGx;
    let rawGy = dynGy + this.gyroBias.y + noiseGy;
    let rawGz = dynGz + this.gyroBias.z + noiseGz;

    // 4. Hardware saturation clipping (±16g, ±2000 deg/s)
    rawAx = clamp(rawAx, -MAX_ACCEL_G, MAX_ACCEL_G);
    rawAy = clamp(rawAy, -MAX_ACCEL_G, MAX_ACCEL_G);
    rawAz = clamp(rawAz, -MAX_ACCEL_G, MAX_ACCEL_G);

    rawGx = clamp(rawGx, -MAX_GYRO_DPS, MAX_GYRO_DPS);
    rawGy = clamp(rawGy, -MAX_GYRO_DPS, MAX_GYRO_DPS);
    rawGz = clamp(rawGz, -MAX_GYRO_DPS, MAX_GYRO_DPS);

    // 5. 16-bit ADC Quantization
    const qAx = quantize(rawAx, MPU6050_ACCEL_LSB_PER_G);
    const qAy = quantize(rawAy, MPU6050_ACCEL_LSB_PER_G);
    const qAz = quantize(rawAz, MPU6050_ACCEL_LSB_PER_G);

    const qGx = quantize(rawGx, MPU6050_GYRO_LSB_PER_DPS);
    const qGy = quantize(rawGy, MPU6050_GYRO_LSB_PER_DPS);
    const qGz = quantize(rawGz, MPU6050_GYRO_LSB_PER_DPS);

    return {
      accel: {
        x: roundTo(qAx, 4),
        y: roundTo(qAy, 4),
        z: roundTo(qAz, 4),
      },
      gyro: {
        x: roundTo(qGx, 2),
        y: roundTo(qGy, 2),
        z: roundTo(qGz, 2),
      },
    };
  }
}

export class GPSSensor {
  /**
   * @param {Object} options
   * @param {string} options.deviceId Device identifier
   * @param {Function} options.rng Seeded random number generator
   * @param {number} options.noiseScale User noise multiplier
   */
  constructor({ deviceId, rng = Math.random, noiseScale = 1.0 }) {
    this.deviceId = deviceId;
    this.rng = rng;
    this.noiseScale = noiseScale;

    this.lastFixTime = 0;
    this.currentFix = null;
    this.satellites = Math.floor(randomRange(this.rng, 9, 12));
    this.hdop = roundTo(randomRange(this.rng, 0.85, 1.25), 2);
    this.lastHeading = 0;
  }

  setNoiseScale(scale) {
    if (typeof scale === 'number' && scale >= 0) {
      this.noiseScale = scale;
    }
  }

  /**
   * Updates GPS fix at 1 Hz intervals, interpolating between route waypoints
   * @param {Object} rawPos True interpolated position { lat, lng, heading }
   * @param {number} speedKmH True vehicle speed in km/h
   * @param {number} currentTimeMs Current simulation timestamp
   * @returns {Object} GPS fix object
   */
  update(rawPos, speedKmH, currentTimeMs) {
    // Only update fix if 1000 ms elapsed or first fix
    if (!this.currentFix || currentTimeMs - this.lastFixTime >= 1000) {
      this.lastFixTime = currentTimeMs;

      // Realistic ~1.5m position jitter
      const jitterLat = randomGaussian(this.rng, 0, 1.5 * this.noiseScale);
      const jitterLng = randomGaussian(this.rng, 0, 1.5 * this.noiseScale);
      const noisyCoord = addGPSJitter(rawPos.lat, rawPos.lng, jitterLat, jitterLng);

      // Speed clamp: parked car reports exactly 0 km/h
      const clampedSpeed = speedKmH < 0.8 ? 0 : roundTo(speedKmH + randomGaussian(this.rng, 0, 0.3 * this.noiseScale), 1);

      // Heading: hold previous heading when vehicle is stopped
      if (clampedSpeed > 1.0 && rawPos.heading !== undefined) {
        this.lastHeading = roundTo((rawPos.heading + 360) % 360, 1);
      }

      // Fluctuating satellite visibility
      if (this.rng() < 0.1) {
        this.satellites = clamp(this.satellites + (this.rng() > 0.5 ? 1 : -1), 8, 12);
        this.hdop = roundTo(clamp(1.8 - this.satellites * 0.08 + randomGaussian(this.rng, 0, 0.05), 0.8, 1.4), 2);
      }

      this.currentFix = {
        lat: roundTo(noisyCoord.lat, 6),
        lng: roundTo(noisyCoord.lng, 6),
        speed: clampedSpeed,
        heading: this.lastHeading,
        satellites: this.satellites,
        hdop: this.hdop,
        fix: 1, // 3D GPS Fix
        ts: Math.floor(currentTimeMs),
      };
    }

    return { ...this.currentFix };
  }
}
