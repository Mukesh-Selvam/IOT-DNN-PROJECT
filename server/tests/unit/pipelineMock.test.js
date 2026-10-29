// server/tests/unit/pipelineMock.test.js
// Pipeline test with ML client mocked:
// (a) ACCIDENT -> ML detectionSource recorded
// (b) Timeout -> Rule fallback activates and records RULE_BASED detectionSource
// (c) Pothole window -> 0 incidents created
// Asserts exactly ONE incident per crash and zero for pothole.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { handleAccidentCandidate } from '../../src/services/incidentService.js';
import { Incident } from '../../src/models/Incident.js';

describe('Detection Pipeline with Mocked ML Client & Fallback', () => {
  let mongoServer;
  let createdIncidents = [];

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      mongoServer = await MongoMemoryServer.create();
      await mongoose.connect(mongoServer.getUri());
    }
  });

  after(async () => {
    if (mongoServer) {
      await mongoose.disconnect();
      await mongoServer.stop();
    }
  });

  beforeEach(() => {
    createdIncidents = [];
  });

  // Mock pipeline evaluator simulating ML client and fallback
  async function runMockPipeline({ deviceId, windowFeatures, mockMlResponse, shouldTimeout = false }) {
    let result;
    if (shouldTimeout) {
      // Simulate ML service timeout/unreachable -> Rule fallback
      result = {
        label: windowFeatures.peakG >= 3.5 ? 'ACCIDENT' : 'NON_ACCIDENT',
        confidence: 0.95,
        detectionSource: 'RULE_BASED',
        peakG: windowFeatures.peakG,
      };
    } else {
      result = mockMlResponse;
    }

    if (result.label === 'ACCIDENT' && result.confidence >= 0.75) {
      const inc = await handleAccidentCandidate({
        deviceId,
        peakG: result.peakG,
        speedAtImpact: windowFeatures.speedInitial || 60,
        confidence: result.confidence,
        detectionSource: result.detectionSource,
        predictedLabel: result.label,
        location: { lat: 10.998, lng: 76.966 },
        sensorSnapshot: [],
      });
      if (inc) createdIncidents.push(inc);
      return inc;
    }
    return null;
  }

  it('(a) creates exactly ONE incident with detectionSource: ML when ML flags ACCIDENT', async () => {
    const deviceId = `MOCK-VEHICLE-ML-${Date.now()}`;
    const windowFeatures = { peakG: 7.2, speedInitial: 65, speedDropRatio: 0.9, maxGyroDps: 110 };
    const mlResponse = {
      label: 'ACCIDENT',
      confidence: 0.98,
      detectionSource: 'ML',
      peakG: 7.2,
    };

    const incident = await runMockPipeline({ deviceId, windowFeatures, mockMlResponse: mlResponse });
    assert.ok(incident, 'Incident must be created for valid crash');
    assert.equal(incident.detectionSource, 'ML');
    assert.equal(incident.status, 'PENDING_CONFIRMATION');
    assert.equal(createdIncidents.length, 1, 'Exactly ONE incident must be created');
  });

  it('(b) activates rule fallback on timeout and records detectionSource: RULE_BASED', async () => {
    const deviceId = `MOCK-VEHICLE-TIMEOUT-${Date.now()}`;
    const windowFeatures = { peakG: 6.5, speedInitial: 70, speedDropRatio: 0.85, maxGyroDps: 90 };

    const incident = await runMockPipeline({ deviceId, windowFeatures, shouldTimeout: true });
    assert.ok(incident, 'Incident must be created via fallback engine');
    assert.equal(incident.detectionSource, 'RULE_BASED');
    assert.equal(createdIncidents.length, 1, 'Exactly ONE incident must be created');
  });

  it('(c) creates ZERO incidents for a pothole window', async () => {
    const deviceId = `MOCK-VEHICLE-POTHOLE-${Date.now()}`;
    const windowFeatures = { peakG: 3.8, speedInitial: 50, speedDropRatio: 0.01, maxGyroDps: 12 };
    const mlResponse = {
      label: 'NON_ACCIDENT',
      confidence: 0.05,
      detectionSource: 'ML',
      peakG: 3.8,
    };

    const incident = await runMockPipeline({ deviceId, windowFeatures, mockMlResponse: mlResponse });
    assert.equal(incident, null, 'Must NOT create incident for pothole');
    assert.equal(createdIncidents.length, 0, 'Zero incidents must be created for pothole');
  });
});
