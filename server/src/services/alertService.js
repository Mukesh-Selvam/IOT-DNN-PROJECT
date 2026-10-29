// server/src/services/alertService.js
// Multi-channel emergency alert dispatcher: In-App, Mock SMS/WhatsApp, Email (Nodemailer), and Telegram

import axios from 'axios';
import nodemailer from 'nodemailer';
import config from '../config/index.js';
import { Device } from '../models/Device.js';
import { EmergencyContact } from '../models/EmergencyContact.js';
import { Incident } from '../models/Incident.js';
import logger from '../utils/logger.js';

let mailTransporter = null;

async function getMailTransporter() {
  if (mailTransporter) return mailTransporter;

  if (config.email.host && config.email.user) {
    mailTransporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: {
        user: config.email.user,
        pass: config.email.pass,
      },
    });
  } else {
    // Generate test account with Ethereal for zero-config local testing
    try {
      const testAccount = await nodemailer.createTestAccount();
      mailTransporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      logger.info(`[Alert Service] Created Ethereal test email account: ${testAccount.user}`);
    } catch (err) {
      logger.warn('[Alert Service] Could not create Ethereal test account:', err.message);
    }
  }

  return mailTransporter;
}

export function formatAlertMessage(incident, device = null) {
  const plate = device?.plate || incident.deviceId;
  const lat = incident.location?.lat?.toFixed(5) || '0.00000';
  const lng = incident.location?.lng?.toFixed(5) || '0.00000';
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const time = new Date(incident.detectedAt).toLocaleString();

  return `🚨 EMERGENCY: CRASH DETECTED!
Vehicle: ${plate} (${incident.deviceId})
Time: ${time}
Impact Peak: ${incident.peakG} g
Speed at Impact: ${incident.speedAtImpact} km/h
Confidence: ${(incident.confidence * 100).toFixed(0)}%
Location: ${lat}, ${lng}
Map Link: ${mapsUrl}`;
}

