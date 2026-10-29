// simulator/test/firmware_alert.test.js
// Automated tests for local firmware alert logic, buzzer actuation, driver cancel, and backend commands

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import config from '../src/config.js';
import { SCENARIO_TYPES } from '../src/scenarios.js';
import { Vehicle } from '../src/vehicle.js';

describe('Local Firmware Alert Logic and Actuation Verification', () => {
  test('Local buzzer triggers on frontal collision (>= 4.0g) but NOT on pothole (< 4.0g)', () => {
    // 1. Vehicle experiencing a Pothole
    const vPothole = new Vehicle({ index: 0, seed: 101, dryRun: true });
    vPothole.triggerScenario(SCENARIO_TYPES.POTHOLE);

    for (let i = 0; i < 50; i++) {
      vPothole.tick(0.02, 1710000000000 + i * 20);
    }
    assert.equal(
      vPothole.buzzer.getState(),
      'OFF',
      'Pothole must NOT trigger local buzzer because forces remain below 4.0g'
    );
    assert.equal(vPothole.alertState.pending, false, 'Pothole must not start alert countdown');

    // 2. Vehicle experiencing Frontal Collision
    const vCrash = new Vehicle({ index: 1, seed: 202, dryRun: true });
    vCrash.triggerScenario(SCENARIO_TYPES.FRONTAL_COLLISION);

    let triggered = false;
    for (let i = 0; i < 50; i++) {
      vCrash.tick(0.02, 1710000000000 + i * 20);
      if (vCrash.buzzer.getState() === 'ON') {
        triggered = true;
        break;
      }
    }

    assert.ok(triggered, 'Crash must trigger the local buzzer ON');
    assert.equal(vCrash.alertState.pending, true, 'Crash must initiate local alert countdown');
    assert.ok(vCrash.alertState.peakG >= config.localThresholdG, 'Recorded peakG must be >= 4.0g');
  });

  test('Simulated driver button cancels active alert and turns off buzzer', () => {
    const v = new Vehicle({ index: 2, seed: 303, dryRun: true });
    v.triggerScenario(SCENARIO_TYPES.FRONTAL_COLLISION);

    // Tick until alert triggers
    for (let i = 0; i < 25; i++) {
      v.tick(0.02, 1710000000000 + i * 20);
    }

    assert.equal(v.buzzer.getState(), 'ON');
    assert.equal(v.alertState.pending, true);

    // Driver presses cancel button (false alarm)
    v.cancelAlert('DRIVER_BUTTON');

    assert.equal(v.buzzer.getState(), 'OFF', 'Buzzer must turn OFF upon driver cancellation');
    assert.equal(v.alertState.pending, false, 'Alert countdown must be cleared');
  });

  test('Scheduled auto-cancel (cancelAfterSec) demo clears alert automatically', async () => {
    const v = new Vehicle({ index: 3, seed: 404, dryRun: true });
    // Trigger with scheduled cancel after 0.2 seconds
    v.triggerScenario(SCENARIO_TYPES.SIDE_IMPACT, 0.2);

    // Advance ticks to trigger impact
    for (let i = 0; i < 20; i++) {
      v.tick(0.02, 1710000000000 + i * 20);
    }

    assert.equal(v.alertState.pending, true);
    assert.equal(v.buzzer.getState(), 'ON');

    // Wait for the scheduled 200ms timer to fire
    await new Promise((resolve) => setTimeout(resolve, 250));

    assert.equal(v.alertState.pending, false, 'Alert must be auto-cancelled after scheduled delay');
    assert.equal(v.buzzer.getState(), 'OFF', 'Buzzer must be turned off');
  });

  test('Alert countdown expiry publishes ALERT_CONFIRMED', () => {
    const v = new Vehicle({ index: 4, seed: 505, dryRun: true });
    v.triggerScenario(SCENARIO_TYPES.REAR_END);

    const baseTime = 1710000000000;
    // Tick to trigger impact
    for (let i = 0; i < 20; i++) {
      v.tick(0.02, baseTime + i * 20);
    }

    assert.equal(v.alertState.pending, true);

    // Track published events
    const capturedEvents = [];
    v.link.publishEvent = (event) => capturedEvents.push(event);

    // Advance time past the 15-second cancellation window
    const windowSecMs = config.cancelWindowSec * 1000 + 100;
    v.tick(0.02, baseTime + windowSecMs);

    assert.equal(v.alertState.pending, false, 'Pending alert state should transition to confirmed');
    const confirmedEvent = capturedEvents.find((e) => e.type === 'ALERT_CONFIRMED');
    assert.ok(confirmedEvent, 'Must emit ALERT_CONFIRMED event when countdown expires');
  });

  test('Backend MQTT / HTTP commands actuate buzzer and vehicle reset', () => {
    const v = new Vehicle({ index: 5, seed: 606, dryRun: true });

    // 1. Direct Buzzer ON command
    v.handleCommand({ buzzer: 'ON' });
    assert.equal(v.buzzer.getState(), 'ON', 'Buzzer command ON must set buzzer to ON');

    // 2. Direct Buzzer OFF command
    v.handleCommand({ buzzer: 'OFF' });
    assert.equal(v.buzzer.getState(), 'OFF', 'Buzzer command OFF must set buzzer to OFF');

    // 3. Reset command while crashed
    v.triggerScenario(SCENARIO_TYPES.FRONTAL_COLLISION);
    for (let i = 0; i < 20; i++) {
      v.tick(0.02, 1710000000000 + i * 20);
    }
    assert.equal(v.buzzer.getState(), 'ON');

    v.handleCommand({ cmd: 'RESET' });
    assert.equal(v.buzzer.getState(), 'OFF', 'RESET command must turn buzzer OFF');
    assert.equal(v.alertState.pending, false, 'RESET command must clear active alert');
    assert.equal(v.scenarioRunner.currentScenario, SCENARIO_TYPES.NORMAL, 'RESET must return to normal scenario');
  });
});
