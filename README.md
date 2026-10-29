# 🚗 IoT-Based Vehicle Accident Detection & Alert System

> **Simulation-Only** — Full software stack that mirrors real ESP32 + MPU6050 + GPS hardware behaviour. Swap the simulator for real devices with zero backend changes.

---

## 📐 Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Virtual ESP32 Fleet (Node.js Simulator)                             │
│  3 vehicles • MPU6050 + GPS • buzzer • MQTT pub • HTTP control API  │
└─────────────────────────┬────────────────────────────────────────────┘
                          │  MQTT  vehicle/+/telemetry
                          │         vehicle/+/status
                          │         vehicle/+/event
              ┌───────────▼────────────┐
              │  Eclipse Mosquitto     │  :1883 (MQTT) · :9001 (WS)
              └───────────┬────────────┘
                          │
              ┌───────────▼────────────────────────────────┐
              │  Node.js / Express Backend   :5000          │
              │  ├─ MQTT Subscriber & ingestion             │
              │  ├─ Sliding-window ring buffer (per device) │
              │  ├─ Feature extraction + ML client          │
              │  ├─ Incident lifecycle manager              │
              │  ├─ Alert dispatcher (email/SMS/in-app)     │
              │  ├─ REST API (auth / incidents / devices)   │
              │  └─ Socket.IO gateway (real-time push)      │
              └───────┬──────────────────────┬─────────────┘
                      │                      │
          ┌───────────▼───────┐  ┌───────────▼───────────┐
          │  MongoDB :27017   │  │  Python FastAPI :8000  │
          │  Incidents        │  │  TensorFlow DNN        │
          │  Telemetry        │  │  POST /predict         │
          │  Users / Devices  │  │  POST /train           │
          └───────────────────┘  │  GET  /metrics         │
                                 └───────────────────────┘
                                            ▲
                                            │ HTTP
              ┌─────────────────────────────┘
              │  React + Vite Dashboard  :5173
              │  ├─ Live accelerometer / gyro charts
              │  ├─ Real-time incident alerts (Socket.IO)
              │  ├─ Fleet monitor with signal bars
              │  ├─ Leaflet live map (dark tile)
              │  └─ ML Console (train + metrics + history)
              └───────────────────────────────────────────
```

---

..## 🏗️ Services at a Glance

| Service | Stack | Port | Role |
|:--------|:------|:-----|:-----|
| **Mosquitto** | Eclipse Mosquitto 2.0 | `1883` / `9001` | MQTT pub/sub broker |
| **MongoDB** | MongoDB 6.0 | `27017` | Persistence (incidents, telemetry, users) |
| **Backend** | Node.js 20 · Express · Socket.IO · Mongoose | `5000` | Ingestion, sliding-window, alerts, REST API |
| **ML Service** | Python 3.10 · FastAPI · TensorFlow-CPU | `8000` | DNN inference (`/predict`) and training (`/train`) |
| **Simulator** | Node.js 20 (virtual ESP32 fleet) | `5055` (control) | Publishes realistic telemetry + crash scenarios |
| **Dashboard** | React 18 · Vite · Tailwind · Recharts · Leaflet | `5173` | Real-time monitoring and ML console |

---

## 🚀 Quick Start

### Option A — Local Development (recommended for active development)

**Prerequisites:** Node.js ≥ 20, Python 3.10+, Docker Desktop

```bash
# 1. Start infrastructure (MQTT broker + MongoDB)
docker compose up -d mosquitto mongodb

# 2. Backend
cd server && npm install && npm run dev

# 3. ML Service
cd ml-service
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 4. Simulator (in a new terminal)
cd simulator && npm install && npm run dev

# 5. Frontend (in a new terminal)
cd client && npm install && npm run dev
# → http://localhost:5173
```

### Option B — Full Docker Stack

```bash
docker compose up --build
# Dashboard → http://localhost:5173
# Backend API → http://localhost:5000
# ML Service → http://localhost:8000/docs
```

---

## 🔑 First Login

Register any email/password on the login page — the first account is created immediately via JWT.

---

## 🧠 ML Service — Train the DNN

1. Open **ML Console** in the dashboard sidebar  
2. Configure sample count, epochs, batch size  
3. Click **🧠 Start Training** — training runs in a background thread  
4. Poll **Refresh Status** or watch the activity log until `Training complete!`  
5. All future `/predict` calls use the trained TensorFlow model (weights persisted to `ml-service/models/`)

Or via cURL:
```bash
curl -X POST http://localhost:8000/train \
  -H "Content-Type: application/json" \
  -d '{"n_samples": 12000, "epochs": 50, "batch_size": 128}'
