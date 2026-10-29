// server/tests/integration/api.test.js
process.env.NODE_ENV = 'test';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../../src/app.js';
import { ModelMetric } from '../../src/models/ModelMetric.js';

describe('Server REST API Endpoints', () => {
  let mongoServer;

  before(async () => {
    // If not already connected, connect to memory server
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

  it('GET /api/health returns 200 with service health info', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'healthy');
    assert.equal(res.body.service, 'iot-accident-detection-backend');
    assert.ok(res.body.version);
  });

  it('GET /api/settings returns default system pipeline settings', async () => {
    const res = await request(app).get('/api/settings');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(typeof res.body.data.impactThresholdG === 'number');
    assert.ok(typeof res.body.data.cancelCountdownSeconds === 'number');
  });

  it('POST & GET /api/models/metrics ingests and returns ML benchmark metrics', async () => {
    // POST new metric
    const payload = {
      modelName: 'deep-neural-network-v1',
      metrics: {
        accuracy: 0.985,
        precision: 0.978,
        recall: 0.992,
        f1: 0.985,
        roc_auc: 0.998,
        false_alarm_rate: 0.012,
        latency_ms: 8.5,
      },
      confusionMatrix: [
        [494, 6],
        [4, 496],
      ],
      rocData: {
        fpr: [0.0, 0.012, 1.0],
        tpr: [0.0, 0.992, 1.0],
      },
      trainingSamples: 2000,
    };

    const postRes = await request(app)
      .post('/api/models/metrics')
      .send(payload);

    assert.equal(postRes.status, 201);
    assert.equal(postRes.body.success, true);
    assert.equal(postRes.body.data.modelName, 'deep-neural-network-v1');

    // GET metrics
    const getRes = await request(app).get('/api/models/metrics');
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.success, true);
    assert.ok(getRes.body.data.length >= 1);
    const found = getRes.body.data.find((m) => m.modelName === 'deep-neural-network-v1');
    assert.ok(found);
    assert.equal(found.metrics.recall, 0.992);
  });

  it('returns 404 with structured error JSON for nonexistent routes', async () => {
    const res = await request(app).get('/api/nonexistent-endpoint-test');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.message.includes('Route not found'));
  });
});
