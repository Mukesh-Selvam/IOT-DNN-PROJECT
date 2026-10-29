# IoT-Based Vehicle Accident Detection and Alert System
## System Architecture & Technical Specifications

### 1. High-Level Architecture

The system utilizes an event-driven IoT microservice architecture. Telemetry streams from virtual or physical vehicle IoT units via MQTT or HTTP fallback, undergoes sliding-window feature ingestion, evaluates inference via a Python Deep Neural Network (DNN) service, and broadcasts real-time telemetry and incident alerts to a modern React dashboard.

```mermaid
graph TD
    subgraph IoT_Layer ["IoT & Simulation Layer"]
        ESP32["Virtual ESP32 Simulator<br/>(Node.js Fleet)"]
        MPU["MPU6050 Accelerometer/Gyro<br/>(50-100Hz + Gaussian Noise)"]
        GPS["GPS Neo-6M<br/>(Coimbatore-Pollachi Route)"]
        BUZZ["Virtual Buzzer Indicator<br/>(Command Subscriber)"]
        
        MPU --> ESP32
        GPS --> ESP32
        ESP32 -.-> BUZZ
    end

    subgraph Messaging ["Message Broker"]
        MOSQ["Eclipse Mosquitto MQTT<br/>(Port 1883 / WS 9001)"]
    end

    subgraph Backend_Layer ["Backend & Orchestration (Node.js/Express)"]
        MQTT_SUB["MQTT Subscriber & HTTP Ingestion"]
        BUFFER["Sliding Window Buffer<br/>(2s Window, 50% Overlap)"]
        RULE_ENG["Fallback Rule Engine<br/>(Peak g > 4.0 & Sudden Decel)"]
        INCIDENT_MGR["Incident Manager & Debounce"]
        WS_GATEWAY["Socket.IO Server<br/>(Real-Time Broadcast)"]
        ALERT_SVC["Multi-Channel Alert Dispatcher<br/>(Email, Telegram, In-App)"]
        API_ROUTER["REST API Routes<br/>(Auth, Devices, Incidents)"]
        
        MQTT_SUB --> BUFFER
        BUFFER --> RULE_ENG
        INCIDENT_MGR --> ALERT_SVC
        INCIDENT_MGR --> WS_GATEWAY
    end

    subgraph ML_Layer ["Machine Learning Microservice (Python FastAPI)"]
        FASTAPI["FastAPI App (Port 8000)"]
        DNN["Deep Neural Network (DNN)<br/>Binary Accident Classifier"]
        AE["Autoencoder Baseline<br/>Reconstruction Anomaly"]
        MOMENT["MOMENT Foundation Baseline"]
        
        FASTAPI --> DNN
        FASTAPI --> AE
        FASTAPI --> MOMENT
    end

    subgraph Database_Layer ["Persistence Layer"]
        MONGO[("MongoDB 6.0<br/>Telemetry, Incidents, Users")]
    end

    subgraph Frontend_Layer ["User Interface (React + Vite)"]
        DASHBOARD["Live Operations Dashboard"]
        MAP_VIEW["Leaflet Live GPS Fleet Map"]
        CHART_VIEW["Recharts 3-Axis Accel & Gyro"]
        INCIDENT_VIEW["Incident History & Map Replay"]
        CTRL_PANEL["Crash Scenario Simulator Panel"]
        METRICS_VIEW["Model Comparison & Confusion Matrix"]
    end

    ESP32 -->|"MQTT Pub: vehicle/{deviceId}/telemetry"| MOSQ
    MOSQ -->|"MQTT Sub"| MQTT_SUB
    MQTT_SUB -->|"Write raw with TTL"| MONGO
    BUFFER -->|"POST /predict (Window)"| FASTAPI
    FASTAPI -->|"Accident Prob + Label"| BUFFER
    BUFFER -->|"Accident Confirmed"| INCIDENT_MGR
    INCIDENT_MGR -->|"Save Incident"| MONGO
    INCIDENT_MGR -->|"MQTT Pub: vehicle/{deviceId}/command (Buzzer ON)"| MOSQ
    MOSQ -->|"MQTT Sub"| ESP32
    API_ROUTER --> MONGO
    WS_GATEWAY -->|"Socket.io Push"| DASHBOARD
    CTRL_PANEL -->|"REST /api/simulator/scenario"| API_ROUTER
    DASHBOARD --> MAP_VIEW
    DASHBOARD --> CHART_VIEW
```

---

### 2. End-to-End Data Flow

```mermaid
sequenceDiagram
    autonumber
    actor Driver as Vehicle Driver / Simulator
    participant Sim as Virtual ESP32
    participant MQTT as Mosquitto Broker
    participant Backend as Node.js Backend
    participant ML as FastAPI DNN Service
    participant DB as MongoDB
    participant UI as React Dashboard
    participant Alert as Emergency Dispatcher

    Sim->>Sim: Sample MPU6050 (50Hz) & GPS (1Hz)
    Sim->>MQTT: Publish 'vehicle/{deviceId}/telemetry'
    MQTT->>Backend: Ingest Telemetry Stream
    Backend->>DB: Store Telemetry (capped / TTL)
    Backend->>UI: Broadcast Telemetry via Socket.io
    Backend->>Backend: Append to 2s Sliding Buffer (100 samples)
    
    alt Buffer Ready (every 1s step)
        Backend->>ML: POST /predict (Raw/Feature Window)
        ML-->>Backend: { isAccident: true, confidence: 0.94, label: "ACCIDENT" }
        
        alt Confidence >= 0.75 OR Rule Fallback Triggered
            Backend->>DB: Create Incident (Status: DETECTED, Peak g: 4.8)
            Backend->>MQTT: Publish 'vehicle/{deviceId}/command' { buzzer: "ON" }
            MQTT->>Sim: Sound Virtual Buzzer
            Backend->>UI: Emit 'accident:detected' (Audio Alert + 15s Countdown)
            
            alt Driver cancels within 15s window
                Driver->>UI: Click "Cancel (False Alarm)"
                UI->>Backend: POST /api/incidents/:id/cancel
                Backend->>DB: Update Incident (Status: FALSE_ALARM)
                Backend->>MQTT: Publish command { buzzer: "OFF" }
                Backend->>UI: Emit 'incident:cancelled'
            else Countdown expires (Real Accident)
                Backend->>DB: Update Incident (Status: CONFIRMED)
                Backend->>Alert: Dispatch Nodemailer (Ethereal/Mailtrap) + Telegram
                Backend->>UI: Emit 'incident:confirmed'
            end
        end
    end
```

