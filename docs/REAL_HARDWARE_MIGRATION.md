# Real Hardware Migration Guide

This guide details how to transition from the software simulation to physical automotive hardware while maintaining **100% compatibility with the existing backend, MQTT contract, and dashboard**.

---

## 1. Bill of Materials (BOM) & Approximate Cost (INR)

| Component | Specification | Quantity | Unit Price (INR) | Total (INR) | Source / Vendor |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **ESP32 DevKit V1** | 30-pin Dual-Core 240MHz, Wi-Fi + BLE | 1 | ₹380 | ₹380 | Robu.in / Amazon |
| **MPU6050 Module** | 6-Axis Accelerometer ($\pm 16g$) + Gyro ($\pm 2000^\circ/\text{s}$) I2C | 1 | ₹140 | ₹140 | Robu.in / ElectronicsComp |
| **NEO-6M GPS Module** | High-sensitivity GPS receiver with ceramic patch antenna | 1 | ₹420 | ₹420 | Robu.in / Amazon |
| **Active 5V Piezo Buzzer** | High-decibel resonant buzzer indicator | 1 | ₹25 | ₹25 | Local Electronics / Robu |
| **Tactile Push Button** | 12mm Momentary switch (Driver false-alarm cancel) | 1 | ₹10 | ₹10 | Local Electronics |
| **NPN Transistor (2N2222)** | Buzzer driver switch + 1kΩ resistor | 1 | ₹8 | ₹8 | Local Electronics |
| **Buck Converter (LM2596)** | Step-down 12V automotive battery to 5V 2A | 1 | ₹95 | ₹95 | Robu.in |
| **Automotive Fuse Holder** | 2A inline blade fuse for 12V battery protection | 1 | ₹35 | ₹35 | Local Auto Parts |
| **Jumper Wires & PCB** | Fr4 prototyping board + silicone wires | 1 | ₹60 | ₹60 | Local Electronics |
| **ABS Enclosure Box** | Waterproof IP65 enclosure for dashboard mount | 1 | ₹120 | ₹120 | Amazon |
| **Total Approximate Cost**| | | | **₹1,293 (~$15.50 USD)** | |

---

## 2. Hardware Wiring & Pinout Table

### ESP32 DevKit V1 (30-Pin) Connection Map:

| Peripheral | Sensor Pin | ESP32 Pin | Interface | Notes / Recommended Configuration |
| :--- | :--- | :--- | :--- | :--- |
| **MPU6050** | VCC | 3.3V | Power | Powers IMU directly from onboard LDO |
| **MPU6050** | GND | GND | Power | Ground reference |
| **MPU6050** | SCL | **GPIO 22** | Hardware I2C | Clock line (400 kHz Fast I2C) |
| **MPU6050** | SDA | **GPIO 21** | Hardware I2C | Data line |
| **MPU6050** | INT | **GPIO 19** | Digital Input | Optional hardware collision interrupt |
| **NEO-6M GPS** | VCC | 5V / VIN | Power | Connect to 5V rail for antenna LNA |
| **NEO-6M GPS** | GND | GND | Power | Common ground |
| **NEO-6M GPS** | TX | **GPIO 16 (RX2)** | Hardware UART2 | 9600 Baud NMEA sentence stream |
| **NEO-6M GPS** | RX | **GPIO 17 (TX2)** | Hardware UART2 | Configuration commands to GPS |
| **Piezo Buzzer** | (+) Pin | **GPIO 25** | Digital Output | Driven via 2N2222 transistor base |
| **Cancel Button**| Terminal 1 | **GPIO 4** | Digital Input | Configured with `INPUT_PULLUP` |
| **Cancel Button**| Terminal 2 | GND | Power | Pulls GPIO 4 LOW when pressed |

---

## 3. Production ESP32 Arduino C++ Firmware Sketch

Save the following sketch as `esp32_iot_crash_firmware.ino`. It implements identical MQTT topics, 50 Hz telemetry sampling, Last Will and Testament, and remote command listeners.

