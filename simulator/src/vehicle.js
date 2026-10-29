// simulator/src/vehicle.js
// Virtual ESP32 Vehicle Device with sensor synthesis, local firmware alert state machine, and actuation

import { VirtualBuzzer } from './buzzer.js';
import config from './config.js';
import { MQTTLink } from './link.js';
import logger from './logger.js';
import { getRouteByIndex } from './routes.js';
import { ScenarioRunner, SCENARIO_TYPES } from './scenarios.js';
import { GPSSensor, MPU6050Sensor } from './sensors.js';
import { createRNG, randomInt, randomRange, roundTo, vec3Magnitude } from './util.js';

export class Vehicle {
  /**
   * @param {Object} options
   * @param {number} options.index 0-based vehicle index
   * @param {string} options.deviceId Device identifier (e.g. ESP32-SIM-001)
   * @param {number} options.seed Global or per-vehicle seed for deterministic behavior
   * @param {boolean} options.dryRun Whether to bypass MQTT networking
   */
  constructor({ index = 0, deviceId = null, seed = null, dryRun = false }) {
    this.index = index;
    this.deviceId = deviceId || `ESP32-SIM-${String(index + 1).padStart(3, '0')}`;
    this.rng = createRNG(seed !== null ? seed + index * 9973 : null);
    this.dryRun = dryRun;

    // License Plate (Tamil Nadu format)
    const districts = ['37', '38', '39', '41'];
    const letters = ['AB', 'AX', 'BZ', 'CD', 'EM'];
    const dist = districts[index % districts.length];
    const letCode = letters[index % letters.length];
    const num = String(1000 + (index * 347) % 9000);
    this.plate = `TN-${dist}-${letCode}-${num}`;

    // Assigned Route & Waypoint Navigation
    const routeObj = getRouteByIndex(index);
    this.routeId = routeObj.id;
    this.routeName = routeObj.def.name;
    this.route = routeObj.interpolator;

    // Nominal cruising speed (randomized 40 to 68 km/h)
    this.cruiseSpeedKmH = roundTo(randomRange(this.rng, 42, 66), 1);
    this.currentSpeedKmH = this.cruiseSpeedKmH;

    // Random start offset along closed-loop route (meters)
    this.distanceAlongRoute = randomRange(this.rng, 0, this.route.totalDistance || 10000);

    // Sequence counter for telemetry
    this.seq = 0;

    // Sensors
    this.mpu = new MPU6050Sensor({
      deviceId: this.deviceId,
      rng: this.rng,
      noiseScale: config.noiseScale,
    });

    this.gps = new GPSSensor({
      deviceId: this.deviceId,
      rng: this.rng,
      noiseScale: config.noiseScale,
    });

    // Actuator
    this.buzzer = new VirtualBuzzer(this.deviceId, config.buzzerAutoOffSec);

    // Scenario Engine
    this.scenarioRunner = new ScenarioRunner(this.rng);
    this.scenarioRunner.setPostCrashHoldSec(config.postCrashHoldSec);

    // Firmware-like Alert State Machine
    this.alertState = {
      pending: false,
      startedAt: null,
      countdownSec: config.cancelWindowSec,
      peakG: 0,
      autoCancelTimer: null,
      cooldownUntil: 0,
    };

    // Telemetry cache for inspection / API
    this.latestTelemetry = null;
    this.latestRawPosition = { lat: 10.998, lng: 76.966, heading: 0 };

    // Communication Link
    this.link = new MQTTLink({
      deviceId: this.deviceId,
      brokerUrl: config.mqttUrl,
      dryRun: this.dryRun,
      onCommand: (cmd) => this.handleCommand(cmd),
    });
  }

  async start() {
    await this.link.connect({
      plate: this.plate,
      routeName: this.routeName,
      sampleRateHz: config.sampleRateHz,
    });
  }

  stop() {
    if (this.alertState.autoCancelTimer) {
      clearTimeout(this.alertState.autoCancelTimer);
    }
    this.buzzer.destroy();
    this.link.disconnect();
  }