```

---

## 🚗 Simulator Control API

```bash
# List active vehicles
curl http://localhost:5055/vehicles

# Trigger a crash scenario on a specific vehicle
curl -X POST http://localhost:5055/trigger \
  -H "Content-Type: application/json" \
  -d '{"vehicleId": "ESP32-SIM-001", "scenario": "head_on"}'

# Pause / resume a vehicle
curl -X POST http://localhost:5055/vehicle/ESP32-SIM-001/pause
curl -X POST http://localhost:5055/vehicle/ESP32-SIM-001/resume

# Change vehicle count at runtime
curl -X POST http://localhost:5055/fleet/scale -d '{"count": 5}'
```

---

## 📡 MQTT Topic Contract

| Topic | Direction | Payload |
|:------|:----------|:--------|
| `vehicle/{id}/telemetry` | Sim → Backend | `{deviceId, ts, accel:{x,y,z}, gyro:{x,y,z}, gps:{lat,lng,speed,heading}, buzzer, sampleRateHz}` |
| `vehicle/{id}/status` | Sim → Backend | `{deviceId, online, plate, route, ts}` (retained) |
| `vehicle/{id}/event` | Sim → Backend | `{type: "IMPACT_DETECTED"\|"ALERT_CANCELLED"\|"ALERT_CONFIRMED", ...}` |
| `vehicle/{id}/command` | Backend → Sim | `{buzzer:"ON"\|"OFF"}` or `{cmd:"CANCEL"\|"RESET"}` |

### Wokwi Hardware Simulation

The [Wokwi project files](wokwi/README.md) connect an ESP32 + MPU6050,
buzzer, and cancel button to the existing MQTT, backend/ML, and dashboard path.
They require Wokwi's private IoT Gateway to reach local services. GPS uses the
documented fallback coordinates rather than a simulated GPS receiver.

---

## 🗂️ Project Structure

```
iot-dnn/
├── client/              # React 18 + Vite + Tailwind frontend
│   └── src/
│       ├── context/     # AuthContext (JWT)
│       ├── lib/         # api.js (Axios) + socket.js (Socket.IO)
│       ├── pages/       # Dashboard, Incidents, Fleet, Map, MLConsole
│       └── components/  # Sidebar
├── server/              # Node.js + Express backend
│   └── src/
│       ├── config/      # Centralised config
│       ├── models/      # Mongoose: User, Device, Incident, Telemetry, Setting
│       ├── routes/      # auth, incidents, devices, telemetry, contacts
│       ├── controllers/ # Thin request handlers
│       ├── services/    # Business logic: incident, alert, ML client, sliding-window
│       ├── mqtt/        # client.js, subscriber.js, publisher.js
│       ├── sockets/     # Socket.IO gateway + JWT auth
│       ├── middleware/   # auth, errorHandler, rateLimiter, validate
│       └── utils/       # logger, apiResponse, asyncHandler, features
├── simulator/           # Virtual ESP32 fleet
│   └── src/
│       ├── vehicle.js   # Per-vehicle state machine
│       ├── sensors.js   # MPU6050 + GPS emulation
│       ├── scenarios.js # Crash profiles (head-on, rollover, side-impact, …)
│       ├── fleet.js     # Multi-vehicle orchestrator
│       ├── link.js      # MQTT publish + Last-Will
│       ├── control.js   # HTTP control API (port 5055)
│       └── geo.js       # Route builder + Haversine
├── wokwi/               # Wokwi ESP32, MPU6050, MQTT firmware + wiring
├── ml-service/          # Python FastAPI + TensorFlow
│   └── app/
│       ├── main.py      # FastAPI routes: /health /metrics /predict /train
│       ├── model.py     # DNN build/train/persist/load/infer
│       └── data_generator.py  # Synthetic labelled dataset
├── mosquitto/config/    # mosquitto.conf
├── docker-compose.yml
└── .env.example
```

---

## 🌐 REST API Endpoints

```
POST   /api/auth/register       Register user
POST   /api/auth/login          Login → JWT
GET    /api/auth/me             Current user (auth required)