```cpp
#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>

// ---------------------------------------------------------------------------
// Network & MQTT Configuration
// ---------------------------------------------------------------------------
const char* WIFI_SSID     = "YOUR_VEHICLE_HOTSPOT_SSID";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* MQTT_SERVER   = "192.168.1.100"; // Central MQTT Broker IP
const int   MQTT_PORT     = 1883;
const char* DEVICE_ID     = "ESP32-HARD-001";

// Pinout assignments
const int PIN_BUZZER      = 25;
const int PIN_BTN_CANCEL  = 4;
const int GPS_RX_PIN      = 16;
const int GPS_TX_PIN      = 17;

// MPU6050 I2C Address
const int MPU_ADDR        = 0x68;

// Telemetry Timing (50 Hz = 20ms period)
const unsigned long SAMPLE_INTERVAL_MS = 20;
unsigned long lastSampleTime = 0;
unsigned long sequenceNumber = 0;

WiFiClient espClient;
PubSubClient mqttClient(espClient);
HardwareSerial gpsSerial(2);
TinyGPSPlus gps;

// MQTT Topics
String topicTelemetry = String("vehicle/") + DEVICE_ID + "/telemetry";
String topicStatus    = String("vehicle/") + DEVICE_ID + "/status";
String topicEvent     = String("vehicle/") + DEVICE_ID + "/event";
String topicCommand   = String("command/") + DEVICE_ID + "/#";

bool buzzerActive = false;

// ---------------------------------------------------------------------------
// MPU6050 Raw Read
// ---------------------------------------------------------------------------
void initMPU6050() {
  Wire.begin(21, 22, 400000); // SDA, SCL, 400kHz
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B); // PWR_MGMT_1
  Wire.write(0x00); // Wake up MPU6050
  Wire.endTransmission(true);

  // Set Accelerometer Range to +-16g (0x18)
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1C);
  Wire.write(0x18);
  Wire.endTransmission(true);

  // Set Gyroscope Range to +-2000 deg/s (0x18)
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1B);
  Wire.write(0x18);
  Wire.endTransmission(true);
}

void readMPU6050(float &ax, float &ay, float &az, float &gx, float &gy, float &gz) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B); // Starting register for Accel readings
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 14, true);

  int16_t rawAx = Wire.read() << 8 | Wire.read();
  int16_t rawAy = Wire.read() << 8 | Wire.read();
  int16_t rawAz = Wire.read() << 8 | Wire.read();
  int16_t rawTemp = Wire.read() << 8 | Wire.read();
  int16_t rawGx = Wire.read() << 8 | Wire.read();
  int16_t rawGy = Wire.read() << 8 | Wire.read();
  int16_t rawGz = Wire.read() << 8 | Wire.read();

  // Convert raw values (16g: 2048 LSB/g, 2000 dps: 16.4 LSB/dps)
  ax = (float)rawAx / 2048.0;
  ay = (float)rawAy / 2048.0;
  az = (float)rawAz / 2048.0;
  gx = (float)rawGx / 16.4;
  gy = (float)rawGy / 16.4;
  gz = (float)rawGz / 16.4;
}

// ---------------------------------------------------------------------------
// MQTT Callback (Actuator commands from server)
// ---------------------------------------------------------------------------
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, payload, length);

  if (doc.containsKey("buzzer")) {
    const char* buzzerCmd = doc["buzzer"];
    if (strcmp(buzzerCmd, "ON") == 0) {
      buzzerActive = true;
      digitalWrite(PIN_BUZZER, HIGH);
    } else {
      buzzerActive = false;
      digitalWrite(PIN_BUZZER, LOW);
    }
  }
}

// ---------------------------------------------------------------------------
// MQTT Connection & LWT
// ---------------------------------------------------------------------------
void reconnectMQTT() {
  while (!mqttClient.connected()) {
    // LWT payload (notifies backend if vehicle drops unexpectedly)
    StaticJsonDocument<128> lwtDoc;
    lwtDoc["deviceId"] = DEVICE_ID;
    lwtDoc["online"]   = false;
    lwtDoc["ts"]       = millis();
    char lwtBuffer[128];
    serializeJson(lwtDoc, lwtBuffer);

    if (mqttClient.connect(DEVICE_ID, topicStatus.c_str(), 1, true, lwtBuffer)) {
      // Announce Online Status
      StaticJsonDocument<128> onlineDoc;
      onlineDoc["deviceId"] = DEVICE_ID;
      onlineDoc["online"]   = true;
      onlineDoc["ts"]       = millis();
      char onlineBuffer[128];
      serializeJson(onlineDoc, onlineBuffer);
      mqttClient.publish(topicStatus.c_str(), onlineBuffer, true);

      // Subscribe to backend commands
      mqttClient.subscribe(topicCommand.c_str());
    } else {
      delay(2000);
    }
  }
}

// ---------------------------------------------------------------------------
// Setup & Loop
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_BTN_CANCEL, INPUT_PULLUP);
  digitalWrite(PIN_BUZZER, LOW);

  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  initMPU6050();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }

  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);
}

void loop() {
  if (!mqttClient.connected()) reconnectMQTT();
  mqttClient.loop();

  // Feed GPS sentences
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // Handle Driver Cancel Button Press
  if (digitalRead(PIN_BTN_CANCEL) == LOW) {
    if (buzzerActive) {
      buzzerActive = false;
      digitalWrite(PIN_BUZZER, LOW);

      StaticJsonDocument<256> cancelDoc;
      cancelDoc["type"]     = "ALERT_CANCELLED";
      cancelDoc["deviceId"] = DEVICE_ID;
      cancelDoc["reason"]   = "DRIVER_BUTTON";
      cancelDoc["ts"]       = millis();

      char cancelBuf[256];
      serializeJson(cancelDoc, cancelBuf);
      mqttClient.publish(topicEvent.c_str(), cancelBuf);
      delay(300); // Debounce
    }
  }

  // High-Frequency 50 Hz Sensor Sampling
  unsigned long now = millis();
  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    lastSampleTime = now;
    sequenceNumber++;

    float ax, ay, az, gx, gy, gz;
    readMPU6050(ax, ay, az, gx, gy, gz);

    StaticJsonDocument<512> doc;
    doc["deviceId"]     = DEVICE_ID;
    doc["ts"]           = now;
    doc["seq"]          = sequenceNumber;
    doc["sampleRateHz"] = 50;

    JsonObject accel = doc.createNestedObject("accel");
    accel["x"] = round(ax * 100) / 100.0;
    accel["y"] = round(ay * 100) / 100.0;
    accel["z"] = round(az * 100) / 100.0;

    JsonObject gyro = doc.createNestedObject("gyro");
    gyro["x"] = round(gx * 10) / 10.0;
    gyro["y"] = round(gy * 10) / 10.0;
    gyro["z"] = round(gz * 10) / 10.0;

    JsonObject gpsObj = doc.createNestedObject("gps");
    gpsObj["lat"]   = gps.location.isValid() ? gps.location.lat() : 10.9982;
    gpsObj["lng"]   = gps.location.isValid() ? gps.location.lng() : 76.9664;
    gpsObj["speed"] = gps.speed.isValid() ? gps.speed.kmph() : 0.0;

    doc["speed"]  = gpsObj["speed"];
    doc["buzzer"] = buzzerActive ? "ON" : "OFF";

    char payloadBuf[512];
    serializeJson(doc, payloadBuf);
    mqttClient.publish(topicTelemetry.c_str(), payloadBuf);
  }
}
```

---

## 4. Zero-Change Backend Migration Validation

1. Configure the ESP32 firmware with the Mosquitto broker's IP address.
2. Flash the sketch using Arduino IDE or PlatformIO.
3. Once booted, the ESP32 publishes retained status `vehicle/ESP32-HARD-001/status` with `online: true`.
4. The Node.js MQTT subscriber in `server/src/mqtt/subscriber.js` detects the device, automatically registers it in MongoDB, and ingests 50 Hz telemetry without any backend modifications.
