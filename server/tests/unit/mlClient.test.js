// server/tests/unit/mlClient.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { predict } from '../../src/services/mlClientService.js';
import config from '../../src/config/index.js';

describe('ML Client Service (Timeout, Retry, and Fallback)', () => {
  it('successfully returns prediction when ML microservice is online and responds', async () => {
    // Spin up temporary mock ML microservice server
    const mockServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/predict') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          label: 'ACCIDENT',
          confidence: 0.94,
          peakG: 6.2,
          model: 'fastapi-dnn-v1',
        }));
      }
    });

    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = mockServer.address().port;
    const originalUrl = config.mlServiceUrl;
    config.mlServiceUrl = `http://127.0.0.1:${port}`;

    try {
      const mockFeatures = { peakG: 6.2, speedInitial: 60, speedDropRatio: 0.9, maxGyroDps: 50 };
      const res = await predict('TEST-DEV-001', [], mockFeatures);

      assert.equal(res.label, 'ACCIDENT');
      assert.equal(res.confidence, 0.94);
      assert.equal(res.detectionSource, 'ML');
      assert.equal(res.model, 'fastapi-dnn-v1');
      assert.ok(typeof res.latencyMs === 'number');
    } finally {
      config.mlServiceUrl = originalUrl;
      await new Promise((resolve) => mockServer.close(resolve));
    }
  });

  it('automatically falls back to Rule Engine when ML service times out or is unreachable', async () => {
    // Point to non-routable port or unreachable endpoint with low timeout
    const originalUrl = config.mlServiceUrl;
    const originalTimeout = config.mlTimeoutMs;
    config.mlServiceUrl = 'http://127.0.0.1:59999'; // unreachable port
    config.mlTimeoutMs = 100; // fast fail for test speed

    try {
      const crashFeatures = {
        peakG: 6.5,
        speedInitial: 60,
        speedFinal: 0,
        speedDropRatio: 1.0,
        maxGyroDps: 45,
      };

      const res = await predict('TEST-DEV-001', [], crashFeatures);

      assert.equal(res.detectionSource, 'RULE_BASED');
      assert.equal(res.model, 'rule-fallback');
      assert.equal(res.label, 'ACCIDENT');
      assert.ok(res.confidence >= 0.78);
      assert.ok(res.reason.includes('Impact spike'));
    } finally {
      config.mlServiceUrl = originalUrl;
      config.mlTimeoutMs = originalTimeout;
    }
  });
});