export async function dispatchAlerts(incidentId, socketEmitter = null) {
  const incident = await Incident.findById(incidentId);
  if (!incident || incident.status !== 'CONFIRMED') {
    return;
  }

  const device = await Device.findOne({ deviceId: incident.deviceId });
  const ownerId = device?.owner;

  // Find emergency contacts for device owner (ordered by priority)
  const contacts = ownerId
    ? await EmergencyContact.find({ owner: ownerId, active: true }).sort({ priority: 1 })
    : [];

  const messageText = formatAlertMessage(incident, device);
  const recordedAlerts = [];

  logger.incident('DISPATCHING_ALERTS', incident.deviceId, `Found ${contacts.length} emergency contacts.`);

  // 1. Channel: In-App Push via Socket.IO
  if (socketEmitter && ownerId) {
    try {
      socketEmitter.to(`user:${ownerId}`).emit('alert:emergency', {
        incidentId: incident._id,
        deviceId: incident.deviceId,
        message: messageText,
        detectedAt: incident.detectedAt,
      });
      recordedAlerts.push({
        channel: 'in_app',
        recipient: `user:${ownerId}`,
        sentAt: new Date(),
        status: 'SENT',
        details: 'Delivered via Socket.IO user room',
      });
    } catch (err) {
      recordedAlerts.push({
        channel: 'in_app',
        recipient: `user:${ownerId}`,
        sentAt: new Date(),
        status: 'FAILED',
        details: err.message,
      });
    }
  }

  // 2. Channel: Mock SMS / WhatsApp (formatted logs + record)
  for (const contact of contacts) {
    if (contact.phone) {
      console.log(`\n======================================================`);
      console.log(`📱 [MOCK SMS / WHATSAPP DISPATCH] To: ${contact.name} (${contact.phone})`);
      console.log(messageText);
      console.log(`======================================================\n`);

      recordedAlerts.push({
        channel: 'sms',
        recipient: `${contact.name} <${contact.phone}>`,
        sentAt: new Date(),
        status: 'SENT',
        details: 'Mock cellular gateway dispatch simulated',
      });
    }
  }

  // If no registered contacts, log fallback dispatch
  if (contacts.length === 0) {
    console.log(`\n======================================================`);
    console.log(`📱 [MOCK SMS / EMERGENCY OPERATOR] To: Central Emergency Dispatch (+91-108)`);
    console.log(messageText);
    console.log(`======================================================\n`);

    recordedAlerts.push({
      channel: 'sms',
      recipient: 'National Emergency Service (108)',
      sentAt: new Date(),
      status: 'SENT',
      details: 'Dispatched to central emergency operator',
    });
  }

  // 3. Channel: Email via Nodemailer
  const transporter = await getMailTransporter();
  if (transporter) {
    const recipients = contacts.filter((c) => c.email).map((c) => c.email);
    if (recipients.length > 0) {
      try {
        const mailOptions = {
          from: config.email.from,
          to: recipients.join(', '),
          subject: `🚨 CRASH ALERT: Vehicle ${device?.plate || incident.deviceId} Impact Detected`,
          text: messageText,
          html: `<div style="font-family: sans-serif; padding: 16px; border: 1px solid #ef4444; border-radius: 8px;">
            <h2 style="color: #ef4444; margin-top: 0;">🚨 CRASH DETECTED</h2>
            <p><strong>Vehicle:</strong> ${device?.plate || incident.deviceId}</p>
            <p><strong>Time:</strong> ${new Date(incident.detectedAt).toLocaleString()}</p>
            <p><strong>Impact Peak:</strong> ${incident.peakG} g</p>
            <p><strong>Speed:</strong> ${incident.speedAtImpact} km/h</p>
            <p><strong>Location:</strong> ${incident.location?.lat}, ${incident.location?.lng}</p>
            <p><a href="https://maps.google.com/?q=${incident.location?.lat},${incident.location?.lng}" style="display: inline-block; padding: 10px 18px; background: #ef4444; color: white; text-decoration: none; border-radius: 6px;">View on Google Maps</a></p>
          </div>`,
        };

        const info = await transporter.sendMail(mailOptions);
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
          logger.info(`[Alert Service] Email preview URL (Ethereal): ${previewUrl}`);
        }

        recordedAlerts.push({
          channel: 'email',
          recipient: recipients.join(', '),
          sentAt: new Date(),
          status: 'SENT',
          details: previewUrl || 'Email dispatched via SMTP',
        });
      } catch (err) {
        logger.warn('[Alert Service] Email dispatch error:', err.message);
        recordedAlerts.push({
          channel: 'email',
          recipient: recipients.join(', '),
          sentAt: new Date(),
          status: 'FAILED',
          details: err.message,
        });
      }
    }
  }

  // 4. Channel: Optional Telegram Bot
  if (config.telegram.botToken && config.telegram.chatId) {
    try {
      const tgUrl = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
      await axios.post(
        tgUrl,
        {
          chat_id: config.telegram.chatId,
          text: messageText,
        },
        { timeout: 3000 }
      );

      recordedAlerts.push({
        channel: 'telegram',
        recipient: config.telegram.chatId,
        sentAt: new Date(),
        status: 'SENT',
        details: 'Delivered via Telegram Bot API',
      });
    } catch (err) {
      logger.warn('[Alert Service] Telegram notification error:', err.message);
      recordedAlerts.push({
        channel: 'telegram',
        recipient: config.telegram.chatId,
        sentAt: new Date(),
        status: 'FAILED',
        details: err.message,
      });
    }
  }

  // Update incident record with dispatched alerts
  await Incident.findByIdAndUpdate(incident._id, {
    $push: { alertsSent: { $each: recordedAlerts } },
  });
}

export default {
  formatAlertMessage,
  dispatchAlerts,
};
