// server/scripts/soak_test.js
// 1-Hour Normal Driving Soak Test through Real Detection Pipeline
// Evaluates 3 vehicles for 1 simulated hour each (3 vehicle-hours total, 10,800 windows)
// Includes normal cruising, potholes, hard braking, and sharp turns.
// Ground truth is strictly OFF. Target: 0 false alarms.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractWindowFeatures } from '../src/utils/features.js';
import { evaluateRuleBased } from '../src/services/ruleEngineService.js';
import { predict } from '../src/services/mlClientService.js';
import { MPU6050Sensor } from '../../simulator/src/sensors.js';
import { ScenarioRunner, SCENARIO_TYPES } from '../../simulator/src/scenarios.js';
import { createRNG, randomRange } from '../../simulator/src/util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSoakTest() {
  console.log('================================================================================');
  console.log('STARTING 3-HOUR REAL DETECTION PIPELINE SOAK TEST (3 VEHICLE-HOURS TOTAL)');
  console.log('================================================================================');

  const VEHICLES = ['ESP32-SOAK-001', 'ESP32-SOAK-002', 'ESP32-SOAK-003'];
  const DURATION_PER_VEHICLE_SEC = 3600; // 1 full hour
  const SAMPLE_RATE_HZ = 50;
  const DT = 1.0 / SAMPLE_RATE_HZ;
  const WINDOW_POINTS = 100; // 2.0s
  const STRIDE_POINTS = 50;  // 1.0s advance
  const PRE_FILTER_G = 2.5;
  const PRE_FILTER_SPEED_DROP = 0.40;
  const PRE_FILTER_GYRO = 120.0;

  let totalWindowsEvaluated = 0;
  let preFilterPassed = 0;
  let preFilterBlocked = 0;
  let mlIncidents = 0;
  let ruleBasedIncidents = 0;
  let eventCounts = { pothole: 0, hard_braking: 0, sharp_turn: 0 };

  const startTime = Date.now();

  for (let vIdx = 0; vIdx < VEHICLES.length; vIdx++) {
    const deviceId = VEHICLES[vIdx];
    const rng = createRNG(424242 + vIdx * 10007);
    console.log(`\n[Soak Test] Simulating 1 hour of driving for ${deviceId}...`);

    let currentSpeed = randomRange(rng, 45, 75);
    const cruiseSpeed = currentSpeed;
    const imu = new MPU6050Sensor({ deviceId, rng, noiseScale: 1.2 });
    let runner = new ScenarioRunner(rng);
    let nextEventSec = randomRange(rng, 10, 25);
    let currentEvent = null;

    const samples = [];
    const totalTicks = DURATION_PER_VEHICLE_SEC * SAMPLE_RATE_HZ;

    for (let tick = 0; tick < totalTicks; tick++) {
      const curTimeSec = tick * DT;

      // Random non-accident event trigger (potholes up to 1.3x, hard braking, sharp turns)
      if (curTimeSec >= nextEventSec && !currentEvent) {
        const events = [SCENARIO_TYPES.POTHOLE, SCENARIO_TYPES.HARD_BRAKING, SCENARIO_TYPES.SHARP_TURN];
        currentEvent = events[Math.floor(rng() * events.length)];
        eventCounts[currentEvent]++;
        runner = new ScenarioRunner(rng);
        const opts = {};
        if (currentEvent === SCENARIO_TYPES.POTHOLE) {
          opts.amplitude = randomRange(rng, 0.9, 1.30); // potholes up to 1.3x amplitude
        }
        runner.trigger(currentEvent, opts);
        nextEventSec = curTimeSec + randomRange(rng, 15, 30);
      }

      const { dynamicState, targetSpeedKmH } = runner.step(DT, currentSpeed, cruiseSpeed);
      currentSpeed = targetSpeedKmH;

      if (runner.phase === 'completed') {
        currentEvent = null;
        runner = new ScenarioRunner(rng);
      }

      const imuSample = imu.sample(dynamicState, currentSpeed, DT);
      // Strictly ground truth OFF - only kinematics and timestamp
      samples.push({
        ts: curTimeSec * 1000,
        ax: imuSample.accel.x,
        ay: imuSample.accel.y,
        az: imuSample.accel.z,
        gx: imuSample.gyro.x,
        gy: imuSample.gyro.y,
        gz: imuSample.gyro.z,
        speed: currentSpeed,
      });

      // Once we have at least 100 points (2.0s), slide every 50 points (1.0s)
      if (samples.length >= WINDOW_POINTS && (samples.length - WINDOW_POINTS) % STRIDE_POINTS === 0) {
        totalWindowsEvaluated++;
        const windowSlice = samples.slice(samples.length - WINDOW_POINTS);
        const feat = extractWindowFeatures(windowSlice);

        // Pre-filter screening check
        const passesPreFilter =
          feat.peakG >= PRE_FILTER_G ||
          feat.speedDropRatio >= PRE_FILTER_SPEED_DROP ||
          feat.maxGyroDps >= PRE_FILTER_GYRO;

        if (!passesPreFilter) {
          preFilterBlocked++;
        } else {
          preFilterPassed++;
          // Window triggered pre-filter - evaluate with real prediction pipeline (ML or Rule Engine fallback)
          const prediction = await predict(deviceId, windowSlice, feat);

          if (prediction && prediction.label === 'ACCIDENT') {
            if (prediction.detectionSource === 'RULE_BASED') {
              ruleBasedIncidents++;
              console.warn(`[FALSE ALARM - RULE] ${deviceId} @ ${curTimeSec.toFixed(1)}s (Peak: ${feat.peakG}g, Event: ${currentEvent})`);
            } else {
              mlIncidents++;
              console.warn(`[FALSE ALARM - ML] ${deviceId} @ ${curTimeSec.toFixed(1)}s (Peak: ${feat.peakG}g, Event: ${currentEvent}, Conf: ${prediction.confidence})`);
            }
          }
        }
      }
    }
  }

  const durationSec = (Date.now() - startTime) / 1000;
  const totalFleetHours = (VEHICLES.length * DURATION_PER_VEHICLE_SEC) / 3600; // 3.0 hours
  const totalIncidents = mlIncidents + ruleBasedIncidents;
  const totalEvents = eventCounts.pothole + eventCounts.hard_braking + eventCounts.sharp_turn;
  const farPerHour = totalIncidents / totalFleetHours;
  // 95% upper bound on false alarm rate using Rule of Three (if 0) or Poisson bound
  const far95UpperBound = totalIncidents === 0
    ? (3.0 / totalFleetHours)
    : (totalIncidents + 1.96 * Math.sqrt(totalIncidents)) / totalFleetHours;

  const resultLog = `
================================================================================
3-HOUR NORMAL DRIVING SOAK TEST RESULTS (REAL PIPELINE, GROUND TRUTH OFF)
================================================================================
Pipeline Mode:                   Real In-Process Pipeline (Features -> Pre-Filter -> DNN / Fallback)
Ground Truth Isolation:          STRICTLY OFF (no meta fields, pure IMU kinematics)
Total Vehicles Monitored:        ${VEHICLES.length}
Driving Time per Vehicle:        ${(DURATION_PER_VEHICLE_SEC / 3600).toFixed(1)} hour(s) (3,600 s each)
Total Monitored Driving Time:    ${totalFleetHours.toFixed(1)} hours (10,800 s total)
Execution Wall Duration:         ${durationSec.toFixed(2)} seconds

WINDOW & SCREENING BREAKDOWN:
  Total 2s Sliding Windows:      ${totalWindowsEvaluated}
  Quiescent Blocked by Filter:   ${preFilterBlocked} (${((preFilterBlocked / totalWindowsEvaluated) * 100).toFixed(2)}%)
  Windows Reaching DNN/Fallback: ${preFilterPassed} (${((preFilterPassed / totalWindowsEvaluated) * 100).toFixed(2)}%)

INJECTED NON-ACCIDENT PERTURBATIONS:
  - Potholes (up to 1.3x amp):   ${eventCounts.pothole}
  - Hard Braking Maneuvers:      ${eventCounts.hard_braking}
  - Sharp Steering Turns:        ${eventCounts.sharp_turn}
  - Total Injected Events:       ${totalEvents} (>= 300 required)

INCIDENTS TRIGGERED:
  - Machine Learning (DNN):      ${mlIncidents}
  - Rule-Based Fallback Engine:  ${ruleBasedIncidents}
  - Total False Alarms:          ${totalIncidents}

STATISTICAL FALSE ALARM RATE (FAR):
  - Point Estimate (FAR/hr):     ${farPerHour.toFixed(4)} incidents / vehicle-hour
  - 95% Upper Bound (FAR/hr):    ${far95UpperBound.toFixed(4)} incidents / vehicle-hour (Rule of Three)
  - Target False Alarms:         0
  - Test Status:                 ${totalIncidents === 0 && totalEvents >= 300 ? 'PASSED (ZERO FALSE ALARMS WITH >300 EVENTS)' : 'FAILED'}
================================================================================
`;

  console.log(resultLog);

  // Write evidence file
  const evidenceDir = path.resolve(__dirname, '../../docs/evidence');
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'soak_test_output.txt'), resultLog);
  console.log(`[Soak Test] Output saved to docs/evidence/soak_test_output.txt\n`);
}

runSoakTest().catch((err) => {
  console.error('[Soak Test Fatal Error]', err);
  process.exit(1);
});