GET    /api/incidents           List/filter incidents
GET    /api/incidents/stats     Aggregate stats
GET    /api/incidents/:id       Single incident
PATCH  /api/incidents/:id/status   Update status
POST   /api/incidents/:id/cancel   Cancel incident

GET    /api/devices             List devices
POST   /api/devices             Register device
GET    /api/devices/:id         Single device

GET    /api/telemetry/:deviceId  History
GET    /api/telemetry/latest     Latest per device

GET    /api/health              Backend health
```

---

## 📦 Environment Variables

Copy `.env.example` to `.env` and adjust:

| Variable | Default | Description |
|:---------|:--------|:------------|
| `MONGODB_URI` | `mongodb://localhost:27017/iot_accident_detection` | MongoDB connection string |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | Mosquitto broker URL |
| `JWT_SECRET` | *(change in production)* | JWT signing secret |
| `ML_SERVICE_URL` | `http://localhost:8000` | FastAPI ML service URL |
| `CORS_ORIGIN` | `http://localhost:5173` | Frontend origin for CORS |
| `PEAK_G_THRESHOLD` | `4.0` | Screening threshold (g) |
| `ACCIDENT_CONFIDENCE_THRESHOLD` | `0.75` | Min ML confidence to raise incident |
| `VEHICLE_COUNT` | `3` | Number of simulated vehicles |
| `VITE_API_URL` | `http://localhost:5000` | Frontend → Backend URL |
| `VITE_ML_URL` | `http://localhost:8000` | Frontend → ML Service URL |

---

## 🔄 Detection Pipeline

```
High-freq telemetry (50 Hz) → MQTT → Backend Subscriber
  └─ Ring buffer (2s sliding window, 50% overlap)
       └─ Screening filter (peakG ≥ 2.5g OR speedDrop ≥ 40% OR gyro ≥ 120°/s)
            └─ Feature extraction (14 features)
                 └─ HTTP POST /predict → ML Service
                      ├─ DNN model (when trained) → confidence
                      └─ Rule-based fallback (if model not ready)
                           └─ confidence ≥ 0.75 → Incident created
                                ├─ Socket.IO push → Dashboard alert
                                ├─ 15s cancellation countdown
                                └─ Alert dispatch (email / SMS / in-app)
```

---

## 📚 Complete Project Documentation

| Document | Description |
|:---------|:------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | High-level system architecture, data flow, component sequence, and Mermaid diagrams |
| [RESULTS.md](docs/RESULTS.md) | Measured empirical results, confusion matrices, ROC-AUC, 95% CIs, and benchmark comparisons |
| [API_SPEC.md](docs/API_SPEC.md) | Detailed REST API routes, schemas, Socket.IO contracts, and Postman specs |
| [postman_collection.json](docs/postman_collection.json) | Importable Postman v2.1 collection for testing all server endpoints |
| [REAL_HARDWARE_MIGRATION.md](docs/REAL_HARDWARE_MIGRATION.md) | ESP32 + MPU6050 + NEO-6M wiring pinouts, Arduino C++ `.ino` firmware, and ₹1,293 BOM |
| [PROJECT_REPORT_NOTES.md](docs/PROJECT_REPORT_NOTES.md) | Capstone report text: Abstract, Mathematical formulation, Limitations, and 20 Viva Q&As |

---

## ⏱️ 5-Minute Live Demo Script

Follow this step-by-step walk-through to demonstrate the system end-to-end:

### Step 1: Start Services & Seed Database
```bash
# 1. Seed demo users, vehicles, and contacts
npm run seed
# Output: Created Admin (admin@iot-accident.local / Password123!) and 3 registered ESP32 devices
```

### Step 2: Launch Dashboard & Log In
1. Open your browser at `http://localhost:5173`.
2. Log in using `admin@iot-accident.local` and `Password123!`.
3. Verify the **Fleet Status** page displays all 3 simulated vehicles (`ESP32-SIM-001`, `ESP32-SIM-002`, `ESP32-SIM-003`) as **ONLINE** with active telemetry badges.
4. Open the **Live Map** page to view vehicles moving along their GPS waypoints.