---

### 3. Hardware-to-Simulation Mapping Table

| Physical IoT Component | Hardware Specification | Software Emulation Equivalent | Implementation Details |
| :--- | :--- | :--- | :--- |
| **Microcontroller** | ESP32-WROOM-32 (Dual-core 240MHz, Wi-Fi/BLE) | Node.js Multi-Vehicle Fleet Worker | `simulator/src/vehicle.js` & `fleet.js`<br/>Configurable vehicle instances, high-resolution drift-free 50Hz loop, per-vehicle MQTT client with Last-Will. |
| **Motion Sensor** | MPU-6050 6-DoF IMU (I2C, ±16g, ±2000°/s) | Physical 6-DoF Sensor Synthesizer | `simulator/src/sensors.js` (`MPU6050Sensor`)<br/>Generates 3-axis accel ($a_x, a_y, a_z$) in $g$ and gyro ($g_x, g_y, g_z$) in $^{\circ}$/s with gravity vector ($1.0g$), 16-bit ADC quantization (2048 LSB/g), saturation clipping, and speed-dependent noise $\mathcal{N}(0, \sigma^2)$. |
| **Location Sensor** | u-blox NEO-6M GPS Module (UART, 9600 baud, 1Hz NMEA) | Coordinate Waypoint Interpolator | `simulator/src/geo.js` & `sensors.js` (`GPSSensor`)<br/>Interpolates GPS coordinates across real-world Tamil Nadu routes (Coimbatore $\leftrightarrow$ Pollachi NH-83), calculating bearing, speed, 1.5m jitter, and 1Hz fix. |
| **Emergency Buzzer** | Active Piezo Buzzer 5V (GPIO23 output) | Virtual Buzzer Actuator | `simulator/src/buzzer.js` (`VirtualBuzzer`)<br/>Extends EventEmitter with `turnOn()` / `turnOff()`, 60-second auto-off timer, and listens to `vehicle/{deviceId}/command`. |
| **Driver Cancel Switch**| Momentary Push Button (GPIO 18 pull-up) | UI Cancel Button & Simulated CLI Trigger | `vehicle.cancelAlert()`<br/>Driver press emits `ALERT_CANCELLED` and clears buzzer/countdown. Also supports scheduled false-alarm demo (`--cancel-after`). |

---

### 4. MQTT Topic Architecture

| Topic Pattern | Direction | Payload Example / Schema | Description |
| :--- | :--- | :--- | :--- |
| `vehicle/{deviceId}/telemetry` | Simulator $\rightarrow$ Backend | `{"deviceId":"ESP32-SIM-001","ts":1710000000,"seq":101,"sampleRateHz":50,"accel":{"x":0.02,"y":0.01,"z":0.99},"gyro":{"x":0.1,"y":0.0,"z":-0.2},"gps":{"lat":10.998,"lng":76.966,"speed":52.4,"heading":184},"buzzer":"OFF","alert":{"pending":false,"remainingSec":0},"meta":{...}}` | High-frequency telemetry stream (50 Hz, QoS 0). |
| `vehicle/{deviceId}/event` | Simulator $\rightarrow$ Backend | `{"type":"IMPACT_DETECTED","deviceId":"ESP32-SIM-001","ts":1710000000,"peakG":8.4,"gps":{...}}` | Critical event notices (`IMPACT_DETECTED`, `ALERT_CONFIRMED`, `ALERT_CANCELLED`, `BUZZER_ON`, `BUZZER_OFF`) (QoS 1). |
| `vehicle/{deviceId}/status` | Simulator $\rightarrow$ Backend | `{"deviceId":"ESP32-SIM-001","online":true,"plate":"TN-37-AB-1234","route":"Pollachi - Coimbatore Corridor","sampleRateHz":50,"ts":1710000000}` | Connection state (Retained, QoS 1 with Last-Will offline payload). |
| `vehicle/{deviceId}/command` | Backend $\rightarrow$ Simulator | `{"buzzer":"ON"|"OFF"}` or `{"cmd":"CANCEL"}` or `{"cmd":"RESET"}` | Actuator commands triggering buzzer or cancelling/resetting incidents (QoS 1). |
| `simulator/control` | Control $\rightarrow$ Simulator | `{"id":"req-1","action":"trigger","deviceId":"1","scenario":"frontal_collision","cancelAfterSec":5}` | Global remote fleet orchestration (QoS 1). |
| `simulator/control/response` | Simulator $\rightarrow$ Control | `{"id":"req-1","success":true,"affected":["ESP32-SIM-001"],"scenario":"frontal_collision"}` | Remote command acknowledgment (QoS 1). |

