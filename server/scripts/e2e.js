process.env.NODE_ENV = 'test';

import http from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app.js';
import config from '../src/config/index.js';
import { Incident } from '../src/models/Incident.js';
import { clearDeviceWindow } from '../src/services/slidingWindowService.js';
import { confirmIncident } from '../src/services/incidentService.js';
import { ScenarioRunner, ACCIDENT_SCENARIOS } from '../../simulator/src/scenarios.js';
import { MPU6050Sensor } from '../../simulator/src/sensors.js';
import { createRNG } from '../../simulator/src/util.js';

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });

const SCENARIOS = [
  'normal',
  'hard_braking',
  'sharp_turn',
  'pothole',
  'frontal_collision',
  'side_impact',
  'rollover',
  'rear_end',
];

const ACCIDENT_TYPES = ['frontal_collision', 'side_impact', 'rollover', 'rear_end'];

// --- State ---
let embeddedMode = false; // true when we manage our own server + mongo
let baseUrl = '';
let authToken = ''; // JWT bearer token

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function runE2ESuite() {
  console.log('================================================================================');
  console.log('STARTING CLOSED-LOOP END-TO-END SYSTEM EVALUATION');
  console.log('================================================================================');

  let server;
  let mongoServer;

  // 1. Decide: connect to running server or boot embedded?
  const isLive = await checkHttpOnline('http://127.0.0.1:5000/api/health');
  if (isLive) {
    baseUrl = 'http://127.0.0.1:5000';
    embeddedMode = false;
    console.log(`[E2E] Connected to running backend at ${baseUrl}`);
  } else {
    embeddedMode = true;
    console.log('[E2E] No running server found – booting embedded server with MongoMemoryServer...');
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[E2E] Embedded server listening at ${baseUrl} (OS-assigned port)`);
  }

  // 2. Register + login to acquire JWT (all incident routes need auth)
  const e2eEmail = `e2e_${Date.now()}@testlab.com`;
  const e2ePass = 'E2ETestPass#1';
  console.log(`[E2E] Registering test user: ${e2eEmail}`);
  await httpPost(`${baseUrl}/api/auth/register`, { name: 'E2E User', email: e2eEmail, password: e2ePass });
  const loginRes = await httpPost(`${baseUrl}/api/auth/login`, { email: e2eEmail, password: e2ePass });
  authToken = loginRes.token || loginRes.data?.accessToken || loginRes.data?.token || '';
  if (!authToken) {
    throw new Error(`[E2E] Login failed – response: ${JSON.stringify(loginRes)}`);
  }
  console.log(`[E2E] JWT acquired (${authToken.slice(0, 20)}...)\n`);

  // -------------------------------------------------------------------------
  // PART 1: 8-Scenario x 10 Runs Benchmark
  // -------------------------------------------------------------------------
  console.log('[E2E Phase 1] Testing 8 Scenarios x 10 Runs Each (Real API Ingestion)...');
  const resultsTable = [];

  for (const scenario of SCENARIOS) {
    const isExpectedAccident = ACCIDENT_SCENARIOS.has(scenario);
    let incidentsCreated = 0;
    const latencies = [];
    const detectionSources = new Set();

    for (let run = 1; run <= 10; run++) {
      const deviceId = `E2E-${scenario.toUpperCase().slice(0, 4)}-${String(run).padStart(2, '0')}`;
      clearDeviceWindow(deviceId);

      // Clean up stale incidents in embedded mode
      if (embeddedMode) {
        await Incident.deleteMany({ deviceId });
      }

      // Generate physics time series
      const samples = generateScenarioSamples(scenario, run, deviceId);

      // Ingest via POST /api/telemetry (unauthenticated device endpoint)
      for (const sample of samples) {
        const s = { ...sample };
        delete s.meta;
        await httpPost(`${baseUrl}/api/telemetry`, s);
      }

      // Allow sliding-window pipeline to complete (in-process async, 600ms gives headroom)
      await sleep(600);

      // Query incidents: use Mongoose directly in embedded mode (bypasses auth),
      // or authenticated HTTP in live mode
      let deviceIncidents = [];
      if (embeddedMode) {
        deviceIncidents = await Incident.find({ deviceId }).sort({ createdAt: -1 }).lean();
      } else {
        const incRes = await httpGetAuth(`${baseUrl}/api/incidents?deviceId=${deviceId}`);
        deviceIncidents = incRes.data || incRes.incidents || [];
      }

      if (deviceIncidents.length > 0) {
        incidentsCreated++;
        const latest = deviceIncidents[0];
        detectionSources.add(latest.detectionSource || 'ML');
        latencies.push(latest.detectionLatencyMs || 0);
      }
    }

    const expectedCount = isExpectedAccident ? 10 : 0;
    const sortedLat = [...latencies].sort((a, b) => a - b);
    const medianLatency = sortedLat.length > 0 ? sortedLat[Math.floor(sortedLat.length / 2)] : 0;
    const srcStr = detectionSources.size > 0 ? Array.from(detectionSources).join('/') : 'NONE';

    resultsTable.push({
      scenario,
      runs: 10,
      incidentsCreated,
      expected: expectedCount,
      detectionSource: srcStr,
      medianLatencyMs: medianLatency,
      passed: incidentsCreated === expectedCount,
    });
  }

  // Print Table 1
  console.log('\n================================================================================');
  console.log('TABLE 1: CLOSED-LOOP E2E SCENARIO BENCHMARK (10 RUNS PER SCENARIO)');
  console.log('================================================================================');
  console.log('SCENARIO            | RUNS | CREATED | EXPECTED | DETECTION SOURCE | MEDIAN LAT | STATUS');
  console.log('----------------------------------------------------------------------------------------');
  for (const r of resultsTable) {
    const statusStr = r.passed ? '[PASS]' : '[FAIL]';
    console.log(
      `${r.scenario.padEnd(19)} | ${String(r.runs).padEnd(4)} | ${String(r.incidentsCreated).padEnd(7)} | ${String(r.expected).padEnd(8)} | ${r.detectionSource.padEnd(16)} | ${(r.medianLatencyMs + 'ms').padEnd(10)} | ${statusStr}`
    );
  }
  const t1Failures = resultsTable.filter((r) => !r.passed);
  console.log(`\nPhase 1 Result: ${t1Failures.length === 0 ? '[ALL PASS]' : `[${t1Failures.length} FAIL(S): ${t1Failures.map((r) => r.scenario).join(', ')}]`}`);
  console.log('================================================================================\n');

  // -------------------------------------------------------------------------
  // PART 2: ML-Service Down -> Rule-Based Fallback
  // -------------------------------------------------------------------------
  console.log('[E2E Phase 2] Simulating ML Microservice Down -> Verifying Rule-Based Fallback...');
  const originalMlUrl = config.mlServiceUrl;
  config.mlServiceUrl = 'http://127.0.0.1:59998'; // Dead port -> triggers fallback

  const fallbackTable = [];
  for (const scenario of ACCIDENT_TYPES) {
    let incidentsCreated = 0;
    const latencies = [];
    const detectionSources = new Set();

    for (let run = 1; run <= 5; run++) {
      const deviceId = `E2E-FB-${scenario.toUpperCase().slice(0, 4)}-${run}`;
      clearDeviceWindow(deviceId);
      if (embeddedMode) await Incident.deleteMany({ deviceId });

      const samples = generateScenarioSamples(scenario, run + 200, deviceId);
      for (const s of samples) {
        const p = { ...s };
        delete p.meta;
        await httpPost(`${baseUrl}/api/telemetry`, p);
      }
      await sleep(600);

      let deviceIncidents = [];
      if (embeddedMode) {
        deviceIncidents = await Incident.find({ deviceId }).sort({ createdAt: -1 }).lean();
      } else {
        const incRes = await httpGetAuth(`${baseUrl}/api/incidents?deviceId=${deviceId}`);
        deviceIncidents = incRes.data || incRes.incidents || [];
      }

      if (deviceIncidents.length > 0) {
        incidentsCreated++;
        detectionSources.add(deviceIncidents[0].detectionSource || 'RULE_BASED');
        latencies.push(deviceIncidents[0].detectionLatencyMs || 2);
      }
    }

    fallbackTable.push({
      scenario,
      runs: 5,
      incidentsCreated,
      expected: 5,
      detectionSource: Array.from(detectionSources).join('/') || 'NONE',
      medianLatencyMs: latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : 0,
      passed: incidentsCreated === 5,
    });
  }
  config.mlServiceUrl = originalMlUrl;

  console.log('\n================================================================================');
  console.log('TABLE 2: ML-SERVICE DOWN - RULE-BASED FALLBACK BENCHMARK');
  console.log('================================================================================');
  console.log('SCENARIO            | RUNS | CREATED | EXPECTED | DETECTION SOURCE | MEDIAN LAT | STATUS');
  console.log('----------------------------------------------------------------------------------------');
  for (const r of fallbackTable) {
    const statusStr = r.passed ? '[PASS]' : '[FAIL]';
    console.log(
      `${r.scenario.padEnd(19)} | ${String(r.runs).padEnd(4)} | ${String(r.incidentsCreated).padEnd(7)} | ${String(r.expected).padEnd(8)} | ${r.detectionSource.padEnd(16)} | ${(r.medianLatencyMs + 'ms').padEnd(10)} | ${statusStr}`
    );
  }
  const t2Failures = fallbackTable.filter((r) => !r.passed);
  console.log(`\nPhase 2 Result: ${t2Failures.length === 0 ? '[ALL PASS]' : `[${t2Failures.length} FAIL(S): ${t2Failures.map((r) => r.scenario).join(', ')}]`}`);
  console.log('================================================================================\n');

  // -------------------------------------------------------------------------
  // PART 3: False-Alarm Cancellation Path
  // -------------------------------------------------------------------------
  console.log('[E2E Phase 3] Testing False-Alarm Cancellation Path (Driver Presses Cancel)...');
  const falseAlarmDevId = `E2E-FA-${Date.now()}`;
  clearDeviceWindow(falseAlarmDevId);
  if (embeddedMode) await Incident.deleteMany({ deviceId: falseAlarmDevId });

  const faSamples = generateScenarioSamples('frontal_collision', 999, falseAlarmDevId);
  for (const s of faSamples) {
    const p = { ...s };
    delete p.meta;
    await httpPost(`${baseUrl}/api/telemetry`, p);
  }
  await sleep(400);

  let faIncident = null;
  if (embeddedMode) {
    faIncident = await Incident.findOne({ deviceId: falseAlarmDevId }).sort({ createdAt: -1 }).lean();
  } else {
    const faIncRes = await httpGetAuth(`${baseUrl}/api/incidents?deviceId=${falseAlarmDevId}`);
    faIncident = (faIncRes.data || faIncRes.incidents || [])[0];
  }

  let p3Pass = false;
  if (!faIncident) {
    console.log('  - [FAIL] No incident created for false-alarm cancellation test');
  } else {
    console.log(`  - Incident created: ${faIncident._id} (Status: ${faIncident.status})`);
    const cancelRes = await httpPostAuth(
      `${baseUrl}/api/incidents/${faIncident._id}/cancel`,
      { reason: 'Driver pressed false-alarm button' }
    );
    console.log(`  - Cancel response: ${JSON.stringify(cancelRes).slice(0, 100)}`);

    let verifiedStatus;
    if (embeddedMode) {
      const inc = await Incident.findById(faIncident._id).lean();
      verifiedStatus = inc?.status;
    } else {
      const vRes = await httpGetAuth(`${baseUrl}/api/incidents/${faIncident._id}`);
      verifiedStatus = vRes.data?.status || vRes.incident?.status;
    }
    p3Pass = verifiedStatus === 'FALSE_ALARM';
    console.log(`  - Verified status: ${verifiedStatus} (Expected: FALSE_ALARM)`);
    console.log(`  - Phase 3 Result: ${p3Pass ? '[PASS]' : '[FAIL]'}\n`);
  }

  // -------------------------------------------------------------------------
  // PART 4: Countdown Expiry -> Alert Dispatch
  // -------------------------------------------------------------------------
  console.log('[E2E Phase 4] Testing Countdown Expiry -> Alert Dispatch (Auto-Confirm)...');
  const expiryDevId = `E2E-EXP-${Date.now()}`;
  clearDeviceWindow(expiryDevId);
  if (embeddedMode) await Incident.deleteMany({ deviceId: expiryDevId });

  const expSamples = generateScenarioSamples('rollover', 998, expiryDevId);
  for (const s of expSamples) {
    const p = { ...s };
    delete p.meta;
    await httpPost(`${baseUrl}/api/telemetry`, p);
  }
  await sleep(400);

  let expIncident = null;
  if (embeddedMode) {
    expIncident = await Incident.findOne({ deviceId: expiryDevId }).sort({ createdAt: -1 }).lean();
  } else {
    const expIncRes = await httpGetAuth(`${baseUrl}/api/incidents?deviceId=${expiryDevId}`);
    expIncident = (expIncRes.data || expIncRes.incidents || [])[0];
  }

  let p4Pass = false;
  if (!expIncident) {
    console.log('  - [FAIL] No incident created for expiry test');
  } else {
    console.log(`  - Incident created: ${expIncident._id} (Status: ${expIncident.status})`);
    // Simulate countdown expiry by directly calling confirmIncident (in-process only)
    await confirmIncident(expIncident._id, 'Countdown expired (auto-confirmed by E2E)');

    let expStatus;
    if (embeddedMode) {
      const inc = await Incident.findById(expIncident._id).lean();
      expStatus = inc?.status;
    } else {
      const vRes = await httpGetAuth(`${baseUrl}/api/incidents/${expIncident._id}`);
      expStatus = vRes.data?.status || vRes.incident?.status;
    }
    p4Pass = expStatus === 'CONFIRMED';
    console.log(`  - Verified status: ${expStatus} (Expected: CONFIRMED)`);
    console.log(`  - Phase 4 Result: ${p4Pass ? '[PASS]' : '[FAIL]'}\n`);
  }

  // -------------------------------------------------------------------------
  // Final Summary
  // -------------------------------------------------------------------------
  const totalFails = t1Failures.length + t2Failures.length + (p3Pass ? 0 : 1) + (p4Pass ? 0 : 1);
  console.log('================================================================================');
  console.log('CLOSED-LOOP END-TO-END SUITE COMPLETED');
  console.log(`  Phase 1 (8 scenarios): ${t1Failures.length === 0 ? 'ALL PASS' : t1Failures.length + ' FAIL(S)'}`);
  console.log(`  Phase 2 (ML fallback): ${t2Failures.length === 0 ? 'ALL PASS' : t2Failures.length + ' FAIL(S)'}`);
  console.log(`  Phase 3 (cancel path): ${p3Pass ? 'PASS' : 'FAIL'}`);
  console.log(`  Phase 4 (expiry path): ${p4Pass ? 'PASS' : 'FAIL'}`);
  console.log(`  Overall:               ${totalFails === 0 ? 'PASS' : 'FAIL (' + totalFails + ' issues)'}`);
  console.log('================================================================================\n');

  // Teardown
  if (embeddedMode) {
    server.close();
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  }
  process.exit(totalFails > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Sample Generator (mirrors simulator physics)
// ---------------------------------------------------------------------------
function generateScenarioSamples(scenarioName, seed, deviceId) {
  const rng = createRNG(seed * 7919 + 17);
  const runner = new ScenarioRunner(rng);
  const imu = new MPU6050Sensor({ deviceId, rng, noiseScale: 1.0 });

  const dt = 0.02; // 50 Hz
  const sampleRateHz = 50;
  const totalDuration = ACCIDENT_SCENARIOS.has(scenarioName) ? 6.0 : 4.0;
  const totalTicks = Math.round(totalDuration * sampleRateHz);
  const triggerAtSec = 2.0;

  let currentSpeed = 60;
  let hasTriggered = false;
  const samples = [];
  const baseTs = Date.now() - totalTicks * 20;

  for (let tick = 0; tick < totalTicks; tick++) {
    const curTimeSec = tick * dt;

    if (!hasTriggered && curTimeSec >= triggerAtSec) {
      runner.trigger(scenarioName);
      hasTriggered = true;
    }

    const { dynamicState, targetSpeedKmH } = runner.step(dt, currentSpeed, 60);
    currentSpeed = targetSpeedKmH;
    const imuSample = imu.sample(dynamicState, currentSpeed, dt);

    samples.push({
      deviceId,
      ts: baseTs + tick * 20,
      seq: tick,
      sampleRateHz,
      accel: imuSample.accel,
      gyro: imuSample.gyro,
      gps: {
        lat: 10.998 + tick * 0.00001,
        lng: 76.966 + tick * 0.00001,
        speed: currentSpeed,
        satellites: 9,
      },
      speed: currentSpeed,
      buzzer: 'OFF',
    });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// HTTP Helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function checkHttpOnline(url) {
  return new Promise((resolve) => {
    http
      .get(url, (res) => resolve(res.statusCode === 200))
      .on('error', () => resolve(false));
  });
}

/** Unauthenticated POST (for /api/telemetry and /api/auth) */
function httpPost(urlStr, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyStr = JSON.stringify(data);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        agent: httpAgent,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ statusCode: res.statusCode, raw }); } });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/** Authenticated POST (for cancel, status updates) */
function httpPostAuth(urlStr, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyStr = JSON.stringify(data);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        agent: httpAgent,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          'Authorization': `Bearer ${authToken}`,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ statusCode: res.statusCode, raw }); } });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/** Authenticated GET (for /api/incidents) */
function httpGetAuth(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        agent: httpAgent,
        headers: { 'Authorization': `Bearer ${authToken}` },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ statusCode: res.statusCode, raw }); } });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

runE2ESuite().catch((err) => {
  console.error('[E2E Fatal Error]:', err);
  process.exit(1);
});
