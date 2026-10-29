// client/src/lib/api.js
// Axios instance + REST API helpers

import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
});

// Inject JWT token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('iot_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auth
export const authApi = {
  login: (data) => api.post('/api/auth/login', data),
  register: (data) => api.post('/api/auth/register', data),
  me: () => api.get('/api/auth/me'),
};

// Incidents
export const incidentApi = {
  list: (params) => api.get('/api/incidents', { params }),
  stats: () => api.get('/api/incidents/stats'),
  getById: (id) => api.get(`/api/incidents/${id}`),
  updateStatus: (id, data) => api.patch(`/api/incidents/${id}/status`, data),
  cancel: (id, data) => api.post(`/api/incidents/${id}/cancel`, data),
};

// Devices
export const deviceApi = {
  list: (params) => api.get('/api/devices', { params }),
  getById: (id) => api.get(`/api/devices/${id}`),
  register: (data) => api.post('/api/devices', data),
  update: (id, data) => api.patch(`/api/devices/${id}`, data),
};

// Telemetry
export const telemetryApi = {
  history: (deviceId, params) => api.get(`/api/telemetry/${deviceId}`, { params }),
  latest: (params) => api.get('/api/telemetry/latest', { params }),
};

// ML Service (direct to ml-service)
const ML_URL = import.meta.env.VITE_ML_URL || 'http://localhost:8000';
const mlAxios = axios.create({ baseURL: ML_URL, timeout: 60000 });

export const mlApi = {
  health: () => mlAxios.get('/health'),
  metrics: () => mlAxios.get('/metrics'),
  train: (data) => mlAxios.post('/train', data),
  predict: (data) => mlAxios.post('/predict', data),
};

// Health checks
export const healthApi = {
  backend: () => api.get('/api/health'),
  ml: () => mlApi.health(),
};