  /**
   * Handle incoming commands from backend via MQTT or HTTP control
   */
  handleCommand(command) {
    logger.info(`[Command] [${this.deviceId}] Received:`, JSON.stringify(command));

    // 1. Direct Buzzer command: {"buzzer": "ON" | "OFF"}
    if (command.buzzer === 'ON') {
      this.buzzer.turnOn('BACKEND_COMMAND');
      this.link.publishEvent({
        type: 'BUZZER_ON',
        deviceId: this.deviceId,
        ts: Date.now(),
        gps: this.latestTelemetry ? this.latestTelemetry.gps : null,
      });
    } else if (command.buzzer === 'OFF') {
      this.buzzer.turnOff('BACKEND_COMMAND');
      this.link.publishEvent({
        type: 'BUZZER_OFF',
        deviceId: this.deviceId,
        ts: Date.now(),
        gps: this.latestTelemetry ? this.latestTelemetry.gps : null,
      });
    }

    // 2. Command action: {"cmd": "CANCEL" | "RESET"}
    if (command.cmd === 'CANCEL') {
      this.cancelAlert('BACKEND_COMMAND');
    } else if (command.cmd === 'RESET') {
      this.reset('BACKEND_COMMAND');
    }
  }

  /**
   * Driver button press / simulated cancel (for false-alarm demonstration)
   */
  cancelAlert(reason = 'DRIVER_CANCEL') {
    if (!this.alertState.pending) return;

    if (this.alertState.autoCancelTimer) {
      clearTimeout(this.alertState.autoCancelTimer);
      this.alertState.autoCancelTimer = null;
    }

    this.alertState.pending = false;
    this.buzzer.turnOff(reason);

    const cancelEvent = {
      type: 'ALERT_CANCELLED',
      deviceId: this.deviceId,
      ts: Date.now(),
      reason,
      gps: this.latestTelemetry ? this.latestTelemetry.gps : null,
    };
    this.link.publishEvent(cancelEvent);
    logger.event('ALERT_CANCELLED', this.deviceId, `[Reason: ${reason}]`);
  }

  /**
   * Trigger driving scenario with optional scheduled auto-cancellation
   */
  triggerScenario(scenarioName, cancelAfterSec = null) {
    logger.info(`[Scenario] [${this.deviceId}] Triggering scenario: ${scenarioName} (autoCancel: ${cancelAfterSec}s)`);
    this.scenarioRunner.setPostCrashHoldSec(config.postCrashHoldSec);
    this.scenarioRunner.trigger(scenarioName);

    if (cancelAfterSec && cancelAfterSec > 0) {
      this.alertState.scheduledAutoCancelSec = cancelAfterSec;
    } else {
      this.alertState.scheduledAutoCancelSec = null;
    }
  }

  /**
   * Reset vehicle to normal driving, clear any active crash/alert
   */
  reset(reason = 'MANUAL_RESET') {
    if (this.alertState.autoCancelTimer) {
      clearTimeout(this.alertState.autoCancelTimer);
      this.alertState.autoCancelTimer = null;
    }
    this.alertState.pending = false;
    this.alertState.peakG = 0;
    this.buzzer.turnOff(reason);
    this.scenarioRunner.trigger(SCENARIO_TYPES.NORMAL);
    this.currentSpeedKmH = this.cruiseSpeedKmH;
    logger.info(`[Reset] [${this.deviceId}] State reset to normal driving.`);
  }

