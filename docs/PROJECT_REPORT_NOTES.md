# Academic & Viva Project Report Notes
## IoT-Based Vehicle Accident Detection and Alert System Using Deep Neural Networks

---

## 1. Project Abstract

Road traffic fatalities remain a critical global concern, with emergency response delays ("the Golden Hour") serving as a primary determinant of survival. Traditional in-vehicle emergency systems (e.g., eCall) rely heavily on blunt threshold triggers that generate excessive false alarms over rough road terrain (potholes, speed breakers, sharp turns), desensitizing dispatchers. This project presents a closed-loop IoT vehicular safety intelligence platform integrating high-frequency (50 Hz) MEMS inertial sensing (MPU6050 accelerometer/gyroscope emulation), satellite positioning (NEO-6M GPS), sliding-window feature engineering, and a Deep Neural Network (DNN) classifier paired with an unsupervised Autoencoder anomaly detector. 

Operating under a strict simulation-first software architecture mirroring physical ESP32 automotive hardware, the edge unit streams structured JSON telemetry via an Eclipse Mosquitto MQTT broker. A Node.js backend organizes incoming sensor streams into 2.0-second sliding windows (50% overlap, 1.0s advance), extracts 14 differential kinematic features (incorporating jerk, angular rates, and speed drop ratios), and queries a Python FastAPI microservice. To safeguard against service outages, a zero-latency rule-based kinematic fallback engine ensures uninterrupted protection. Confirmed crashes initiate a 15-second driver cancellation countdown to eliminate false alarms before triggering multi-channel emergency dispatches (mock SMS to +91-108 central dispatch and Ethereal email). Evaluated on 20,500 simulation windows with $0\%$ group run-id leakage, the system achieves $99.5\%$ recall and $99.2\%$ accuracy under normal driving, maintains zero false alarms across severe pothole shocks, and sustains $>97.1\%$ recall under adversarial low-speed collision dynamics.

---

## 2. Methodology & Mathematical Formulation

### 2.1 Kinematic Sensor Modeling & Coordinate Frames
The vehicle motion is emulated in a body-fixed Cartesian reference frame:
- $a_x$: Longitudinal acceleration (surge, braking, head-on/rear-end impacts).
- $a_y$: Lateral acceleration (sway, cornering, T-bone/side impacts).
- $a_z$: Vertical acceleration (heave, road surface variations, potholes).
- $\omega_x, \omega_y, \omega_z$: Roll, pitch, and yaw angular velocities ($^\circ/\text{s}$).

Total acceleration magnitude is given by:
$$|a(t)| = \sqrt{a_x^2(t) + a_y^2(t) + a_z^2(t)}$$

Jerk ($J$), the rate of change of acceleration signifying mechanical collision shock, is computed discretely:
$$J_i = \frac{||a_i| - |a_{i-1}||}{\Delta t}$$

### 2.2 Sliding Window & Feature Engineering
A sliding window ring buffer of length $W = 100$ samples ($\Delta t = 20\text{ ms}$, $T_w = 2.0\text{ s}$) advances with stride $S = 50$ samples ($50\%$ overlap, $T_s = 1.0\text{ s}$). From each window, a 14-dimensional feature vector $\mathbf{x} \in \mathbb{R}^{14}$ is extracted:
1. $\text{peakG} = \max_{i} |a_i|$
2. $\text{meanTotalG} = \frac{1}{W} \sum_{i=1}^W |a_i|$
3. $\text{rmsTotalG} = \sqrt{\frac{1}{W} \sum_{i=1}^W |a_i|^2}$
4. $\text{stdTotalG} = \sqrt{\frac{1}{W} \sum_{i=1}^W (|a_i| - \text{meanTotalG})^2}$
5. $\text{meanAx}, \text{meanAy}, \text{meanAz}$ (directional bias vector)
6. $\text{maxJerkGPerS} = \max_{i} J_i$
7. $v_{\text{initial}} = v(t_0), \quad v_{\text{final}} = v(t_W), \quad \Delta v = v_{\text{initial}} - v_{\text{final}}$
8. $\text{speedDropRatio} = \frac{v_{\text{initial}} - v_{\text{final}}}{\max(v_{\text{initial}}, 1.0)}$
9. $\text{maxGyroDps} = \max_i \sqrt{\omega_{x,i}^2 + \omega_{y,i}^2 + \omega_{z,i}^2}$
10. $\text{meanGyroDps} = \frac{1}{W} \sum_{i=1}^W |\omega_i|$

