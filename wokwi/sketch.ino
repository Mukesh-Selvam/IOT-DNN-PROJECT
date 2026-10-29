#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <Wire.h>
#include <time.h>

namespace {
constexpr char WIFI_SSID[] = "Wokwi-GUEST";
constexpr char WIFI_PASSWORD[] = "";
constexpr char MQTT_HOST[] = "host.wokwi.internal";
constexpr uint16_t MQTT_PORT = 1883;
constexpr char DEVICE_ID[] = "ESP32-WOKWI-001";
constexpr char MQTT_USERNAME[] = "";
constexpr char MQTT_PASSWORD[] = "";
constexpr char FALLBACK_ROUTE[] = "Wokwi crash-detection demo";
constexpr uint8_t MPU_ADDR = 0x68;
constexpr uint8_t BUZZER_PIN = 25;
constexpr uint8_t CANCEL_PIN = 4;
constexpr uint32_t SAMPLE_INTERVAL_MS = 20;
constexpr uint32_t ALERT_TIMEOUT_MS = 15000;
constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 5000;
constexpr uint32_t MQTT_RETRY_INTERVAL_MS = 3000;
constexpr float IMPACT_THRESHOLD_G = 4.0f;
constexpr time_t MIN_VALID_EPOCH = 1700000000;

char topicTelemetry[64];
char topicStatus[64];
char topicEvent[64];
char topicCommand[64];
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

uint32_t lastSampleAt = 0;
uint32_t lastWifiAttemptAt = 0;
uint32_t lastMqttAttemptAt = 0;
uint32_t sequenceNumber = 0;
uint32_t alertStartedAt = 0;
bool timeSynchronized = false;
bool waitingForTimeLogged = false;
bool alertPending = false;
bool alertConfirmed = false;
bool impactLatched = false;
bool buzzerActive = false;

int16_t readInt16() {
  const uint8_t highByte = Wire.read();
  const uint8_t lowByte = Wire.read();
  return static_cast<int16_t>((highByte << 8) | lowByte);
}

bool readMpu6050(float &ax, float &ay, float &az, float &gx, float &gy,
                 float &gz) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0 ||
      Wire.requestFrom(MPU_ADDR, static_cast<uint8_t>(14), true) != 14) {
    return false;
  }

  const int16_t rawAx = readInt16();
  const int16_t rawAy = readInt16();
  const int16_t rawAz = readInt16();
  readInt16();
  const int16_t rawGx = readInt16();
  const int16_t rawGy = readInt16();
  const int16_t rawGz = readInt16();

  ax = rawAx / 2048.0f;
  ay = rawAy / 2048.0f;
  az = rawAz / 2048.0f;
  gx = rawGx / 16.4f;
  gy = rawGy / 16.4f;
  gz = rawGz / 16.4f;
  return true;
}

uint64_t currentTimestampMs() {
  return static_cast<uint64_t>(time(nullptr)) * 1000ULL;
}

void publishEvent(const char *type, float peakG) {
  StaticJsonDocument<256> doc;
  doc["type"] = type;
  doc["deviceId"] = DEVICE_ID;
  doc["ts"] = currentTimestampMs();
  doc["peakG"] = peakG;

  char payload[256];
  const size_t length = serializeJson(doc, payload, sizeof(payload));
  if (mqttClient.connected() &&
      !mqttClient.publish(topicEvent,
                          reinterpret_cast<const uint8_t *>(payload), length,
                          false)) {
    Serial.println("{\"error\":\"MQTT_EVENT_PUBLISH_FAILED\"}");
  }
  if (!mqttClient.connected()) {
    Serial.println("{\"warning\":\"EVENT_LOCAL_ONLY_MQTT_OFFLINE\"}");
  }
  Serial.print(payload);
  Serial.println();
}

void publishStatus(bool online) {
  if (!mqttClient.connected()) {
    return;
  }

  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["online"] = online;
  doc["plate"] = "WOKWI-001";
  doc["route"] = FALLBACK_ROUTE;
  doc["sampleRateHz"] = 50;
  doc["ts"] = currentTimestampMs();

  char payload[256];
  const size_t length = serializeJson(doc, payload, sizeof(payload));
  if (!mqttClient.publish(topicStatus,
                          reinterpret_cast<const uint8_t *>(payload), length,
                          true)) {
    Serial.println("{\"error\":\"MQTT_STATUS_PUBLISH_FAILED\"}");
  }
}

void publishTelemetry(float ax, float ay, float az, float gx, float gy,
                      float gz, float peakG) {
  const uint64_t ts = currentTimestampMs();
  StaticJsonDocument<512> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["ts"] = ts;
  doc["seq"] = sequenceNumber;
  doc["sampleRateHz"] = 50;

  JsonObject accel = doc.createNestedObject("accel");
  accel["x"] = ax;
  accel["y"] = ay;
  accel["z"] = az;

  JsonObject gyro = doc.createNestedObject("gyro");
  gyro["x"] = gx;
  gyro["y"] = gy;
  gyro["z"] = gz;

  JsonObject gps = doc.createNestedObject("gps");
  gps["lat"] = 10.9982;
  gps["lng"] = 76.9664;
  gps["speed"] = 0;
  gps["heading"] = 0;
  gps["satellites"] = 0;
  gps["hdop"] = 0;
  gps["fix"] = 0;
  gps["ts"] = ts;

  doc["buzzer"] = buzzerActive ? "ON" : "OFF";
  doc["peakG"] = peakG;

  char payload[512];
  const size_t length = serializeJson(doc, payload, sizeof(payload));
  if (mqttClient.connected() &&
      !mqttClient.publish(
          topicTelemetry, reinterpret_cast<const uint8_t *>(payload), length,
          false)) {
    Serial.println("{\"error\":\"MQTT_TELEMETRY_PUBLISH_FAILED\"}");
  }
  if (sequenceNumber % 50 == 0) {
    Serial.println(payload);
  }
}

