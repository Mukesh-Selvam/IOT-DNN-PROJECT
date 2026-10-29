# REST & Real-Time WebSocket API Specification

## Base URL
- Local: `http://localhost:5000/api`
- Docker: `http://server:5000/api`

---

## 1. Authentication
### `POST /auth/register`
- **Body**: `{ "name": "Admin", "email": "admin@iot-accident.local", "password": "Password123!" }`
- **Response `201`**: `{ "token": "<jwt>", "user": { "id": "...", "name": "Admin", "email": "..." } }`

### `POST /auth/login`
- **Body**: `{ "email": "admin@iot-accident.local", "password": "Password123!" }`
- **Response `200`**: `{ "token": "<jwt>", "user": { "id": "...", "name": "Admin", "email": "..." } }`

---

## 2. Vehicles / Devices
### `GET /devices`
- **Headers**: `Authorization: Bearer <token>`
- **Response `200`**: `[{ "deviceId": "VEH-001", "name": "Coimbatore Delivery Van", "status": "ONLINE", "lastSeen": "..." }]`

### `POST /devices`
- **Headers**: `Authorization: Bearer <token>`
- **Body**: `{ "deviceId": "VEH-004", "name": "Emergency Patrol Car", "route": "Pollachi-Udumalpet" }`

---

## 3. Telemetry
### `POST /telemetry` (HTTP Fallback for IoT Hardware)
- **Body**:
  ```json
  {
    "deviceId": "VEH-001",
    "ts": 1710000000,
    "accel": { "x": 0.05, "y": 0.02, "z": 0.98 },
    "gyro": { "x": 0.1, "y": -0.2, "z": 0.0 },
    "gps": { "lat": 10.998, "lng": 76.966, "speed": 45.2, "heading": 182.0 },
    "buzzer": false
  }
  ```
- **Response `202`**: `{ "status": "queued" }`

### `GET /telemetry/recent/:deviceId?limit=50`
- **Response `200`**: `[{ ...telemetryPoint }]`

---

## 4. Incidents & Alerts
### `GET /incidents`
- **Query**: `?status=DETECTED,CONFIRMED&limit=20`
- **Response `200`**: `[{ "id": "...", "deviceId": "VEH-001", "timestamp": "...", "peakG": 4.8, "confidence": 0.94, "status": "CONFIRMED", "location": { "lat": 10.998, "lng": 76.966 } }]`

### `POST /incidents/:id/cancel` (False Alarm Cancellation)
- **Body**: `{ "reason": "Driver button pressed / Minor bump" }`
- **Response `200`**: `{ "status": "FALSE_ALARM", "buzzer": "OFF" }`

### `PUT /incidents/:id/status`
- **Body**: `{ "status": "RESOLVED" }`

---

## 5. Simulator Control API (Dedicated Service: Port 5055)

The simulator exposes an autonomous HTTP control interface on port 5055 (CORS-enabled, optional `X-API-Key`):

### `GET http://localhost:5055/health`
- **Response `200`**: `{ "status": "ok", "service": "iot-simulator", "running": true, "paused": false, "vehicleCount": 3, "sampleRateHz": 50, "uptimeSec": 120 }`

### `GET http://localhost:5055/scenarios`
- **Response `200`**: `{ "scenarios": [{ "id": "frontal_collision", "name": "Frontal Collision", "type": "ACCIDENT", "description": "..." }, ...] }`

### `GET http://localhost:5055/vehicles`
- **Response `200`**: `{ "vehicles": [{ "deviceId": "ESP32-SIM-001", "plate": "TN-37-AB-1000", "speedKmH": 54.2, "scenario": "normal", "buzzer": "OFF", "alertPending": false, "gps": {...} }] }`

### `POST http://localhost:5055/trigger`
- **Body**: `{ "deviceId": "1" | "ESP32-SIM-001" | "all", "scenario": "frontal_collision", "cancelAfterSec": 5 }`
- **Response `200`**: `{ "success": true, "affected": ["ESP32-SIM-001"], "scenario": "frontal_collision", "cancelAfterSec": 5 }`

### `POST http://localhost:5055/cancel`
- **Body**: `{ "deviceId": "1" | "all", "reason": "DRIVER_BUTTON" }`
- **Response `200`**: `{ "success": true, "affected": ["ESP32-SIM-001"] }`

### `POST http://localhost:5055/reset`
- **Body**: `{ "deviceId": "1" | "all" }`
- **Response `200`**: `{ "success": true, "affected": ["ESP32-SIM-001"] }`

### `POST http://localhost:5055/settings`
- **Body**: `{ "noiseScale": 1.0, "sampleRateHz": 50, "autoEvents": true, "localThresholdG": 4.0, "cancelWindowSec": 15 }`
- **Response `200`**: `{ "success": true, "settings": {...} }`

### `POST http://localhost:5055/pause` & `POST http://localhost:5055/resume`
- **Response `200`**: `{ "success": true, "paused": true/false }`

---

## 6. Socket.IO Events
- `telemetry:update`: Broadcasts real-time coordinate and sensor data.
- `incident:detected`: Emitted instantly upon DNN crash classification (starts 15s countdown).
- `incident:confirmed`: Emitted after cancellation window elapses.
- `incident:cancelled`: Emitted if cancelled by operator or driver button.
- `buzzer:state`: Syncs virtual buzzer audio/visual indicator.