### 2.3 Deep Neural Network Architecture
The classifier utilizes a 4-layer fully connected architecture with Batch Normalization and Dropout:
- Input: $\mathbf{x} \in \mathbb{R}^{14}$
- Layer 1: Dense(64, activation='relu') $\rightarrow$ BatchNorm $\rightarrow$ Dropout(0.2)
- Layer 2: Dense(32, activation='relu') $\rightarrow$ BatchNorm $\rightarrow$ Dropout(0.2)
- Layer 3: Dense(16, activation='relu')
- Output: Dense(1, activation='sigmoid') $\rightarrow \hat{y} \in [0, 1]$

Loss formulation: Binary Cross-Entropy with inverse class weighting to counter the $1:9$ crash imbalance:
$$\mathcal{L} = - \frac{1}{N} \sum_{i=1}^N \left[ w_1 y_i \log(\hat{y}_i) + w_0 (1 - y_i) \log(1 - \hat{y}_i) \right]$$

---

## 3. System Limitations

1. **Cellular Shadowing & Out-of-Coverage Zones**: Real vehicle implementations in rural topography face cellular dead zones. While local buzzer and audio alerts trigger autonomously on the ESP32, remote MQTT alerts cannot transmit until connection is re-established.
2. **GPS Multi-Path & Urban Canyons**: In high-rise urban environments, GPS fix accuracy may degrade or experience drift during rapid satellite lock acquisition.
3. **Low-Speed Fender Benders**: Glancing impacts under $15\text{ km/h}$ generate acceleration signatures ($<1.8g$) that overlap with vigorous potholes or curb strikes.
4. **Extreme High-Frequency MEMS Vibration**: Diesel engines and heavy commercial suspension resonances without mechanical rubber vibration dampers can introduce high-frequency baseline noise.
5. **Driver Incapacitation vs. False Alarms**: The 15-second cancellation countdown prevents premature responder dispatch; however, in severe head-on trauma where the driver is unconscious, emergency services are delayed by precisely 15 seconds.

---

## 4. Future Enhancements

1. **Edge TinyML (TensorFlow Lite for Microcontrollers)**: Quantize the 4-layer DNN to 8-bit integers (INT8) and flash directly onto the ESP32 dual-core Xtensa LX6 MCU for sub-millisecond local inference independent of cloud networks.
2. **OBD-II CAN Bus Telematics**: Interface with vehicle CAN bus via MCP2515 to ingest airbag deployment sensors, seatbelt pre-tensioner states, brake fluid pressure, and engine RPM.
3. **eCall Emergency Voice Link**: Integrate a GSM/GPRS module (SIM800L or SIM7600 4G) with a microphone and speaker to open an automatic bi-directional voice channel to the 108 emergency operator.
4. **Thermal & Fire Detection**: Incorporate cabin flame/smoke sensors and battery temperature monitoring for Electric Vehicles (EV battery thermal runaway detection).

---

## 5. 20 Viva Questions with Concise Technical Answers

### Q1: What is the primary problem addressed by this project?
**Answer**: Mitigating emergency response latency (the "Golden Hour") following vehicle crashes while eliminating false alarms triggered by non-accident road anomalies (potholes, speed breakers, hard braking).

### Q2: Why is threshold-based crash detection insufficient for automotive safety?
**Answer**: Potholes and speed bumps produce brief vertical acceleration spikes exceeding $3g-4g$. A simple threshold cannot differentiate road shocks from real crashes, causing dispatcher fatigue and wasted emergency resources.

### Q3: How does your system differentiate a severe pothole from a real collision?
**Answer**: Potholes cause an isolated, transient vertical spike ($a_z$) with zero longitudinal speed drop ($\Delta v \approx 0$) and zero angular rotation ($\omega \approx 0$). Collisions produce simultaneous multi-axis decelerations, significant speed drops ($>35\%$), and rotational impulses.

### Q4: Why is an MQTT broker preferred over HTTP for IoT sensor streaming?
**Answer**: MQTT is a lightweight binary pub/sub protocol with minimal packet overhead (2-byte header vs. hundreds of bytes in HTTP), persistent TCP connections, Last Will and Testament (LWT) for instant disconnection detection, and QoS support.

### Q5: What is the purpose of the 2.0-second sliding window with 50% overlap?
**Answer**: Crash dynamics unfold over $200\text{ ms} - 1500\text{ ms}$. A 2.0s window captures pre-crash motion, collision impact shock, and post-crash vehicle state. The 50% overlap ensures the pipeline evaluates every 1.0s, guaranteeing no event is split across window boundaries.

### Q6: Why did you group the dataset split by `run_id` instead of shuffling windows?
**Answer**: Consecutive overlapping windows from the same driving run share underlying physics and noise. Random shuffling causes severe data leakage between train and test sets, producing artificially perfect scores ($100\%$). Grouping by `run_id` enforces zero leakage ($0\%$).