void handleCommand(char *topic, byte *payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  const DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.println("{\"error\":\"INVALID_MQTT_COMMAND\"}");
    return;
  }

  const char *buzzerCommand = doc["buzzer"] | "";
  const char *command = doc["cmd"] | "";
  if (strcmp(buzzerCommand, "ON") == 0) {
    buzzerActive = true;
  } else if (strcmp(buzzerCommand, "OFF") == 0) {
    buzzerActive = false;
  }

  if (strcmp(command, "CANCEL") == 0) {
    alertPending = false;
    buzzerActive = false;
    publishEvent("ALERT_CANCELLED", 0);
  } else if (strcmp(command, "RESET") == 0) {
    alertPending = false;
    alertConfirmed = false;
    impactLatched = false;
    buzzerActive = false;
  }

  digitalWrite(BUZZER_PIN, buzzerActive ? HIGH : LOW);
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);
  lastWifiAttemptAt = millis();
}

void connectMqtt() {
  if (mqttClient.connected() ||
      millis() - lastMqttAttemptAt < MQTT_RETRY_INTERVAL_MS) {
    return;
  }
  lastMqttAttemptAt = millis();

  StaticJsonDocument<128> willDoc;
  willDoc["deviceId"] = DEVICE_ID;
  willDoc["online"] = false;
  willDoc["ts"] = currentTimestampMs();
  char willPayload[128];
  serializeJson(willDoc, willPayload, sizeof(willPayload));

  const bool connected =
      MQTT_USERNAME[0] == '\0'
          ? mqttClient.connect(DEVICE_ID, topicStatus, 1, true, willPayload)
          : mqttClient.connect(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD,
                               topicStatus, 1, true, willPayload);
  if (!connected) {
    Serial.print("{\"error\":\"MQTT_CONNECT_FAILED\",\"state\":");
    Serial.print(mqttClient.state());
    Serial.println("}");
    return;
  }

  publishStatus(true);
  if (!mqttClient.subscribe(topicCommand, 1)) {
    Serial.println("{\"error\":\"MQTT_COMMAND_SUBSCRIBE_FAILED\"}");
  }
  Serial.println("{\"status\":\"MQTT_CONNECTED\"}");
}

void initializeMpu6050() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00);
  Wire.endTransmission(true);

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1C);
  Wire.write(0x18);
  Wire.endTransmission(true);

  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1B);
  Wire.write(0x18);
  Wire.endTransmission(true);
}
}  // namespace

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(CANCEL_PIN, INPUT_PULLUP);
  digitalWrite(BUZZER_PIN, LOW);
  Wire.begin(21, 22, 400000);
  initializeMpu6050();

  snprintf(topicTelemetry, sizeof(topicTelemetry), "vehicle/%s/telemetry",
           DEVICE_ID);
  snprintf(topicStatus, sizeof(topicStatus), "vehicle/%s/status", DEVICE_ID);
  snprintf(topicEvent, sizeof(topicEvent), "vehicle/%s/event", DEVICE_ID);
  snprintf(topicCommand, sizeof(topicCommand), "vehicle/%s/command", DEVICE_ID);

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(handleCommand);
  mqttClient.setBufferSize(512);

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  connectWifi();
  Serial.println("{\"status\":\"READY\",\"deviceId\":\"ESP32-WOKWI-001\"}");
}

void loop() {
  const uint32_t now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastWifiAttemptAt >= WIFI_RETRY_INTERVAL_MS) {
      connectWifi();
    }
    if (!timeSynchronized) {
      return;
    }
  }

  if (WiFi.status() == WL_CONNECTED && !timeSynchronized) {
    if (time(nullptr) < MIN_VALID_EPOCH) {
      if (!waitingForTimeLogged) {
        Serial.println("{\"status\":\"WAITING_FOR_NTP\"}");
        waitingForTimeLogged = true;
      }
      return;
    }
    timeSynchronized = true;
    lastSampleAt = now;
    Serial.println("{\"status\":\"TIME_SYNCHRONIZED\"}");
  }

  if (WiFi.status() == WL_CONNECTED) {
    connectMqtt();
    mqttClient.loop();
  }
  if (now - lastSampleAt < SAMPLE_INTERVAL_MS) {
    return;
  }
  lastSampleAt = now;
  ++sequenceNumber;

  float ax, ay, az, gx, gy, gz;
  if (!readMpu6050(ax, ay, az, gx, gy, gz)) {
    Serial.println("{\"error\":\"MPU6050_READ_FAILED\"}");
    return;
  }

  const float peakG = sqrtf(ax * ax + ay * ay + az * az);
  if (peakG < IMPACT_THRESHOLD_G) {
    impactLatched = false;
  }
  if (!impactLatched && !alertPending && !alertConfirmed &&
      peakG >= IMPACT_THRESHOLD_G) {
    impactLatched = true;
    alertPending = true;
    alertStartedAt = now;
    buzzerActive = true;
    publishEvent("IMPACT_DETECTED", peakG);
  }

  if (alertPending && digitalRead(CANCEL_PIN) == LOW) {
    alertPending = false;
    buzzerActive = false;
    publishEvent("ALERT_CANCELLED", peakG);
  } else if (alertPending && now - alertStartedAt >= ALERT_TIMEOUT_MS) {
    alertPending = false;
    alertConfirmed = true;
    buzzerActive = true;
    publishEvent("ALERT_CONFIRMED", peakG);
  }

  digitalWrite(BUZZER_PIN, buzzerActive ? HIGH : LOW);
  publishTelemetry(ax, ay, az, gx, gy, gz, peakG);
}
