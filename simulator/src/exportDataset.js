// simulator/src/exportDataset.js
// Exports physics-accurate labelled training dataset (>20,000 windows) directly from Virtual ESP32 simulation
// Generates:
// 1. dataset_imbalanced.json (>= 20,000 windows, realistic distribution)
// 2. dataset_balanced.json (balanced 50/50 crash vs normal)
// 3. dataset_hard.json (hard evaluation set: low-G impacts, high pothole amplitudes, 3x noise)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCENARIO_TYPES, ACCIDENT_SCENARIOS, ScenarioRunner } from './scenarios.js';
import { MPU6050Sensor } from './sensors.js';
import { createRNG, randomRange } from './util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function magnitude(x = 0, y = 0, z = 0) {
  return Math.sqrt(x * x + y * y + z * z);
}

export function extractFeatures(window) {
  const N = window.length;
  if (N === 0) return {};

  let peakG = 0;
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
    const magA = magnitude(pt.ax, pt.ay, pt.az);
    magnitudesA[i] = magA;

    sumMagA += magA;
    sumSqMagA += magA * magA;
    sumAx += pt.ax;
    sumAy += pt.ay;
    sumAz += pt.az;

    if (magA > peakG) peakG = magA;

    const magG = magnitude(pt.gx, pt.gy, pt.gz);
    if (magG > maxGyroDps) maxGyroDps = magG;
    sumGyroDps += magG;

    if (i > 0) {
      const prevPt = window[i - 1];
      const dt = Math.max(0.001, (pt.ts - prevPt.ts) / 1000);
      const jerk = Math.abs(magA - magnitudesA[i - 1]) / dt;
      if (jerk > maxJerkGPerS) maxJerkGPerS = jerk;
    }
  }

  const meanTotalG = sumMagA / N;
  const rmsTotalG = Math.sqrt(sumSqMagA / N);

  let varSum = 0;
  for (let i = 0; i < N; i++) {
    const diff = magnitudesA[i] - meanTotalG;
    varSum += diff * diff;
  }
  const stdTotalG = Math.sqrt(varSum / N);

  const speedInitial = window[0].speed || 0;
  const speedFinal = window[N - 1].speed || 0;
  const speedDelta = speedInitial - speedFinal;
  const speedDropRatio = speedInitial > 1 ? Math.max(0, (speedInitial - speedFinal) / speedInitial) : 0;

  return {
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
  };
}

/**
 * Generates continuous runs and extracts sliding windows
 */
