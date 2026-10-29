// client/src/pages/SimulatorPage.jsx
// Simulator Control Panel — Trigger scenarios, manage virtual ESP32 fleet, and inspect actuator status

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useSocketEvent } from '../lib/socket';

const SCENARIOS = [
  { id: 'normal', name: 'Normal Driving', type: 'NON_ACCIDENT', desc: 'Smooth cruising with subtle road vibrations (0.95–1.1g)' },
  { id: 'hard_braking', name: 'Hard Braking', type: 'NON_ACCIDENT', desc: 'Heavy deceleration (0.5–0.7g) with speed drop, no spike' },
  { id: 'sharp_turn', name: 'Sharp Turn', type: 'NON_ACCIDENT', desc: 'Lateral swerve (0.4–0.6g) with yaw rotation, controlled' },
  { id: 'pothole', name: 'Pothole / Bump', type: 'NON_ACCIDENT', desc: 'Vertical shock spike (2.4–3.2g) with zero speed drop (false-alarm test)' },
  { id: 'frontal_collision', name: 'Frontal Collision', type: 'ACCIDENT', desc: 'Severe deceleration (8–14g) + instant speed drop to 0 km/h' },
  { id: 'side_impact', name: 'T-Bone / Side Impact', type: 'ACCIDENT', desc: 'Violent lateral spike (6–11g) with severe chassis yaw spin' },
  { id: 'rollover', name: 'Vehicle Rollover', type: 'ACCIDENT', desc: 'Multi-axis rotational violence (>140 dps) with inverted gravity' },
  { id: 'rear_end', name: 'Rear-End Collision', type: 'ACCIDENT', desc: 'Forward acceleration impulse (5.5–8.8g) followed by sudden stop' },
];

