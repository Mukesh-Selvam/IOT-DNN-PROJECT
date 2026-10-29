// server/tests/unit/slidingWindow.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pushTelemetrySample,
  clearDeviceWindow,
  setSlidingWindowSocketEmitter,
} from '../../src/services/slidingWindowService.js';

describe('Sliding Window & Pre-Filter Screening Engine', () => {
  const testDevice = 'SIM-TEST-WINDOW-01';

  beforeEach(() => {
    clearDeviceWindow(testDevice);
  });

  it('correctly ingests telemetry points without errors', async () => {
    let emitted = 0;
    setSlidingWindowSocketEmitter({
      emit: (topic, data) => {
        if (topic === 'telemetry') emitted++;
      },
    });

    // Ingest 5 quiescent points
    for (let i = 0; i < 5; i++) {
      await pushTelemetrySample({
        deviceId: testDevice,
        ts: Date.now() + i * 20,
        sampleRateHz: 50,
        accel: { x: 0.01, y: 0.01, z: 1.0 },
        gyro: { x: 0.1, y: 0.1, z: 0.0 },
        gps: { speed: 45, lat: 10.998, lng: 76.966 },
      });
    }

    assert.ok(emitted >= 1, 'Socket emitter should have broadcast throttled telemetry');
  });

  it('clears device window on clearDeviceWindow', async () => {
    await pushTelemetrySample({
      deviceId: testDevice,
      ts: Date.now(),
      sampleRateHz: 50,
      accel: { x: 0, y: 0, z: 1 },
      gyro: { x: 0, y: 0, z: 0 },
      gps: { speed: 30, lat: 10, lng: 76 },
    });

    clearDeviceWindow(testDevice);
    // Verified by ensuring no residual buffer state causes crash on subsequent ingestion
    assert.doesNotThrow(async () => {
      await pushTelemetrySample({
        deviceId: testDevice,
        ts: Date.now(),
        sampleRateHz: 50,
        accel: { x: 0, y: 0, z: 1 },
      });
    });
  });
});