### Q7: What are the 14 features extracted from each sensor window?
**Answer**: Peak G, Mean Total G, RMS Total G, Standard Deviation of G, Mean $a_x$, Mean $a_y$, Mean $a_z$, Max Jerk ($g/\text{s}$), Initial Speed, Final Speed, Delta Speed, Speed Drop Ratio, Max Gyro ($^\circ/\text{s}$), and Mean Gyro ($^\circ/\text{s}$).

### Q8: What is Jerk, and why is it a vital feature in collision detection?
**Answer**: Jerk is the first time-derivative of acceleration ($da/dt$). Mechanical collision impacts produce near-instantaneous deceleration gradients resulting in massive jerk spikes ($>100g/\text{s}$), whereas aggressive driver braking produces smooth deceleration slopes.

### Q9: How does the system handle an ML microservice crash or network timeout?
**Answer**: The backend implements an automated Circuit Breaker pattern with a 1500ms timeout and exponential retry. If the ML service is unresponsive, execution instantly diverts to an onboard kinematic rule-based fallback engine, achieving zero detection downtime.

### Q10: What is the purpose of the 15-second confirmation countdown?
**Answer**: It acts as a safety barrier against false alarms. When an accident candidate is detected, the device buzzer sounds and the dashboard activates an emergency countdown. If the driver is unharmed and presses the cancel button, emergency dispatch is aborted.

### Q11: How does the system recover active countdowns if the server restarts unexpectedly?
**Answer**: Pending incidents are stored in MongoDB with persistent `cancelDeadline` timestamps. On server initialization, the incident recovery service queries all unconfirmed incidents, resumes remaining timers, or confirms incidents whose deadlines elapsed during downtime.

### Q12: What role does the Autoencoder play in the ML architecture?
**Answer**: The Autoencoder is an unsupervised baseline trained strictly on normal driving data. It learns to compress and reconstruct benign kinematics. When presented with anomalous crash dynamics, its reconstruction error (MSE) spikes, providing anomaly detection without requiring negative labels.

### Q13: What happened when MOMENT-1-small was tested, and why was it skipped?
**Answer**: MOMENT is a multi-million-parameter deep foundation model for time series. On standard CPU host environments, inference failed with `ModuleNotFoundError: No module named 'torch'`, proving foundation models are computationally prohibitive for real-time edge vehicle hardware.

### Q14: How does the backend isolate simulation ground-truth metadata from the detection pipeline?
**Answer**: Telemetry samples carry an optional `meta` field during simulation for labeling. The backend ingestion controller immediately strips the `meta` field before pushing samples into the ring buffer, ensuring the feature extractor and ML models are completely blind to ground truth.

### Q15: What is the purpose of the Pre-Filter Screening step?
**Answer**: To save computational resources. If vehicle motion within a 2-second window exhibits peak $g < 2.5$, speed drop $< 35\%$, and gyro $< 50^\circ/\text{s}$, it is classified as quiescent normal driving and skips the HTTP ML inference call entirely.

### Q16: What is Last Will and Testament (LWT) in MQTT, and how is it used here?
**Answer**: LWT allows the broker to automatically publish a predefined message (`vehicle/{id}/status` with `online: false`) if the IoT device disconnects ungracefully (e.g., battery destruction in a crash or signal loss), notifying the dashboard immediately.

### Q17: How did you fix the client bundle size warning during production build?
**Answer**: By implementing dynamic route code-splitting via `React.lazy()` and `Suspense`, along with configuring `manualChunks` in Vite to isolate heavy third-party libraries (Leaflet, Recharts, vendor) into distinct bundle chunks ($<322\text{ kB}$ each).

### Q18: What is the measured false alarm rate for potholes in the Hard Evaluation Set?
**Answer**: 0.0% false alarm rate across all pothole amplitude brackets ($1.0\times - 1.35\times$) due to the vertical acceleration filter and zero speed drop constraint.

### Q19: What is the approximate cost of deploying this system on real hardware?
**Answer**: Approximately ₹1,293 (~$15.50 USD), utilizing an ESP32 DevKit V1, MPU6050 6-axis IMU, NEO-6M GPS receiver, active piezo buzzer, driver tactile button, and buck converter.

### Q20: How does the React dashboard receive real-time telemetry at 8 Hz without lagging?
**Answer**: The backend throttles high-frequency 50 Hz telemetry to 8 Hz (125ms intervals) for WebSocket Socket.IO broadcasting. Recharts leverages SVG canvas rendering with clamped history arrays to prevent browser memory exhaustion.