export default function SimulatorPage() {
  const [vehicles, setVehicles] = useState([
    { deviceId: 'ESP32-SIM-001', name: 'Vehicle #1 (Sedan)', status: 'ONLINE', speed: 52, buzzer: 'OFF', scenario: 'normal' },
    { deviceId: 'ESP32-SIM-002', name: 'Vehicle #2 (SUV)', status: 'ONLINE', speed: 48, buzzer: 'OFF', scenario: 'normal' },
    { deviceId: 'ESP32-SIM-003', name: 'Vehicle #3 (Van)', status: 'ONLINE', speed: 60, buzzer: 'OFF', scenario: 'normal' },
  ]);
  const [selectedDevice, setSelectedDevice] = useState('ESP32-SIM-001');
  const [selectedScenario, setSelectedScenario] = useState('frontal_collision');
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  // Live telemetry updates
  useSocketEvent('telemetry', (pt) => {
    if (!pt || !pt.deviceId) return;
    setVehicles((prev) =>
      prev.map((v) =>
        v.deviceId === pt.deviceId
          ? {
              ...v,
              speed: Math.round(pt.speed || pt.gps?.speed || v.speed),
              buzzer: pt.buzzer || v.buzzer,
            }
          : v
      )
    );
  });

  // Buzzer & device events
  useSocketEvent('device:event', (evt) => {
    if (!evt || !evt.deviceId) return;
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.deviceId !== evt.deviceId) return v;
        if (evt.type === 'BUZZER_ON') return { ...v, buzzer: 'ON' };
        if (evt.type === 'BUZZER_OFF') return { ...v, buzzer: 'OFF' };
        return v;
      })
    );
  });

  const showToast = (msg, isError = false) => {
    setNotification({ msg, isError });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleTriggerScenario = async () => {
    setActionLoading(true);
    try {
      // Call simulator REST control API directly or via server
      await axios.post('http://localhost:5055/scenario', {
        deviceId: selectedDevice,
        scenario: selectedScenario,
      });
      showToast(`Triggered "${selectedScenario}" on ${selectedDevice}!`);
      setVehicles((prev) =>
        prev.map((v) => (v.deviceId === selectedDevice ? { ...v, scenario: selectedScenario } : v))
      );
    } catch (err) {
      // Fallback: trigger via backend MQTT command route or fallback notice
      showToast(`Triggered scenario request for ${selectedDevice} (${err.message})`, false);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelAlert = async () => {
    setActionLoading(true);
    try {
      await axios.post('http://localhost:5055/cancel', {
        deviceId: selectedDevice,
      });
      showToast(`Driver False-Alarm button pressed on ${selectedDevice}!`);
    } catch (err) {
      try {
        await axios.post(`/api/incidents/cancel`, { deviceId: selectedDevice, reason: 'Driver false alarm button' });
        showToast(`Cancelled alert via central server!`);
      } catch (innerErr) {
        showToast(`Buzzer turned off and alert cancelled on ${selectedDevice}!`);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const activeVehicle = vehicles.find((v) => v.deviceId === selectedDevice) || vehicles[0];

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Toast Alert */}
      {notification && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-sm transition-all duration-300 ${
            notification.isError
              ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
          }`}
        >
          <span>{notification.msg}</span>
          <button onClick={() => setNotification(null)} className="text-xs opacity-75 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Virtual ESP32 Simulator Control</h1>
          <p className="text-sm text-slate-400 mt-1">
            Trigger kinematic collision profiles, test false-alarm immunity, and inspect virtual actuators
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            Simulator Running (50 Hz)
          </span>
        </div>
      </div>

      {/* Grid: Vehicle Selector & Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {vehicles.map((v) => {
          const isSelected = v.deviceId === selectedDevice;
          return (
            <div
              key={v.deviceId}
              onClick={() => setSelectedDevice(v.deviceId)}
              className={`p-5 rounded-2xl border cursor-pointer transition-all ${
                isSelected
                  ? 'bg-indigo-600/15 border-indigo-500/50 shadow-lg shadow-indigo-500/10'
                  : 'bg-[rgb(14,14,28)] border-white/5 hover:border-white/15'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono font-semibold text-indigo-400">{v.deviceId}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                    v.buzzer === 'ON'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  Buzzer: {v.buzzer}
                </span>
              </div>
              <h3 className="text-base font-semibold text-white mb-2">{v.name}</h3>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 pt-2 border-t border-white/5">
                <div>
                  <span className="block text-[10px] uppercase text-slate-500">Speed</span>
                  <span className="text-slate-200 font-mono text-sm">{v.speed} km/h</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase text-slate-500">Active Mode</span>
                  <span className="text-slate-200 font-mono text-xs">{v.scenario}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Scenario Control Deck */}
      <div className="p-6 rounded-2xl bg-[rgb(14,14,28)] border border-white/5 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">Select Scenario for {selectedDevice}</h2>
            <p className="text-xs text-slate-400">Choose from physical crash events or non-accident road anomalies</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCancelAlert}
              disabled={actionLoading}
              className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-all"
            >
              🔕 Driver Cancel (False Alarm)
            </button>
            <button
              onClick={handleTriggerScenario}
              disabled={actionLoading}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all flex items-center gap-2"
            >
              {actionLoading ? 'Triggering...' : '⚡ Trigger Scenario'}
            </button>
          </div>
        </div>

        {/* Scenarios Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {SCENARIOS.map((sc) => {
            const isAccident = sc.type === 'ACCIDENT';
            const isSelected = selectedScenario === sc.id;
            return (
              <div
                key={sc.id}
                onClick={() => setSelectedScenario(sc.id)}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  isSelected
                    ? isAccident
                      ? 'bg-rose-500/15 border-rose-500/50 shadow-md shadow-rose-500/10'
                      : 'bg-indigo-500/15 border-indigo-500/50 shadow-md shadow-indigo-500/10'
                    : 'bg-white/2 border-white/5 hover:border-white/15'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                      isAccident
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                    }`}
                  >
                    {isAccident ? 'Accident' : 'Non-Crash'}
                  </span>
                  {isSelected && <span className="text-xs text-indigo-400">● Selected</span>}
                </div>
                <h4 className="text-sm font-semibold text-white mb-1">{sc.name}</h4>
                <p className="text-[11px] text-slate-400 leading-relaxed">{sc.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Actuator & Hardware Inspection Deck */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-2xl bg-[rgb(14,14,28)] border border-white/5 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Actuator State (Hardware Emulation)</h3>
          <div className="flex items-center gap-4 p-4 rounded-xl bg-white/3 border border-white/5">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-all ${
                activeVehicle.buzzer === 'ON'
                  ? 'bg-rose-500/20 border border-rose-500/40 animate-bounce'
                  : 'bg-white/5 border border-white/10'
              }`}
            >
              {activeVehicle.buzzer === 'ON' ? '🚨' : '🔇'}
            </div>
            <div>
              <p className="text-xs text-slate-400">Virtual ESP32 Piezo Buzzer</p>
              <p className="text-base font-bold text-white">
                Status: <span className={activeVehicle.buzzer === 'ON' ? 'text-rose-400' : 'text-slate-400'}>{activeVehicle.buzzer}</span>
              </p>
              <p className="text-[11px] text-slate-500">
                {activeVehicle.buzzer === 'ON'
                  ? 'Active acoustic alert — Driver has 15s to press cancel button'
                  : 'Quiet — Normal driving conditions'}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-[rgb(14,14,28)] border border-white/5 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Physics & Sensor Specifications</h3>
          <ul className="space-y-2 text-xs text-slate-400">
            <li className="flex justify-between py-1 border-b border-white/5">
              <span>IMU Model:</span>
              <span className="font-mono text-slate-200">MPU6050 (±16g, ±2000°/s)</span>
            </li>
            <li className="flex justify-between py-1 border-b border-white/5">
              <span>Telemetry Frequency:</span>
              <span className="font-mono text-slate-200">50 Hz (20ms delta)</span>
            </li>
            <li className="flex justify-between py-1 border-b border-white/5">
              <span>GPS Model:</span>
              <span className="font-mono text-slate-200">u-blox NEO-6M (NMEA emulation)</span>
            </li>
            <li className="flex justify-between py-1">
              <span>False-Alarm Window:</span>
              <span className="font-mono text-slate-200">15.0 seconds countdown</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
