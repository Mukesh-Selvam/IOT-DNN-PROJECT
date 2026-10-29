// simulator/src/fleet.js
// Fleet coordinator with drift-free fixed-rate simulation loop and auto-event scheduler

import config, { updateSettings } from './config.js';
import logger from './logger.js';
import { SCENARIO_TYPES } from './scenarios.js';
import { pickRandom, randomRange, roundTo } from './util.js';
import { Vehicle } from './vehicle.js';

export class Fleet {
  /**
   * @param {Object} options
   * @param {number} options.vehicleCount Number of vehicles to emulate
   * @param {number} options.sampleRateHz Loop frequency in Hz (10 to 200)
   * @param {boolean} options.dryRun Whether to bypass MQTT broker
   * @param {number} options.seed Seed for deterministic random generation
   */
  constructor({
    vehicleCount = config.vehicleCount,
    sampleRateHz = config.sampleRateHz,
    dryRun = false,
    seed = config.seed,
  } = {}) {
    this.vehicleCount = Math.max(1, vehicleCount);
    this.sampleRateHz = sampleRateHz;
    this.dryRun = dryRun;
    this.seed = seed;

    this.vehicles = [];
    this.running = false;
    this.paused = false;
    this.loopTimer = null;

    // Fixed-rate loop metrics
    this.intervalMs = 1000 / this.sampleRateHz;
    this.lastTickTime = 0;
    this.driftAccumulator = 0;

    // Dry-run 1Hz heartbeat counter
    this.lastDryRunHeartbeat = 0;

    // Auto-event scheduler timers per vehicle
    this.autoEventNextTimes = new Map();

    this._initializeVehicles();
  }

  _initializeVehicles() {
    this.vehicles = [];
    for (let i = 0; i < this.vehicleCount; i++) {
      const v = new Vehicle({
        index: i,
        seed: this.seed,
        dryRun: this.dryRun,
      });
      this.vehicles.push(v);
      this._scheduleNextAutoEvent(v);
    }
  }

  _scheduleNextAutoEvent(vehicle) {
    if (!config.autoEvents) return;
    const delaySec = randomRange(vehicle.rng, 20, 45);
    const triggerAtMs = Date.now() + delaySec * 1000;
    this.autoEventNextTimes.set(vehicle.deviceId, triggerAtMs);
  }

  async start() {
    if (this.running) return;
    this.running = true;

    logger.info(`Starting Fleet with ${this.vehicles.length} vehicles @ ${this.sampleRateHz} Hz...`);
    for (const v of this.vehicles) {
      await v.start();
    }

    this.lastTickTime = performance.now();
    this._runLoop();
  }

  stop() {
    this.running = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    for (const v of this.vehicles) {
      v.stop();
    }
    logger.info('Fleet simulation stopped.');
  }

  pause() {
    this.paused = true;
    logger.info('Fleet simulation paused.');
  }

  resume() {
    this.paused = false;
    this.lastTickTime = performance.now();
    logger.info('Fleet simulation resumed.');
  }

  /**
   * Self-correcting fixed-rate simulation loop with zero timer drift
   */
  _runLoop() {
    if (!this.running) return;

    const startTick = performance.now();
    const dt = 1 / this.sampleRateHz;
    const nowUnix = Date.now();

    if (!this.paused) {
      // 1. Advance simulation tick for all vehicles
      for (const vehicle of this.vehicles) {
        vehicle.tick(dt, nowUnix);

        // 2. Check auto-event trigger
        if (config.autoEvents && vehicle.scenarioRunner.currentScenario === SCENARIO_TYPES.NORMAL) {
          const nextEventAt = this.autoEventNextTimes.get(vehicle.deviceId);
          if (nextEventAt && nowUnix >= nextEventAt) {
            // Auto events ONLY fire non-accident events (hard_braking, sharp_turn, pothole)
            const nonAccidents = [
              SCENARIO_TYPES.HARD_BRAKING,
              SCENARIO_TYPES.SHARP_TURN,
              SCENARIO_TYPES.POTHOLE,
            ];
            const chosen = pickRandom(vehicle.rng, nonAccidents);
            logger.info(`[Auto-Event] [${vehicle.deviceId}] Firing random non-accident: ${chosen}`);
            vehicle.triggerScenario(chosen);
            this._scheduleNextAutoEvent(vehicle);
          }
        }
      }

      // 3. Dry-run console heartbeat (1 Hz)
      if (this.dryRun && nowUnix - this.lastDryRunHeartbeat >= 1000) {
        this.lastDryRunHeartbeat = nowUnix;
        this._printDryRunStatus();
      }
    }

    // 4. Drift-free high-precision sleep calculation
    const elapsed = performance.now() - startTick;
    const idealInterval = 1000 / this.sampleRateHz;
    const nextDelay = Math.max(0, idealInterval - elapsed);

    this.loopTimer = setTimeout(() => this._runLoop(), nextDelay);
  }

