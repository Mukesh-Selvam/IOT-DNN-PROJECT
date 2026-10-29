// server/src/services/simulatorProxyService.js
// Proxies simulation control requests to the standalone simulator service on port 5055

import axios from 'axios';
import config from '../config/index.js';
import { ApiError } from '../utils/apiResponse.js';

function getClient() {
  const headers = {};
  if (config.simulatorApiKey) {
    headers['X-API-Key'] = config.simulatorApiKey;
  }
  return axios.create({
    baseURL: config.simulatorUrl,
    timeout: 3000,
    headers,
  });
}

function handleProxyError(err) {
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    throw new ApiError(
      `Virtual ESP32 Simulator is unreachable at ${config.simulatorUrl}. Ensure the simulator is started.`,
      503,
      null,
      'SIMULATOR_OFFLINE'
    );
  }
  const status = err.response?.status || 500;
  const msg = err.response?.data?.error || err.message;
  throw new ApiError(msg, status);
}

export async function getScenarios() {
  try {
    const res = await getClient().get('/scenarios');
    return res.data;
  } catch (err) {
    handleProxyError(err);
  }
}

export async function getVehicles() {
  try {
    const res = await getClient().get('/vehicles');
    return res.data;
  } catch (err) {
    handleProxyError(err);
  }
}

export async function triggerScenario(payload) {
  try {
    const res = await getClient().post('/trigger', payload);
    return res.data;
  } catch (err) {
    handleProxyError(err);
  }
}

export async function cancelSimulatorAlert(payload = {}) {
  try {
    const res = await getClient().post('/cancel', payload);
    return res.data;
  } catch (err) {
    handleProxyError(err);
  }
}

export async function resetSimulator(payload = {}) {
  try {
    const res = await getClient().post('/reset', payload);
    return res.data;
  } catch (err) {
    handleProxyError(err);
  }
}

export async function updateSimulatorSettings(payload) {
  try {
    const res = await getClient().post('/settings', payload);
    return res.data;
  } catch (err) {
    handleProxyError(err);
  }
}

export default {
  getScenarios,
  getVehicles,
  triggerScenario,
  cancelSimulatorAlert,
  resetSimulator,
  updateSimulatorSettings,
};