### Step 3: Trigger a Crash Scenario
1. Navigate to the **Fleet Monitor** or use the simulator control API in your terminal:
```bash
curl -X POST http://localhost:5055/trigger \
  -H "Content-Type: application/json" \
  -d '{"vehicleId": "ESP32-SIM-001", "scenario": "head_on"}'
```
2. Within **200–500 ms**, observe:
   - Vehicle telemetry registers peak deceleration ($> 4.5g$) and rotational impulse.
   - The sliding ring buffer screens the spike and submits features to the DNN `/predict` endpoint.
   - DNN returns classification `ACCIDENT` with confidence $\ge 0.95$.
   - Backend activates the **Buzzer** on the virtual vehicle (`vehicle/ESP32-SIM-001/buzzer`).
   - A critical red alert modal appears on the Dashboard with a **15-second cancellation countdown**.

### Step 4: Test Driver False-Alarm Cancellation
1. On the dashboard banner (or via the physical button simulation), click **"Cancel / False Alarm"** before the 15 seconds expire.
2. Observe:
   - Cancellation is persisted to MongoDB (`status: FALSE_ALARM`).
   - Buzzer immediately stops (`buzzer: OFF`).
   - Emergency contacts are NOT notified.

### Step 5: Test Confirmed Crash Dispatch
1. Trigger a second crash scenario:
```bash
curl -X POST http://localhost:5055/trigger \
  -H "Content-Type: application/json" \
  -d '{"vehicleId": "ESP32-SIM-002", "scenario": "rollover"}'
```
2. Allow the 15-second countdown to elapse without clicking cancel.
3. Observe:
   - Status transitions to `CONFIRMED`.
   - Dispatcher broadcasts emergency alert to configured SMS and email handlers with precise GPS coordinates and Google Maps link.
   - Incident is archived in the **Incident History** table with classification source `ML (DNN)`.

---

## 🧪 Automated Testing Matrix

Run the test suites across each microservice:

```bash
# 1. Simulator Tests (21 unit tests covering kinematic physics, scenarios, and dataset splitting)
cd simulator && npm test

# 2. Server Tests (Unit, integration, sliding window, ML timeout fallback, and pipeline)
cd server && npm test

# 3. Frontend Unit & Component Tests (Vitest covering auth guards, countdown banner, control panel)
cd client && npm test

# 4. ML Service Tests (Pytest covering feature extraction, DNN inference, and fallback rules)
cd ml-service && pytest
```

---

## 🛠️ Troubleshooting & Common Pitfalls

| Issue | Cause | Resolution |
|:------|:------|:-----------|
| **`ECONNREFUSED 127.0.0.1:27017`** | MongoDB service is not running | Run `docker compose up -d mongodb` or start local MongoDB service (`net start MongoDB`). |
| **`ECONNREFUSED 127.0.0.1:1883`** | Mosquitto MQTT broker offline | Run `docker compose up -d mosquitto` or check Mosquitto service status. |
| **`Rate limit exceeded (429)`** | Too many telemetry HTTP fallback requests | Ensure simulator uses MQTT (`mqtt://localhost:1883`) rather than HTTP for 50Hz high-throughput telemetry. |
| **Vite chunk warning ($> 500\text{ kB}$)** | Monolithic bundle without code-splitting | Fixed in `client/vite.config.js` via dynamic imports and vendor chunking (`leaflet`, `recharts`). |
| **MOMENT-1-small load failure** | PyTorch or pre-trained weights missing on CPU host | Expected: Fallback seamlessly defaults to lightweight TensorFlow/Keras DNN and rule-based pipeline. |
| **Port conflict on `5000` or `5173`** | Another node process is holding the port | Terminate the orphan process (`Get-Process -Id (Get-NetTCPConnection -LocalPort 5000).OwningProcess | Stop-Process`). |

---

*Built with ❤️ — Phase 1 (Infra) + Phase 2 (Simulator) + Phase 3 (Backend) + Phase 4 (ML Service) + Phase 5 (Dashboard) complete.*