  /**
   * Main physics simulation tick executed at sampleRateHz (e.g. 50 Hz)
   * @param {number} dt Delta time in seconds (e.g. 0.02)
   * @param {number} now Current Unix timestamp in milliseconds
   */
  tick(dt, now = Date.now()) {
    // 1. Advance active scenario
    const { dynamicState, targetSpeedKmH, isFinished } = this.scenarioRunner.step(
      dt,
      this.currentSpeedKmH,
      this.cruiseSpeedKmH
    );

    // 2. Update speed and route progress
    this.currentSpeedKmH = targetSpeedKmH;
    const distanceTraveledMeters = (this.currentSpeedKmH * 1000 / 3600) * dt;
    this.distanceAlongRoute += distanceTraveledMeters;

    // 3. Geodesic coordinates interpolation along assigned closed-loop route
    this.latestRawPosition = this.route.interpolate(this.distanceAlongRoute);

    // 4. Sample MPU6050 & GPS
    const imuSample = this.mpu.sample(dynamicState, this.currentSpeedKmH, dt);
    const gpsSample = this.gps.update(this.latestRawPosition, this.currentSpeedKmH, now);

    // 5. Firmware-like local accident detection logic
    const measuredG = vec3Magnitude(imuSample.accel);
    if (config.localTrigger && !this.alertState.pending && now > this.alertState.cooldownUntil) {
      if (measuredG >= config.localThresholdG) {
        this._triggerLocalAlert(measuredG, gpsSample, now);
      }
    }

    // 6. Update alert countdown
    let remainingSec = 0;
    if (this.alertState.pending) {
      const elapsedMs = now - this.alertState.startedAt;
      const totalWindowMs = config.cancelWindowSec * 1000;
      remainingSec = Math.max(0, roundTo((totalWindowMs - elapsedMs) / 1000, 1));

      if (elapsedMs >= totalWindowMs) {
        // Window expired without driver cancellation -> CONFIRM ALERT
        this._confirmLocalAlert(gpsSample, now);
      }
    }

    // 7. Assemble high-fidelity telemetry payload (contract adhering)
    this.seq += 1;
    const telemetry = {
      deviceId: this.deviceId,
      ts: now,
      seq: this.seq,
      sampleRateHz: config.sampleRateHz,
      accel: imuSample.accel,
      gyro: imuSample.gyro,
      gps: gpsSample,
      buzzer: this.buzzer.getState(),
      alert: {
        pending: this.alertState.pending,
        remainingSec,
      },
    };

    if (config.includeGroundTruth) {
      telemetry.meta = this.scenarioRunner.getGroundTruth();
    }

    this.latestTelemetry = telemetry;

    // 8. Stream telemetry to broker
    this.link.publishTelemetry(telemetry);

    return telemetry;
  }

  _triggerLocalAlert(measuredG, gpsSample, now) {
    this.alertState.pending = true;
    this.alertState.startedAt = now;
    this.alertState.peakG = roundTo(measuredG, 2);

    this.buzzer.turnOn('LOCAL_IMPACT_DETECTED');

    const impactEvent = {
      type: 'IMPACT_DETECTED',
      deviceId: this.deviceId,
      ts: now,
      peakG: this.alertState.peakG,
      gps: gpsSample,
    };
    this.link.publishEvent(impactEvent);
    logger.event('IMPACT_DETECTED', this.deviceId, `[Peak |a|: ${this.alertState.peakG}g, Threshold: ${config.localThresholdG}g]`);

    // Handle scheduled auto-cancel (for false alarm demo)
    if (this.alertState.scheduledAutoCancelSec && this.alertState.scheduledAutoCancelSec > 0) {
      const cancelMs = this.alertState.scheduledAutoCancelSec * 1000;
      this.alertState.autoCancelTimer = setTimeout(() => {
        if (this.alertState.pending) {
          this.cancelAlert('SCHEDULED_DEMO_CANCEL');
        }
      }, cancelMs);
      if (this.alertState.autoCancelTimer.unref) {
        this.alertState.autoCancelTimer.unref();
      }
      this.alertState.scheduledAutoCancelSec = null;
    }
  }

  _confirmLocalAlert(gpsSample, now) {
    this.alertState.pending = false;
    this.alertState.cooldownUntil = now + config.cooldownSec * 1000;

    const confirmEvent = {
      type: 'ALERT_CONFIRMED',
      deviceId: this.deviceId,
      ts: now,
      peakG: this.alertState.peakG,
      gps: gpsSample,
    };
    this.link.publishEvent(confirmEvent);
    logger.event('ALERT_CONFIRMED', this.deviceId, `[Crash Confirmed. Emergency alert dispatched!]`);
  }

  getStatus() {
    return {
      deviceId: this.deviceId,
      plate: this.plate,
      route: this.routeName,
      speedKmH: roundTo(this.currentSpeedKmH, 1),
      scenario: this.scenarioRunner.currentScenario,
      phase: this.scenarioRunner.phase,
      buzzer: this.buzzer.getState(),
      alertPending: this.alertState.pending,
      connected: this.link.connected,
      gps: this.latestTelemetry ? this.latestTelemetry.gps : null,
    };
  }
}

export default Vehicle;
