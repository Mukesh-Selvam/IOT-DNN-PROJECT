// server/tests/integration/incidentLifecycle.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  handleAccidentCandidate,
  cancelIncident,
  confirmIncident,
  updateIncidentStatus,
  setSocketEmitter,
} from '../../src/services/incidentService.js';
import { Incident, INCIDENT_STATUS } from '../../src/models/Incident.js';

describe('Incident Lifecycle & State Machine Integration', () => {
  let mongoServer;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it('creates incident in PENDING_CONFIRMATION status with countdown deadline', async () => {
    const emittedEvents = [];
    setSocketEmitter({
      emit: (event, data) => emittedEvents.push({ event, data }),
    });

    const incident = await handleAccidentCandidate({
      deviceId: 'TEST-VEHICLE-101',
      peakG: 6.8,
      speedAtImpact: 58.5,
      confidence: 0.95,
      detectionSource: 'ML',
      predictedLabel: 'ACCIDENT',
      location: { lat: 11.0168, lng: 76.9558 },
      detectionLatencyMs: 42,
    });

    assert.ok(incident, 'Incident must be created');
    assert.equal(incident.status, INCIDENT_STATUS.PENDING_CONFIRMATION);
    assert.equal(incident.deviceId, 'TEST-VEHICLE-101');
    assert.equal(incident.peakG, 6.8);
    assert.ok(incident.cancelDeadline > new Date(), 'cancelDeadline must be in the future');

    // Debounce check: second candidate for same device immediately should return null
    const duplicate = await handleAccidentCandidate({
      deviceId: 'TEST-VEHICLE-101',
      peakG: 7.2,
      speedAtImpact: 50,
      confidence: 0.96,
    });
    assert.equal(duplicate, null, 'Immediate subsequent impact must be debounced');

    // Verify Socket.IO events were dispatched
    const pendingEvent = emittedEvents.find((e) => e.event === 'incident:pending');
    assert.ok(pendingEvent, 'incident:pending event should be emitted');
  });

  it('allows false-alarm cancellation during countdown window', async () => {
    const deviceId = 'TEST-VEHICLE-102';
    const incident = await handleAccidentCandidate({
      deviceId,
      peakG: 5.1,
      speedAtImpact: 40,
      confidence: 0.88,
    });

    assert.ok(incident);
    const cancelled = await cancelIncident(incident._id.toString(), 'Driver pressed false alarm cancel', 'DRIVER');

    assert.equal(cancelled.status, INCIDENT_STATUS.FALSE_ALARM);
    const inDb = await Incident.findById(incident._id);
    assert.equal(inDb.status, INCIDENT_STATUS.FALSE_ALARM);
    assert.ok(inDb.statusHistory.some((h) => h.status === INCIDENT_STATUS.FALSE_ALARM));
  });

  it('confirms incident when countdown expires or is manually confirmed', async () => {
    const deviceId = 'TEST-VEHICLE-103';
    const incident = await handleAccidentCandidate({
      deviceId,
      peakG: 7.5,
      speedAtImpact: 65,
      confidence: 0.98,
    });

    const confirmed = await confirmIncident(incident._id, 'Confirmed by operator');
    assert.equal(confirmed.status, INCIDENT_STATUS.CONFIRMED);

    // State machine transition to RESOLVED
    const resolved = await updateIncidentStatus(incident._id, INCIDENT_STATUS.RESOLVED, 'Driver assisted and scene cleared');
    assert.equal(resolved.status, INCIDENT_STATUS.RESOLVED);
  });

  it('enforces valid status transition rules (rejects invalid transitions)', async () => {
    const deviceId = 'TEST-VEHICLE-104';
    const incident = await handleAccidentCandidate({
      deviceId,
      peakG: 6.0,
      speedAtImpact: 45,
      confidence: 0.9,
    });

    // PENDING_CONFIRMATION cannot transition directly to RESOLVED
    await assert.rejects(
      async () => {
        await updateIncidentStatus(incident._id, INCIDENT_STATUS.RESOLVED, 'Direct invalid jump');
      },
      (err) => err.statusCode === 400 || err.message.includes('Invalid status transition')
    );
  });
});
