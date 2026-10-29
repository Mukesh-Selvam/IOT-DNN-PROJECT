// simulator/src/exportDomainShift.js
// Generates a domain-shifted evaluation dataset from a perturbed simulator:
// - Impact duration +-30%
// - Ringing frequencies (damped oscillatory chassis resonance at 25 Hz)
// - Sensor bias (accel +-0.25g, gyro +-12 deg/s) & extreme noise (3.5x to 5.0x)
// - Unseen cruise speeds (15-25 km/h city crawl, 90-120 km/h highway)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCENARIO_TYPES, ACCIDENT_SCENARIOS, ScenarioRunner } from './scenarios.js';
import { MPU6050Sensor } from './sensors.js';
import { createRNG, randomRange } from './util.js';
import { extractFeatures } from './exportDataset.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOMAIN_SHIFT_CONFIG = {
  numWindows: 3000,
  windowDurationSec: 2.0,
  strideSec: 1.0,
  sampleRateHz: 50,
  noiseScaleMin: 3.5,
  noiseScaleMax: 5.0,
  speedMinKmh: 15.0,
  speedMaxKmh: 115.0,
  durationScaleMin: 0.70, // -30%
  durationScaleMax: 1.30, // +30%
  ringingFreqHz: 25.0,   // Damped mechanical ringing
};