  _printDryRunStatus() {
    console.log('\n--- [DRY-RUN FLEET HEARTBEAT] ---');
    for (const v of this.vehicles) {
      const t = v.latestTelemetry;
      if (!t) continue;
      const ax = (t.accel.x >= 0 ? '+' : '') + t.accel.x.toFixed(2);
      const ay = (t.accel.y >= 0 ? '+' : '') + t.accel.y.toFixed(2);
      const az = (t.accel.z >= 0 ? '+' : '') + t.accel.z.toFixed(2);
      const speed = t.gps.speed.toFixed(1).padStart(5, ' ');
      const lat = t.gps.lat.toFixed(5);
      const lng = t.gps.lng.toFixed(5);
      const scen = t.meta ? `${t.meta.scenario} (${t.meta.phase})` : 'normal';
      const buzzer = t.buzzer === 'ON' ? '\x1b[31mON\x1b[0m' : 'OFF';
      const alert = t.alert.pending ? `\x1b[31m[ALERT: ${t.alert.remainingSec}s]\x1b[0m` : '[NORMAL]';

      console.log(
        `[${v.deviceId}] ${speed} km/h | Accel: (${ax}, ${ay}, ${az})g | GPS: ${lat}, ${lng} | ${scen.padEnd(25, ' ')} | Buzzer: ${buzzer} | ${alert}`
      );
    }
  }

  /**
   * Find vehicle by ID, 1-based index, or 'all'
   */
  findVehicles(target) {
    if (!target || target === 'all' || target === '*') {
      return [...this.vehicles];
    }
    const str = String(target).trim();
    // Check 1-based index (e.g. "1", "2")
    const num = parseInt(str, 10);
    if (!isNaN(num) && num >= 1 && num <= this.vehicles.length) {
      return [this.vehicles[num - 1]];
    }
    // Check exact device ID
    const found = this.vehicles.find((v) => v.deviceId.toLowerCase() === str.toLowerCase());
    return found ? [found] : [];
  }

  triggerScenario(target, scenarioName, cancelAfterSec = null) {
    const list = this.findVehicles(target);
    if (list.length === 0) {
      throw new Error(`Vehicle "${target}" not found in fleet`);
    }
    for (const v of list) {
      v.triggerScenario(scenarioName, cancelAfterSec);
    }
    return {
      success: true,
      affected: list.map((v) => v.deviceId),
      scenario: scenarioName,
      cancelAfterSec,
    };
  }

  cancelAlert(target = 'all', reason = 'MANUAL_CANCEL') {
    const list = this.findVehicles(target);
    for (const v of list) {
      v.cancelAlert(reason);
    }
    return { success: true, affected: list.map((v) => v.deviceId) };
  }

  reset(target = 'all') {
    const list = this.findVehicles(target);
    for (const v of list) {
      v.reset();
    }
    return { success: true, affected: list.map((v) => v.deviceId) };
  }

  updateFleetSettings(newSettings = {}) {
    const updated = updateSettings(newSettings);
    if (newSettings.sampleRateHz && newSettings.sampleRateHz !== this.sampleRateHz) {
      this.sampleRateHz = updated.sampleRateHz;
      this.intervalMs = 1000 / this.sampleRateHz;
    }
    if (typeof newSettings.noiseScale === 'number') {
      for (const v of this.vehicles) {
        v.mpu.setNoiseScale(newSettings.noiseScale);
        v.gps.setNoiseScale(newSettings.noiseScale);
      }
    }
    return updated;
  }

  getVehiclesStatus() {
    return this.vehicles.map((v) => v.getStatus());
  }
}

export default Fleet;