export function generateLargeSimulationDataset({ targetWindows = 20500, sampleRateHz = 50 } = {}) {
  const dt = 1 / sampleRateHz;
  const windowSec = 2.0;
  const windowPoints = Math.round(windowSec * sampleRateHz); // 100 points
  const stepPoints = Math.round(windowPoints * 0.5); // 50 points (50% overlap -> 1.0s advance)

  const scenariosList = [
    // Non-accidents (higher weight for realistic natural driving distribution)
    { type: SCENARIO_TYPES.NORMAL, weight: 8, isAccident: false },
    { type: SCENARIO_TYPES.HARD_BRAKING, weight: 3, isAccident: false },
    { type: SCENARIO_TYPES.SHARP_TURN, weight: 3, isAccident: false },
    { type: SCENARIO_TYPES.POTHOLE, weight: 4, isAccident: false },
    // Accidents
    { type: SCENARIO_TYPES.FRONTAL_COLLISION, weight: 3, isAccident: true },
    { type: SCENARIO_TYPES.SIDE_IMPACT, weight: 3, isAccident: true },
    { type: SCENARIO_TYPES.ROLLOVER, weight: 3, isAccident: true },
    { type: SCENARIO_TYPES.REAR_END, weight: 3, isAccident: true },
  ];

  const totalWeight = scenariosList.reduce((acc, s) => acc + s.weight, 0);

  const allWindows = [];
  const hardWindows = [];
  const scenarioCounts = {};
  for (const s of scenariosList) scenarioCounts[s.type] = 0;

  let runIndex = 0;
  console.log(`[Dataset Export] Generating >= ${targetWindows} windows (2s window, 50% overlap)...`);

  while (allWindows.length < targetWindows) {
    runIndex++;
    // Pick scenario based on weights
    const rng = createRNG(runIndex * 997 + 42);
    let rVal = rng() * totalWeight;
    let chosen = scenariosList[0];
    for (const sc of scenariosList) {
      if (rVal < sc.weight) {
        chosen = sc;
        break;
      }
      rVal -= sc.weight;
    }

    const scenarioName = chosen.type;
    const isAccident = chosen.isAccident;
    const runId = `RUN_${scenarioName.toUpperCase()}_${String(runIndex).padStart(5, '0')}`;

    // Noise level variation: 0.5x to 3.0x
    const noiseLevel = Math.round((0.5 + rng() * 2.5) * 10) / 10;
    // Cruise speed variation: 25 km/h to 110 km/h
    const cruiseSpeed = Math.round(25 + rng() * 85);

    const runner = new ScenarioRunner(rng);
    const imu = new MPU6050Sensor({ deviceId: `ESP32-${runIndex}`, rng, noiseScale: noiseLevel });

    // Duration: 10.0 to 14.0 seconds of simulation
    const runDurationSec = 10.0 + (rng() * 4.0);
    const totalTicks = Math.round(runDurationSec * sampleRateHz);

    // If accident scenario, trigger crash between 3.0s and 5.0s
    // If non-accident event, trigger event between 3.0s and 5.0s
    const triggerAtSec = 3.0 + rng() * 2.0;
    let hasTriggered = false;

    let currentSpeed = cruiseSpeed;
    const runSamples = [];
    const baseTs = 1710000000000 + runIndex * 60000;

    for (let tick = 0; tick < totalTicks; tick++) {
      const curTimeSec = tick * dt;

      if (!hasTriggered && curTimeSec >= triggerAtSec) {
        runner.trigger(scenarioName);
        hasTriggered = true;
      }

      const { dynamicState, targetSpeedKmH } = runner.step(dt, currentSpeed, cruiseSpeed);
      currentSpeed = targetSpeedKmH;

      const imuSample = imu.sample(dynamicState, currentSpeed, dt);
      runSamples.push({
        ts: baseTs + Math.round(curTimeSec * 1000),
        timeSec: curTimeSec,
        ax: imuSample.accel.x,
        ay: imuSample.accel.y,
        az: imuSample.accel.z,
        gx: imuSample.gyro.x,
        gy: imuSample.gyro.y,
        gz: imuSample.gyro.z,
        speed: currentSpeed,
      });
    }

    // Slice run samples into sliding windows (2s = 100 samples, 50-step advance)
    for (let start = 0; start + windowPoints <= runSamples.length; start += stepPoints) {
      const windowSlice = runSamples.slice(start, start + windowPoints);
      const windowStartSec = windowSlice[0].timeSec;
      const windowEndSec = windowSlice[windowSlice.length - 1].timeSec;

      const feat = extractFeatures(windowSlice);

      let label = 0;
      if (isAccident) {
        const actualImpactSec = triggerAtSec + (scenarioName === 'frontal_collision' ? (runner.params?.preBrakeSec || 0.45) : 0);
        const impactStart = actualImpactSec - 0.2;
        const impactEnd = actualImpactSec + (scenarioName === 'rollover' ? 2.5 : 1.5);
        const overlaps = Math.max(windowStartSec, impactStart) <= Math.min(windowEndSec, impactEnd);
        const containsImpactDynamics = (actualImpactSec >= windowStartSec && actualImpactSec <= windowEndSec) ||
                                       (windowStartSec <= actualImpactSec + (scenarioName === 'rollover' ? 1.8 : 0.6) && (feat.speedDropRatio > 0.25 || feat.peakG >= 2.4 || feat.maxGyroDps >= 45));
        if (overlaps && containsImpactDynamics) {
          label = 1;
        }
      }

      const windowRow = {
        run_id: runId,
        scenario: scenarioName,
        label,
        noise_level: noiseLevel,
        ...feat,
      };

      allWindows.push(windowRow);
      scenarioCounts[scenarioName]++;

      if (allWindows.length >= targetWindows) break;
    }
  }

  // ---------------------------------------------------------------------------
  // Generate HARD Evaluation Set (3,000 windows)
  // Hard cases: impact amplitude 0.5x to 1.5x, pothole amplitude up to 1.3x,
  // potholes combined with hard braking, crashes at low speed, noise 3x.
  // ---------------------------------------------------------------------------
  console.log(`[Dataset Export] Generating HARD evaluation set (3,000 windows)...`);
  let hardRunIdx = 0;
  while (hardWindows.length < 3000) {
    hardRunIdx++;
    const rng = createRNG(hardRunIdx * 883 + 9999);
    const hardScenarios = [
      SCENARIO_TYPES.POTHOLE,
      SCENARIO_TYPES.HARD_BRAKING,
      SCENARIO_TYPES.FRONTAL_COLLISION,
      SCENARIO_TYPES.SIDE_IMPACT,
      SCENARIO_TYPES.ROLLOVER,
      SCENARIO_TYPES.REAR_END,
    ];
    const scenarioName = hardScenarios[hardRunIdx % hardScenarios.length];
    const isAccident = ACCIDENT_SCENARIOS.has(scenarioName);
    const runId = `HARD_${scenarioName.toUpperCase()}_${String(hardRunIdx).padStart(4, '0')}`;

    // Extreme noise level: 2.5x to 3.5x
    const noiseLevel = Math.round((2.5 + rng() * 1.0) * 10) / 10;
    // Low speeds for crashes (15 to 35 km/h) to create challenging low-deceleration crashes
    const cruiseSpeed = isAccident ? Math.round(15 + rng() * 20) : Math.round(40 + rng() * 40);

    // Amplitude scaling: 0.5x to 1.5x for crashes, 1.0x to 1.3x for potholes
    const ampScale = isAccident ? (0.5 + rng() * 1.0) : (1.0 + rng() * 0.3);

    const runner = new ScenarioRunner(rng);
    const imu = new MPU6050Sensor({ deviceId: `ESP32-HARD-${hardRunIdx}`, rng, noiseScale: noiseLevel });

    const totalTicks = Math.round(8.0 * sampleRateHz);
    const triggerAtSec = 2.5;
    let hasTriggered = false;

    let currentSpeed = cruiseSpeed;
    const runSamples = [];
    const baseTs = 1720000000000 + hardRunIdx * 60000;

    for (let tick = 0; tick < totalTicks; tick++) {
      const curTimeSec = tick * dt;

      if (!hasTriggered && curTimeSec >= triggerAtSec) {
        runner.trigger(scenarioName);
        hasTriggered = true;
      }

      const { dynamicState, targetSpeedKmH } = runner.step(dt, currentSpeed, cruiseSpeed);
      currentSpeed = targetSpeedKmH;

      // Scale dynamic forces by ampScale
      const scaledDynamics = {
        ...dynamicState,
        ax: (dynamicState.ax || 0) * ampScale,
        ay: (dynamicState.ay || 0) * ampScale,
        az: (dynamicState.az || 0) * ampScale,
        gx: (dynamicState.gx || 0) * ampScale,
        gy: (dynamicState.gy || 0) * ampScale,
        gz: (dynamicState.gz || 0) * ampScale,
      };

      const imuSample = imu.sample(scaledDynamics, currentSpeed, dt);
      runSamples.push({
        ts: baseTs + Math.round(curTimeSec * 1000),
        timeSec: curTimeSec,
        ax: imuSample.accel.x,
        ay: imuSample.accel.y,
        az: imuSample.accel.z,
        gx: imuSample.gyro.x,
        gy: imuSample.gyro.y,
        gz: imuSample.gyro.z,
        speed: currentSpeed,
      });
    }

    for (let start = 0; start + windowPoints <= runSamples.length; start += stepPoints) {
      const windowSlice = runSamples.slice(start, start + windowPoints);
      const windowStartSec = windowSlice[0].timeSec;
      const windowEndSec = windowSlice[windowSlice.length - 1].timeSec;

      const feat = extractFeatures(windowSlice);
      let label = 0;
      if (isAccident) {
        const actualImpactSec = triggerAtSec + (scenarioName === 'frontal_collision' ? (runner.params?.preBrakeSec || 0.45) : 0);
        const impactStart = actualImpactSec - 0.2;
        const impactEnd = actualImpactSec + (scenarioName === 'rollover' ? 2.5 : 1.5);
        const overlaps = Math.max(windowStartSec, impactStart) <= Math.min(windowEndSec, impactEnd);
        const containsImpactDynamics = (actualImpactSec >= windowStartSec && actualImpactSec <= windowEndSec) ||
                                       (windowStartSec <= actualImpactSec + (scenarioName === 'rollover' ? 1.8 : 0.6) && (feat.speedDropRatio > 0.25 || feat.peakG >= 2.0 || feat.maxGyroDps >= 40));
        if (overlaps && containsImpactDynamics) {
          label = 1;
        }
      }

      hardWindows.push({
        run_id: runId,
        scenario: scenarioName,
        label,
        noise_level: noiseLevel,
        amplitude_scale: Math.round(ampScale * 100) / 100,
        ...feat,
      });

      if (hardWindows.length >= 3000) break;
    }
  }

  // ---------------------------------------------------------------------------
  // Build balanced dataset (50% crash, 50% non-crash)
  // ---------------------------------------------------------------------------
  const accidents = allWindows.filter((w) => w.label === 1);
  const nonAccidents = allWindows.filter((w) => w.label === 0);
  const minCount = Math.min(accidents.length, nonAccidents.length);

  // Subsample non-accidents evenly
  const balancedWindows = [
    ...accidents.slice(0, minCount),
    ...nonAccidents.slice(0, minCount),
  ];

  // ---------------------------------------------------------------------------
  // Partition by unique run_id (70% train, 15% val, 15% test) with zero leakage
  // ---------------------------------------------------------------------------
  const uniqueRuns = Array.from(new Set(allWindows.map((w) => w.run_id)));
  const nRuns = uniqueRuns.length;
  const nTrain = Math.floor(0.70 * nRuns);
  const nVal = Math.floor(0.15 * nRuns);

  const trainRunSet = new Set(uniqueRuns.slice(0, nTrain));
  const valRunSet = new Set(uniqueRuns.slice(nTrain, nTrain + nVal));
  const testRunSet = new Set(uniqueRuns.slice(nTrain + nVal));

  // Verify zero overlap across splits
  for (const r of trainRunSet) {
    if (valRunSet.has(r) || testRunSet.has(r)) {
      throw new Error(`Data leakage detected: run_id ${r} appears in multiple splits!`);
    }
  }
  for (const r of valRunSet) {
    if (testRunSet.has(r)) {
      throw new Error(`Data leakage detected: run_id ${r} appears in val and test!`);
    }
  }

  const trainWindows = allWindows.filter((w) => trainRunSet.has(w.run_id));
  const valWindows = allWindows.filter((w) => valRunSet.has(w.run_id));
  const testWindows = allWindows.filter((w) => testRunSet.has(w.run_id));

  return {
    imbalanced: allWindows,
    balanced: balancedWindows,
    hard: hardWindows,
    scenarioCounts,
    splits: {
      train: trainWindows,
      val: valWindows,
      test: testWindows,
      runCounts: {
        total: nRuns,
        train: trainRunSet.size,
        val: valRunSet.size,
        test: testRunSet.size,
      },
      windowCounts: {
        total: allWindows.length,
        train: trainWindows.length,
        val: valWindows.length,
        test: testWindows.length,
      },
    },
  };
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = generateLargeSimulationDataset({ targetWindows: 20500 });
  const outDirSim = path.resolve(__dirname, '../data');
  const outDirML = path.resolve(__dirname, '../../ml-service/data');

  fs.mkdirSync(outDirSim, { recursive: true });
  fs.mkdirSync(outDirML, { recursive: true });

  const imbalancedPath = path.join(outDirSim, 'dataset_imbalanced.json');
  const balancedPath = path.join(outDirSim, 'dataset_balanced.json');
  const hardPath = path.join(outDirSim, 'dataset_hard.json');
  const splitsMetaPath = path.join(outDirSim, 'dataset_splits.json');

  fs.writeFileSync(imbalancedPath, JSON.stringify(result.imbalanced));
  fs.writeFileSync(balancedPath, JSON.stringify(result.balanced));
  fs.writeFileSync(hardPath, JSON.stringify(result.hard));
  fs.writeFileSync(
    splitsMetaPath,
    JSON.stringify({
      windowCounts: result.splits.windowCounts,
      runCounts: result.splits.runCounts,
    }, null, 2)
  );

  // Mirror to ml-service/data
  fs.writeFileSync(path.join(outDirML, 'dataset_imbalanced.json'), JSON.stringify(result.imbalanced));
  fs.writeFileSync(path.join(outDirML, 'dataset_balanced.json'), JSON.stringify(result.balanced));
  fs.writeFileSync(path.join(outDirML, 'dataset_hard.json'), JSON.stringify(result.hard));
  fs.writeFileSync(
    path.join(outDirML, 'dataset_splits.json'),
    JSON.stringify({
      windowCounts: result.splits.windowCounts,
      runCounts: result.splits.runCounts,
    }, null, 2)
  );
  // Backward compatibility alias
  fs.writeFileSync(path.join(outDirML, 'simulator_dataset.json'), JSON.stringify(result.imbalanced));

  const total = result.imbalanced.length;
  const accCount = result.imbalanced.filter((r) => r.label === 1).length;
  const nonAccCount = result.imbalanced.filter((r) => r.label === 0).length;

  console.log('\n======================================================');
  console.log('DATASET EXPORT COMPLETE & VERIFIED');
  console.log('======================================================');
  console.log(`Total Imbalanced Windows : ${total}`);
  console.log(`  Accident Windows       : ${accCount} (${((accCount / total) * 100).toFixed(1)}%)`);
  console.log(`  Non-Accident Windows   : ${nonAccCount} (${((nonAccCount / total) * 100).toFixed(1)}%)`);
  console.log(`Total Balanced Windows   : ${result.balanced.length}`);
  console.log(`Total Hard Set Windows   : ${result.hard.length}`);
  console.log('\nScenario Distribution (Windows):');
  for (const [sc, count] of Object.entries(result.scenarioCounts)) {
    console.log(`  - ${sc.padEnd(20)}: ${count}`);
  }
  console.log('\nTrain / Val / Test Split Breakdown (Grouped by run_id):');
  console.log(`  - Train Set : ${result.splits.windowCounts.train} windows (${result.splits.runCounts.train} runs, ${((result.splits.windowCounts.train / total) * 100).toFixed(1)}%)`);
  console.log(`  - Val Set   : ${result.splits.windowCounts.val} windows (${result.splits.runCounts.val} runs, ${((result.splits.windowCounts.val / total) * 100).toFixed(1)}%)`);
  console.log(`  - Test Set  : ${result.splits.windowCounts.test} windows (${result.splits.runCounts.test} runs, ${((result.splits.windowCounts.test / total) * 100).toFixed(1)}%)`);
  console.log('  - Run Leakage: 0 overlapping run_id between Train, Val, and Test splits [VERIFIED]');
  console.log('======================================================\n');
}