export function generateDomainShiftDataset(options = {}) {
  const config = { ...DOMAIN_SHIFT_CONFIG, ...options };
  const rng = createRNG(98765);
  const windows = [];

  const scenariosList = [
    { type: SCENARIO_TYPES.NORMAL, isAccident: false },
    { type: SCENARIO_TYPES.HARD_BRAKING, isAccident: false },
    { type: SCENARIO_TYPES.SHARP_TURN, isAccident: false },
    { type: SCENARIO_TYPES.POTHOLE, isAccident: false },
    { type: SCENARIO_TYPES.FRONTAL_COLLISION, isAccident: true },
    { type: SCENARIO_TYPES.SIDE_IMPACT, isAccident: true },
    { type: SCENARIO_TYPES.ROLLOVER, isAccident: true },
    { type: SCENARIO_TYPES.REAR_END, isAccident: true },
  ];

  console.log(`[Domain-Shift Export] Generating ${config.numWindows} perturbed windows...`);
  let runIndex = 0;
  const dt = 1.0 / config.sampleRateHz;
  const windowPoints = Math.round(config.windowDurationSec * config.sampleRateHz);
  const stepPoints = Math.round(config.strideSec * config.sampleRateHz);

  while (windows.length < config.numWindows) {
    runIndex++;
    const chosen = scenariosList[runIndex % scenariosList.length];
    const scenarioName = chosen.type;
    const isAccident = chosen.isAccident;
    const runId = `RUN_DS_${scenarioName.toUpperCase()}_${String(runIndex).padStart(5, '0')}`;

    const noiseScale = randomRange(rng, config.noiseScaleMin, config.noiseScaleMax);
    const cruiseSpeed = randomRange(rng, config.speedMinKmh, config.speedMaxKmh);
    const durationScale = randomRange(rng, config.durationScaleMin, config.durationScaleMax);

    // Sensor bias
    const biasAx = randomRange(rng, -0.25, 0.25);
    const biasAy = randomRange(rng, -0.25, 0.25);
    const biasAz = randomRange(rng, -0.20, 0.20);
    const biasGx = randomRange(rng, -12.0, 12.0);
    const biasGy = randomRange(rng, -12.0, 12.0);
    const biasGz = randomRange(rng, -12.0, 12.0);

    const runner = new ScenarioRunner(rng);
    const imu = new MPU6050Sensor({ deviceId: `ESP32-DS-${runIndex}`, rng, noiseScale });

    const runDurationSec = 10.0 + rng() * 4.0;
    const totalTicks = Math.round(runDurationSec * config.sampleRateHz);
    const triggerAtSec = 3.0 + rng() * 2.0;
    let hasTriggered = false;
    let currentSpeed = cruiseSpeed;
    const runSamples = [];
    const baseTs = 1720000000000 + runIndex * 60000;
    let impactTimeSec = null;

    for (let tick = 0; tick < totalTicks; tick++) {
      const curTimeSec = tick * dt;

      if (!hasTriggered && curTimeSec >= triggerAtSec) {
        runner.trigger(scenarioName);
        // Perturb duration +-30%
        if (runner.params?.impactDuration) {
          runner.params.impactDuration *= durationScale;
        }
        if (runner.params?.rollDuration) {
          runner.params.rollDuration *= durationScale;
        }
        hasTriggered = true;
        if (isAccident) {
          impactTimeSec = curTimeSec + (scenarioName === 'frontal_collision' ? (runner.params?.preBrakeSec || 0.45) : 0);
        }
      }

      const { dynamicState, targetSpeedKmH } = runner.step(dt, currentSpeed, cruiseSpeed);
      currentSpeed = targetSpeedKmH;

      // Add mechanical ringing if post-impact
      let ringAx = 0;
      let ringAy = 0;
      if (impactTimeSec !== null && curTimeSec >= impactTimeSec) {
        const tau = curTimeSec - impactTimeSec;
        const decay = Math.exp(-tau * 8.0);
        const ring = Math.sin(2 * Math.PI * config.ringingFreqHz * tau) * decay;
        ringAx = ring * 1.5;
        ringAy = ring * 1.0;
      }

      const imuSample = imu.sample(dynamicState, currentSpeed, dt);

      runSamples.push({
        ts: baseTs + Math.round(curTimeSec * 1000),
        timeSec: curTimeSec,
        ax: imuSample.accel.x + biasAx + ringAx,
        ay: imuSample.accel.y + biasAy + ringAy,
        az: imuSample.accel.z + biasAz,
        gx: imuSample.gyro.x + biasGx,
        gy: imuSample.gyro.y + biasGy,
        gz: imuSample.gyro.z + biasGz,
        speed: currentSpeed,
      });
    }

    // Slice into sliding windows
    for (let start = 0; start + windowPoints <= runSamples.length; start += stepPoints) {
      if (windows.length >= config.numWindows) break;
      const windowSlice = runSamples.slice(start, start + windowPoints);
      const windowStartSec = windowSlice[0].timeSec;
      const windowEndSec = windowSlice[windowSlice.length - 1].timeSec;

      const feat = extractFeatures(windowSlice);

      let label = 0;
      if (isAccident && impactTimeSec !== null) {
        const impactStart = impactTimeSec - 0.2;
        const impactEnd = impactTimeSec + (scenarioName === 'rollover' ? 2.5 : 1.5);
        const overlaps = Math.max(windowStartSec, impactStart) <= Math.min(windowEndSec, impactEnd);
        const containsImpactDynamics = (impactTimeSec >= windowStartSec && impactTimeSec <= windowEndSec) ||
                                       (windowStartSec <= impactTimeSec + (scenarioName === 'rollover' ? 1.8 : 0.6) && (feat.speedDropRatio > 0.25 || feat.peakG >= 2.4 || feat.maxGyroDps >= 45));
        if (overlaps && containsImpactDynamics) {
          label = 1;
        }
      }

      windows.push({
        scenario: scenarioName,
        run_id: runId,
        label,
        noise_scale: round(noiseScale, 2),
        cruise_speed_kmh: round(cruiseSpeed, 1),
        duration_scale: round(durationScale, 2),
        features: feat,
      });
    }
  }

  const outDir = path.resolve(__dirname, '../data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, 'dataset_domain_shift.json');
  fs.writeFileSync(outFile, JSON.stringify(windows, null, 2));

  // Copy to ml-service/data
  const mlDir = path.resolve(__dirname, '../../ml-service/data');
  if (fs.existsSync(mlDir)) {
    fs.writeFileSync(path.join(mlDir, 'dataset_domain_shift.json'), JSON.stringify(windows, null, 2));
  }

  const numAccidents = windows.filter((w) => w.label === 1).length;
  console.log(`[Domain-Shift Export] Completed: ${windows.length} windows (${numAccidents} accident, ${windows.length - numAccidents} non-accident)`);
  return windows;
}

function round(val, dec = 2) {
  const p = Math.pow(10, dec);
  return Math.round(val * p) / p;
}

if (process.argv[1] && process.argv[1].endsWith('exportDomainShift.js')) {
  generateDomainShiftDataset();
}
