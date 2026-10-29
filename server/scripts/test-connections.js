import dotenv from 'dotenv';
import mongoose from 'mongoose';
import mqtt from 'mqtt';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/iot_accident_detection';
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

console.log('--- Testing IoT Infrastructure Connectivity ---');
console.log(`Target MongoDB URI: ${MONGODB_URI}`);
console.log(`Target MQTT Broker: ${MQTT_BROKER_URL}`);

let mongoOk = false;
let mqttOk = false;

async function checkMongo() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.log(' MongoDB Connection Successful!');
    mongoOk = true;
    await mongoose.disconnect();
  } catch (err) {
    console.error(' MongoDB Connection Failed:', err.message);
  }
}

async function checkMQTT() {
  return new Promise((resolve) => {
    console.log('Connecting to MQTT Broker...');
    const client = mqtt.connect(MQTT_BROKER_URL, { connectTimeout: 5000 });

    client.on('connect', () => {
      console.log(' MQTT Broker Connection Successful!');
      const testTopic = 'test/system/healthcheck';
      client.subscribe(testTopic, () => {
        client.publish(testTopic, JSON.stringify({ status: 'healthy', timestamp: Date.now() }));
      });
    });

    client.on('message', (topic, message) => {
      console.log(` MQTT Echo Received on [${topic}]: ${message.toString()}`);
      mqttOk = true;
      client.end();
      resolve();
    });

    client.on('error', (err) => {
      console.error(' MQTT Broker Connection Error:', err.message);
      client.end();
      resolve();
    });

    setTimeout(() => {
      if (!mqttOk) {
        console.error(' MQTT Broker Connection Timed Out');
        client.end();
      }
      resolve();
    }, 6000);
  });
}

async function run() {
  await checkMongo();
  await checkMQTT();
  console.log('-----------------------------------------------');
  if (mongoOk && mqttOk) {
    console.log(' ALL INFRASTRUCTURE SERVICES OPERATIONAL');
    process.exit(0);
  } else {
    console.warn('  Some services are not yet running or reachable.');
    console.warn('  Run "docker compose up -d mosquitto mongodb" to launch required services.');
    process.exit(1);
  }
}

run();
