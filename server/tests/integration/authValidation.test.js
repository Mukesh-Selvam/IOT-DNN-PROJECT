// server/tests/integration/authValidation.test.js
// Tests for:
// 1. Auth: Register & Login (JWT token generation)
// 2. Protected route without token -> 401 Unauthorized
// 3. Device CRUD (Create, Read, Update, Delete)
// 4. Contact CRUD (Create, Read, Update, Delete)
// 5. Request validation errors -> 400 Bad Request with field details
// 6. Debounce: Duplicate crash within debounce window is ignored
// 7. Restart recovery: Pending incident resumes and expires/confirms correctly
// 8. Settings persistence: Updates persist to DB

process.env.NODE_ENV = 'test';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../../src/app.js';
import { Incident, INCIDENT_STATUS } from '../../src/models/Incident.js';
import { handleAccidentCandidate, resumePendingIncidents } from '../../src/services/incidentService.js';

describe('Auth, CRUD, Validation, Debounce & Recovery Integration Tests', () => {
  let mongoServer;
  let authToken = '';
  let userId = '';
  let createdDeviceId = '';
  let createdContactId = '';

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

  // 1. Auth & 401 Protected Route
  it('registers a new user and logs in to receive JWT token', async () => {
    const email = `testuser_${Date.now()}@example.com`;
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Integration Test User',
        email,
        password: 'Password123!',
      });

    assert.equal(regRes.status, 201, 'Registration must return 201 Created');
    assert.ok(regRes.body.data.accessToken, 'Registration must return JWT accessToken');
    userId = regRes.body.data.user.id;

    // Login with credentials
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email,
        password: 'Password123!',
      });

    assert.equal(loginRes.status, 200, 'Login must return 200 OK');
    assert.ok(loginRes.body.data.accessToken, 'Login must return JWT accessToken');
    authToken = loginRes.body.data.accessToken;
  });

  it('rejects access to protected routes without a token with 401 Unauthorized', async () => {
    const res = await request(app).get('/api/devices');
    assert.equal(res.status, 401, 'Unauthenticated access must return 401');
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.message.toLowerCase().includes('token'));
  });

  // 2. Request Validation Errors (400 with field details)
  it('returns 400 Bad Request with field details on invalid request body', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'A', // Too short (min 2)
        email: 'not-an-email', // Invalid email format
        password: '123', // Too short (min 6)
      });

    assert.equal(res.status, 400, 'Invalid body must return 400 Bad Request');
    assert.equal(res.body.success, false);
    assert.ok(res.body.error, 'Must include error object');
    assert.ok(res.body.error.details, 'Must include field validation details');
    assert.ok(res.body.error.details.length >= 1, 'Must list specific field errors');
  });

  // 3. Device CRUD
  it('performs full Device CRUD (Create, Read, Update, Delete)', async () => {
    const devId = `ESP32-CRUD-${Date.now()}`;

    // Create
    const createRes = await request(app)
      .post('/api/devices')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        deviceId: devId,
        plate: 'TN-01-AB-1234',
        routeName: 'Highway Route 1',
      });

    assert.equal(createRes.status, 201, 'Create device must return 201');
    assert.equal(createRes.body.data.deviceId, devId);
    createdDeviceId = createRes.body.data._id;

    // Read list
    const listRes = await request(app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.data.some((d) => d.deviceId === devId));

    // Update
    const updateRes = await request(app)
      .put(`/api/devices/${createdDeviceId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        plate: 'TN-01-AB-9999',
        routeName: 'Updated Express Route',
      });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.data.plate, 'TN-01-AB-9999');

    // Delete
    const deleteRes = await request(app)
      .delete(`/api/devices/${createdDeviceId}`)
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.body.success, true);
  });

  // 4. Emergency Contact CRUD
  it('performs full Emergency Contact CRUD (Create, Read, Update, Delete)', async () => {
    // Create
    const createRes = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Dr. Emergency Contact',
        phone: '+919876543210',
        email: 'emergency.contact@hospital.org',
        priority: 1,
      });

    assert.equal(createRes.status, 201, 'Create contact must return 201');
    assert.equal(createRes.body.data.name, 'Dr. Emergency Contact');
    createdContactId = createRes.body.data._id;

    // Read list
    const listRes = await request(app)
      .get('/api/contacts')
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.data.some((c) => c._id === createdContactId));

    // Update
    const updateRes = await request(app)
      .put(`/api/contacts/${createdContactId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        phone: '+919999888877',
      });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.data.phone, '+919999888877');

    // Delete
    const deleteRes = await request(app)
      .delete(`/api/contacts/${createdContactId}`)
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(deleteRes.status, 200);
  });

  // 5. Debounce
  it('debounces duplicate accident candidates within the debounce window', async () => {
    const devId = `ESP32-DEBOUNCE-${Date.now()}`;

    // Candidate 1 -> Creates incident
    const inc1 = await handleAccidentCandidate({
      deviceId: devId,
      peakG: 6.5,
      speedAtImpact: 70,
      confidence: 0.98,
      detectionSource: 'ML',
    });
    assert.ok(inc1, 'First crash candidate must create incident');

    // Candidate 2 immediately following -> Debounced
    const inc2 = await handleAccidentCandidate({
      deviceId: devId,
      peakG: 6.8,
      speedAtImpact: 65,
      confidence: 0.97,
      detectionSource: 'ML',
    });
    assert.equal(inc2, null, 'Duplicate crash within debounce window must be debounced (null)');
  });

  // 6. Restart Recovery
  it('resumes and recovers pending incidents after server restart', async () => {
    const devId = `ESP32-RECOVERY-${Date.now()}`;

    // Create an incident with past deadline (already expired while server was offline)
    const expiredIncident = await Incident.create({
      deviceId: devId,
      detectedAt: new Date(Date.now() - 30000),
      cancelDeadline: new Date(Date.now() - 5000), // Passed 5s ago
      status: INCIDENT_STATUS.PENDING_CONFIRMATION,
      peakG: 7.2,
      confidence: 0.95,
      detectionSource: 'ML',
      location: { lat: 10.998, lng: 76.966 },
    });

    // Run recovery logic
    await resumePendingIncidents();

    // Verify incident was confirmed on restart
    const refreshed = await Incident.findById(expiredIncident._id);
    assert.equal(refreshed.status, INCIDENT_STATUS.CONFIRMED, 'Expired pending incident must be confirmed on restart recovery');
  });

  // 7. Settings Persistence
  it('persists updated pipeline settings across queries', async () => {
    const updateRes = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        impactThresholdG: 4.8,
        cancelCountdownSeconds: 20,
      });

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.data.impactThresholdG, 4.8);
    assert.equal(updateRes.body.data.cancelCountdownSeconds, 20);

    // Verify GET retrieves persisted values
    const getRes = await request(app).get('/api/settings');
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.impactThresholdG, 4.8);
    assert.equal(getRes.body.data.cancelCountdownSeconds, 20);
  });
});
