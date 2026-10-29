// server/scripts/seed.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { User } from '../src/models/User.js';
import { Device } from '../src/models/Device.js';
import { EmergencyContact } from '../src/models/EmergencyContact.js';
import { Setting } from '../src/models/Setting.js';
import config from '../src/config/index.js';
import logger from '../src/utils/logger.js';

dotenv.config();

async function runSeed() {
  const mongoUri = config.mongoUri || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/iot_accident_detection';
  console.log(`[Seed] Connecting to MongoDB at ${mongoUri}...`);

  let connected = false;
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
    connected = true;
  } catch (err) {
    console.log(`[Seed] Direct connection failed (${err.message}). Using MongoMemoryServer for standalone seeding...`);
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const ms = await MongoMemoryServer.create();
    await mongoose.connect(ms.getUri());
    connected = true;
  }

  console.log('[Seed] Seeding database collections...');

  // 1. Seed Admin User
  const adminEmail = 'admin@fleetlab.com';
  const hashedPassword = await bcrypt.hash('AdminPass#123', 10);
  const adminUser = await User.findOneAndUpdate(
    { email: adminEmail },
    {
      name: 'Fleet Administrator',
      email: adminEmail,
      password: hashedPassword,
      role: 'ADMIN',
    },
    { upsert: true, new: true }
  );
  console.log(`[Seed] ✅ Seeded Admin User: ${adminEmail}`);

  // 2. Seed Devices
  const devices = [
    { deviceId: 'ESP32-SIM-001', name: 'Vehicle #1 (Sedan)', model: 'Virtual ESP32 DevKit v1', plate: 'TN-38-AB-1234', isOnline: true },
    { deviceId: 'ESP32-SIM-002', name: 'Vehicle #2 (SUV)', model: 'Virtual ESP32 DevKit v1', plate: 'TN-38-CD-5678', isOnline: true },
    { deviceId: 'ESP32-SIM-003', name: 'Vehicle #3 (Van)', model: 'Virtual ESP32 DevKit v1', plate: 'TN-38-EF-9012', isOnline: true },
  ];
  for (const d of devices) {
    await Device.findOneAndUpdate({ deviceId: d.deviceId }, d, { upsert: true, new: true });
  }
  console.log(`[Seed] ✅ Seeded ${devices.length} IoT Fleet Devices`);

  // 3. Seed Emergency Contacts
  const contacts = [
    { owner: adminUser._id, name: 'Central Emergency Dispatch', phone: '+91-108', email: 'dispatch@emergency.gov.in', priority: 1 },
    { owner: adminUser._id, name: 'Fleet Operations Lead', phone: '+91-9876543210', email: 'fleetops@fleetlab.com', priority: 2 },
  ];
  for (const c of contacts) {
    await EmergencyContact.findOneAndUpdate({ phone: c.phone }, c, { upsert: true, new: true });
  }
  console.log(`[Seed] ✅ Seeded ${contacts.length} Emergency Contacts`);

  // 4. Seed Settings
  await Setting.findOneAndUpdate(
    { key: 'default' },
    {
      key: 'default',
      debounceSeconds: 60,
      cancelCountdownSeconds: 15,
      screeningThresholdG: 2.5,
      mlConfidenceThreshold: 0.75,
      windowSeconds: 2.0,
      overlapRatio: 0.5,
    },
    { upsert: true, new: true }
  );
  console.log('[Seed] ✅ Seeded Global System Settings');

  console.log('======================================================');
  console.log('DATABASE SEEDING COMPLETED SUCCESSFULLY');
  console.log('======================================================');

  await mongoose.disconnect();
  process.exit(0);
}

runSeed().catch((err) => {
  console.error('[Seed Error]:', err);
  process.exit(1);
});
