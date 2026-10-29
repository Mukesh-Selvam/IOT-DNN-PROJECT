// server/src/utils/features.js
// Reusable sensor window feature extraction engine (mirrored in Phase 4 Python ML service)

/**
 * Calculates Euclidean magnitude of a 3-axis vector
 */
export function magnitude(x = 0, y = 0, z = 0) {
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Extracts statistical and kinematic features from a raw telemetry window
 * @param {Array<Object>} window Array of raw sensor points:
 *        [{ ts, ax, ay, az, gx, gy, gz, speed }, ...]
 * @returns {Object} Engineered feature dictionary
 */
export function extractWindowFeatures(window = []) {
  if (!window || window.length === 0) {
    return {
      count: 0,
      peakG: 0,
      meanTotalG: 0,
      rmsTotalG: 0,
      stdTotalG: 0,
      maxJerkGPerS: 0,
      speedInitial: 0,
      speedFinal: 0,
      speedDelta: 0,
      speedDropRatio: 0,
      maxGyroDps: 0,
      meanGyroDps: 0,
      peakIndex: -1,
      peakTimestamp: null,
    };
  }

  const N = window.length;
  let peakG = 0;
  let peakIndex = -1;
  let peakTimestamp = null;

  let sumMagA = 0;
  let sumSqMagA = 0;

  let sumAx = 0;
  let sumAy = 0;
  let sumAz = 0;

  let maxJerkGPerS = 0;
  let maxGyroDps = 0;
  let sumGyroDps = 0;

  const magnitudesA = new Array(N);

  for (let i = 0; i < N; i++) {
    const pt = window[i];
    const ax = pt.ax ?? pt.accel?.x ?? 0;
    const ay = pt.ay ?? pt.accel?.y ?? 0;
    const az = pt.az ?? pt.accel?.z ?? 0;

    const gx = pt.gx ?? pt.gyro?.x ?? 0;
    const gy = pt.gy ?? pt.gyro?.y ?? 0;
    const gz = pt.gz ?? pt.gyro?.z ?? 0;

    const magA = magnitude(ax, ay, az);
    magnitudesA[i] = magA;

    sumMagA += magA;
    sumSqMagA += magA * magA;

    sumAx += ax;
    sumAy += ay;
    sumAz += az;

    if (magA > peakG) {
      peakG = magA;
      peakIndex = i;
      peakTimestamp = pt.ts;
    }

    const magG = magnitude(gx, gy, gz);
    if (magG > maxGyroDps) maxGyroDps = magG;
    sumGyroDps += magG;

    // Jerk calculation (derivative of acceleration)
    if (i > 0) {
      const prevPt = window[i - 1];
      const dt = Math.max(0.001, ((pt.ts || 0) - (prevPt.ts || 0)) / 1000);
      const prevMagA = magnitudesA[i - 1];
      const jerk = Math.abs(magA - prevMagA) / dt;
      if (jerk > maxJerkGPerS) maxJerkGPerS = jerk;
    }
  }

  const meanTotalG = sumMagA / N;
  const rmsTotalG = Math.sqrt(sumSqMagA / N);

  // Variance & Standard Deviation
  let varSum = 0;
  for (let i = 0; i < N; i++) {
    const diff = magnitudesA[i] - meanTotalG;
    varSum += diff * diff;
  }
  const stdTotalG = Math.sqrt(varSum / N);

  // Speed dynamics
  const firstPt = window[0];
  const lastPt = window[N - 1];
  const speedInitial = firstPt.speed ?? firstPt.gps?.speed ?? 0;
  const speedFinal = lastPt.speed ?? lastPt.gps?.speed ?? 0;
  const speedDelta = speedInitial - speedFinal;
  const speedDropRatio = speedInitial > 1 ? Math.max(0, (speedInitial - speedFinal) / speedInitial) : 0;

  return {
    count: N,
    peakG: Math.round(peakG * 100) / 100,
    meanTotalG: Math.round(meanTotalG * 100) / 100,
    rmsTotalG: Math.round(rmsTotalG * 100) / 100,
    stdTotalG: Math.round(stdTotalG * 100) / 100,
    meanAx: Math.round((sumAx / N) * 100) / 100,
    meanAy: Math.round((sumAy / N) * 100) / 100,
    meanAz: Math.round((sumAz / N) * 100) / 100,
    maxJerkGPerS: Math.round(maxJerkGPerS * 10) / 10,
    speedInitial: Math.round(speedInitial * 10) / 10,
    speedFinal: Math.round(speedFinal * 10) / 10,
    speedDelta: Math.round(speedDelta * 10) / 10,
    speedDropRatio: Math.round(speedDropRatio * 100) / 100,
    maxGyroDps: Math.round(maxGyroDps * 10) / 10,
    meanGyroDps: Math.round((sumGyroDps / N) * 10) / 10,
    peakIndex,
    peakTimestamp,
  };
}

export default extractWindowFeatures;
