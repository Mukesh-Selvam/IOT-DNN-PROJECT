# Virtual ESP32 Fleet Device Simulator

A standalone Node.js simulation engine that accurately emulates a fleet of vehicle IoT telemetry units comprising **ESP32-WROOM-32**, **MPU-6050 6-DoF IMU**, **u-blox NEO-6M GPS**, and an **active piezo buzzer**.

---

## 🚀 Key Capabilities
- **High-Rate Drift-Free Physics Loop**: 50 Hz default (configurable 10–200 Hz) with self-correcting microsecond compensation.
- **Physical MPU6050 Sensor Emulation**:
  - $x$ forward, $y$ left, $z$ up (resting $a_z \approx +1.0$ g).
  - 16-bit ADC quantization (2048 LSB/g, 16.4 LSB/dps).
  - Hardware saturation clipping at $\pm 16.0$ g and $\pm 2000^\circ$/s.
  - Realistic Gaussian road vibration that scales with vehicle speed.
  - Rollover orientation modeling: gravity vector permanently rotates while stopped.
- **NEO-6M GPS Interpolator**:
  - 1 Hz fix rate, ~1.5 m Gaussian position noise, speed (km/h), heading, satellites (8–12), HDOP.
  - 3 Real-world Tamil Nadu routes:
    1. Pollachi to Coimbatore (NH 209 / NH 83)
    2. Coimbatore City Urban Circuit (Gandhipuram, RS Puram, Race Course, Avinashi Rd)
    3. Pollachi to Udumalpet (NH 83)
- **8 Physics-Inspired Scenarios**:
  - *Non-Accident*: `normal`, `hard_braking` (0.45–0.75 g decel), `sharp_turn` (0.35–0.6 g lateral), `pothole` (vertical bounce $\le 3.5$ g, speed unchanged).
  - *Accident*: `frontal_collision` (8–14 g spike, stops in 0.35 s), `side_impact` (6–11 g lateral spike, yaw spin, stops in 1.2 s), `rollover` (trip impact, 150–400 dps roll, gravity rotates), `rear_end` (+5 to 9 g push, stop).
- **Firmware-like Local Crash & Alert Logic**:
  - Instantaneous $|a| \ge 4.0$ g triggers buzzer ON, emits `IMPACT_DETECTED`, and starts 15s countdown.
  - Driver button / API `/cancel` turns buzzer OFF and emits `ALERT_CANCELLED`.
  - Countdown expiry emits `ALERT_CONFIRMED`.
  - Actuation commands via MQTT `vehicle/{id}/command` (`{"buzzer":"ON"|"OFF"}`, `{"cmd":"CANCEL"}`, `{"cmd":"RESET"}`).
- **Dual Control API**:
  - HTTP REST API on port `5055`
  - MQTT Control on topic `simulator/control` and response on `simulator/control/response`.

---

## 📡 MQTT Contract

### 1. `vehicle/{id}/telemetry` (QoS 0)
High-frequency telemetry stream emitted at the configured sample rate (e.g., 50 Hz):
```json
{
  "deviceId": "ESP32-SIM-001",
  "ts": 1710000000000,
  "seq": 1045,
  "sampleRateHz": 50,
  "accel": { "x": 0.02, "y": 0.01, "z": 0.99 },
  "gyro": { "x": 0.1, "y": 0.0, "z": -0.2 },
  "gps": {
    "lat": 10.998,
    "lng": 76.966,
    "speed": 52.4,
    "heading": 184.0,
    "satellites": 10,
    "hdop": 1.05,
    "fix": 1,
    "ts": 1710000000000
  },
  "buzzer": "OFF",
  "alert": { "pending": false, "remainingSec": 0 },
  "meta": {
    "scenario": "normal",
    "label": "NON_ACCIDENT",
    "phase": "active",
    "scenarioTime": 14.5,
    "impactAt": null
  }
}
```

### 2. `vehicle/{id}/event` (QoS 1)
State change and critical safety events:
- `IMPACT_DETECTED`: `{ deviceId, ts, peakG, gps }`
- `ALERT_CONFIRMED`: `{ deviceId, ts, peakG, gps }`
- `ALERT_CANCELLED`: `{ deviceId, ts, reason, gps }`
- `BUZZER_ON`: `{ deviceId, ts, gps }`
- `BUZZER_OFF`: `{ deviceId, ts, gps }`

### 3. `vehicle/{id}/status` (QoS 1, Retained)
- Online announcement on connect: `{ deviceId, online: true, plate, route, sampleRateHz, ts }`
- Last-Will message on disconnect/failure: `{ deviceId, online: false, ts }`

### 4. `vehicle/{id}/command` (QoS 1)
Subscribed by each virtual vehicle for actuator control:
- Buzzer override: `{"buzzer": "ON"}` or `{"buzzer": "OFF"}`
- Driver false alarm cancel: `{"cmd": "CANCEL"}`
- Scenario reset: `{"cmd": "RESET"}`

---

## 🕹️ CLI Usage

```bash
# Start default 3-vehicle fleet connected to local Mosquitto broker
npm start

# Run in dry-run mode (no broker required; prints 1 Hz live console status)
npm run dry-run

# Run automated test suite
npm test

# CLI with custom options:
node src/index.js --vehicles 5 --rate 50 --noise 1.0 --no-auto

# Pre-schedule a crash after 5 seconds with auto-cancellation after 4 seconds (false alarm demo)
node src/index.js --scenario frontal_collision --after 5 --cancel-after 4
```

### CLI Flags
| Flag | Description | Default |
| :--- | :--- | :--- |
| `-v, --vehicles <N>` | Number of simulated vehicles in fleet | `3` |
| `-r, --rate <HZ>` | Sample rate frequency in Hz | `50` |
| `-n, --noise <SCALE>` | Gaussian noise scaling multiplier | `1.0` |
| `-s, --scenario <NAME>` | Initial scenario to trigger | None |
| `-d, --device <ID>` | Target device (ID, 1-based index, or "all") | `1` |
| `--after <SEC>` | Delay before triggering scenario | `0` |
| `--cancel-after <SEC>` | Auto-cancel delay for false-alarm demonstration | None |
| `--seed <N>` | Seed for deterministic reproducible simulation | Random |
| `--no-auto` | Disable random periodic non-accident events | Enabled |
| `--dry-run` | Run standalone without MQTT broker | `false` |
| `--no-repl` | Disable interactive console prompt (for Docker) | `false` |
| `-l, --list` | List all 8 scenarios and exit | - |

---

## 🌐 HTTP Control API (Port 5055)

| Method | Endpoint | Description | Payload Example |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | Simulator status and uptime | None |
| `GET` | `/scenarios` | List all 8 scenarios with details | None |
| `GET` | `/vehicles` | Current state of all vehicles in fleet | None |
| `POST` | `/trigger` | Trigger a driving scenario | `{"deviceId": "1", "scenario": "frontal_collision", "cancelAfterSec": 5}` |
| `POST` | `/cancel` | Cancel active alert (driver button) | `{"deviceId": "1", "reason": "DRIVER_BUTTON"}` |
| `POST` | `/reset` | Reset vehicle to normal cruising | `{"deviceId": "1"}` |
| `POST` | `/settings` | Update runtime settings | `{"noiseScale": 1.2, "sampleRateHz": 50, "autoEvents": false}` |
| `POST` | `/pause` | Pause fleet physics loop | None |
| `POST` | `/resume` | Resume fleet physics loop | None |
