# Wokwi-to-Dashboard Accident Detection

This ESP32 project connects the simulated MPU6050 hardware to the repository's
existing MQTT, backend, ML, and React dashboard pipeline:

```text
Wokwi ESP32 + MPU6050
  -> local Mosquitto MQTT broker
  -> Node.js MQTT subscriber and sliding-window detector
  -> FastAPI ML service (rule-based fallback if unavailable)
  -> MongoDB incidents/telemetry and Socket.IO dashboard events
```

The circuit includes an ESP32 DevKit, MPU6050 over I2C, buzzer on GPIO 25, and
driver cancel button on GPIO 4. GPS uses the project's documented fallback
coordinates (10.9982, 76.9664); this diagram does not emulate a GPS receiver.

## Requirements

- The project stack is running locally: MQTT on port 1883, backend on 5000,
  MongoDB, ML service on 8000, and dashboard on 5173.
- Wokwi's **Private IoT Gateway** is running on this same computer, and is
  enabled in the Wokwi editor. Wokwi's public gateway cannot reach local
  services. The private gateway is a Wokwi paid-plan feature; see the
  [Wokwi ESP32 WiFi guide](https://docs.wokwi.com/guides/esp32-wifi).
- Mosquitto is configured for anonymous local connections, as in the repository
  configuration. Do not expose this development broker to the public internet.

Start the application stack using the repository's normal local-development
instructions in the root README. Install and start the official
[Windows Wokwi IoT Gateway](https://github.com/wokwi/wokwigw/releases/latest).
Then open this project in Wokwi, focus the editor, press `F1`, and select
**Enable Private Wokwi IoT Gateway**. The sketch connects to
`host.wokwi.internal:1883`, which resolves to the local machine through that
gateway. If Wokwi presents its gateway upgrade prompt, activate a plan that
includes the Private Gateway before expecting local MQTT connectivity.

Without the Private Gateway, the simulated sensor, buzzer, and cancel button
still operate locally after NTP sync, but MQTT messages cannot reach the
backend/ML/dashboard. The serial monitor reports MQTT failures and marks any
unsent event as `EVENT_LOCAL_ONLY_MQTT_OFFLINE`.

## Start and verify the end-to-end flow

1. In Wokwi, open `sketch.ino` and `diagram.json` from this folder and install
   the `PubSubClient` and `ArduinoJson` libraries listed in `libraries.txt`.
2. Start the simulation. Wait for `TIME_SYNCHRONIZED` and `MQTT_CONNECTED` in
   the serial monitor.
3. Open the dashboard at `http://localhost:5173`, sign in, and open **Fleet
   Monitor**. `ESP32-WOKWI-001` should appear online with live sensor readings.
4. Click the MPU6050, set its `accelX` control to `5`, and wait for the MQTT
   telemetry window to fill. The device reports an impact, turns on the
   buzzer, and the backend runs its ML classification path. An accepted
   accident appears in the dashboard and incident history with the fallback
   GPS coordinates.
5. Press the red **CANCEL** button within 15 seconds to publish
   `ALERT_CANCELLED`, silence the buzzer, and cancel a pending backend incident.
   Leave it untouched to allow the device and backend countdowns to confirm.
6. To return to normal readings, set `accelX` back to `0`; restart the
   simulation to clear the device's confirmed-alert state.

## MQTT contract

The device ID is `ESP32-WOKWI-001`; messages use the same topic family as the
server subscriber and virtual fleet:

- `vehicle/ESP32-WOKWI-001/status`: retained online status and MQTT Last Will.
- `vehicle/ESP32-WOKWI-001/telemetry`: 50 Hz JSON samples with epoch-millisecond
  timestamps, accelerometer/gyro axes in g and degrees per second, fallback GPS,
  and buzzer state.
- `vehicle/ESP32-WOKWI-001/event`: `IMPACT_DETECTED`, `ALERT_CANCELLED`, and
  `ALERT_CONFIRMED` events.
- `vehicle/ESP32-WOKWI-001/command`: subscribes to backend `buzzer` ON/OFF and
  `cmd` CANCEL/RESET commands.

The Wokwi MPU6050 controls sensor values; this is a simulated impact input, not a
physical road-crash test. Alert delivery beyond the in-app dashboard still
depends on the email/SMS provider configuration.
