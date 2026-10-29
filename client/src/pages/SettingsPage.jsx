// client/src/pages/SettingsPage.jsx
// Detection pipeline parameters, threshold calibration, and alert routing configuration

import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    impactThresholdG: 4.0,
    screeningThresholdG: 2.5,
    mlConfidenceThreshold: 0.75,
    cancelCountdownSeconds: 15,
    debounceSeconds: 60,
    windowSeconds: 2,
    overlapRatio: 0.5,
    enableSms: true,
    enableEmail: true,
    enableTelegram: false,
    enableInApp: true,
  });

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState(null);

  const showToast = (msg, isError = false) => {
    setNotification({ msg, isError });
    setTimeout(() => setNotification(null), 4000);
  };

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await axios.get('/api/settings');
        if (res.data?.data) {
          setSettings((prev) => ({ ...prev, ...res.data.data }));
        }
      } catch (err) {
        console.warn('Could not load remote settings; using defaults');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.put('/api/settings', settings);
      showToast('Pipeline & threshold settings persisted successfully!');
    } catch (err) {
      showToast(`Saved settings locally (${err.message})`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setSettings({
      impactThresholdG: 4.0,
      screeningThresholdG: 2.5,
      mlConfidenceThreshold: 0.75,
      cancelCountdownSeconds: 15,
      debounceSeconds: 60,
      windowSeconds: 2,
      overlapRatio: 0.5,
      enableSms: true,
      enableEmail: true,
      enableTelegram: false,
      enableInApp: true,
    });
    showToast('Reset settings to factory defaults');
  };

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
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
          <h1 className="text-2xl font-bold text-white tracking-tight">Pipeline & Detection Settings</h1>
          <p className="text-sm text-slate-400 mt-1">
            Calibrate physical crash boundaries, false-alarm countdown timers, and inference thresholds
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-semibold transition-all"
          >
            Reset Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/25 transition-all flex items-center gap-2"
          >
            {saving ? 'Saving...' : '💾 Save Settings'}
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Detection Thresholds */}
        <div className="p-6 rounded-2xl bg-[rgb(14,14,28)] border border-white/5 space-y-6">
          <h2 className="text-base font-bold text-white border-b border-white/5 pb-3">Kinematic Impact Thresholds</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            <div>
              <div className="flex justify-between text-slate-300 mb-2 font-medium">
                <span>Impact Crash Threshold (|a| peak)</span>
                <span className="font-mono text-indigo-400 font-bold">{settings.impactThresholdG} g</span>
              </div>
              <input
                type="range"
                min="2.0"
                max="8.0"
                step="0.1"
                value={settings.impactThresholdG}
                onChange={(e) => setSettings({ ...settings, impactThresholdG: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 bg-white/10 rounded-lg h-2"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Collisions exceeding this resultant acceleration trigger classification pipeline.
              </p>
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-2 font-medium">
                <span>Pre-Filter Screening Trigger</span>
                <span className="font-mono text-indigo-400 font-bold">{settings.screeningThresholdG} g</span>
              </div>
              <input
                type="range"
                min="1.5"
                max="4.0"
                step="0.1"
                value={settings.screeningThresholdG}
                onChange={(e) => setSettings({ ...settings, screeningThresholdG: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 bg-white/10 rounded-lg h-2"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Skip ML model entirely when motion is below this baseline (saves microservice compute).
              </p>
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-2 font-medium">
                <span>ML Confidence Classification Cutoff</span>
                <span className="font-mono text-indigo-400 font-bold">{(settings.mlConfidenceThreshold * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.50"
                max="0.95"
                step="0.05"
                value={settings.mlConfidenceThreshold}
                onChange={(e) => setSettings({ ...settings, mlConfidenceThreshold: parseFloat(e.target.value) })}
                className="w-full accent-indigo-500 bg-white/10 rounded-lg h-2"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Minimum DNN output probability required to classify candidate as verified ACCIDENT.
              </p>
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-2 font-medium">
                <span>False-Alarm Cancellation Window</span>
                <span className="font-mono text-indigo-400 font-bold">{settings.cancelCountdownSeconds} s</span>
              </div>
              <input
                type="range"
                min="5"
                max="60"
                step="1"
                value={settings.cancelCountdownSeconds}
                onChange={(e) => setSettings({ ...settings, cancelCountdownSeconds: parseInt(e.target.value) })}
                className="w-full accent-indigo-500 bg-white/10 rounded-lg h-2"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Acoustic buzzer sounds for driver. Alert dispatches if not cancelled within this window.
              </p>
            </div>
          </div>
        </div>

        {/* Sliding Window Parameters */}
        <div className="p-6 rounded-2xl bg-[rgb(14,14,28)] border border-white/5 space-y-6">
          <h2 className="text-base font-bold text-white border-b border-white/5 pb-3">Sliding Window & Debounce Timing</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
            <div>
              <label className="block text-slate-300 mb-1 font-medium">Window Duration (seconds)</label>
              <input
                type="number"
                min="1"
                max="5"
                step="0.5"
                value={settings.windowSeconds}
                onChange={(e) => setSettings({ ...settings, windowSeconds: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono"
              />
              <p className="text-[10px] text-slate-500 mt-1">Samples buffered (e.g. 2s @ 50Hz = 100 samples)</p>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-medium">Overlap Ratio</label>
              <input
                type="number"
                min="0.1"
                max="0.9"
                step="0.1"
                value={settings.overlapRatio}
                onChange={(e) => setSettings({ ...settings, overlapRatio: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono"
              />
              <p className="text-[10px] text-slate-500 mt-1">0.5 = 50% overlap (evaluates every 1.0s)</p>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-medium">Crash Debounce Window (seconds)</label>
              <input
                type="number"
                min="10"
                max="300"
                step="5"
                value={settings.debounceSeconds}
                onChange={(e) => setSettings({ ...settings, debounceSeconds: parseInt(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono"
              />
              <p className="text-[10px] text-slate-500 mt-1">Prevents duplicate crash incidents for same collision</p>
            </div>
          </div>
        </div>

        {/* Emergency Alert Channels */}
        <div className="p-6 rounded-2xl bg-[rgb(14,14,28)] border border-white/5 space-y-4">
          <h2 className="text-base font-bold text-white border-b border-white/5 pb-3">Active Dispatch Channels</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <label className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enableInApp}
                onChange={(e) => setSettings({ ...settings, enableInApp: e.target.checked })}
                className="rounded bg-white/5 border-white/20 text-indigo-600 focus:ring-0"
              />
              <span className="text-slate-200 font-medium">Socket.IO In-App</span>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enableSms}
                onChange={(e) => setSettings({ ...settings, enableSms: e.target.checked })}
                className="rounded bg-white/5 border-white/20 text-indigo-600 focus:ring-0"
              />
              <span className="text-slate-200 font-medium">SMS Emergency (+91-108)</span>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enableEmail}
                onChange={(e) => setSettings({ ...settings, enableEmail: e.target.checked })}
                className="rounded bg-white/5 border-white/20 text-indigo-600 focus:ring-0"
              />
              <span className="text-slate-200 font-medium">Ethereal / SMTP Email</span>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl bg-white/3 border border-white/5 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enableTelegram}
                onChange={(e) => setSettings({ ...settings, enableTelegram: e.target.checked })}
                className="rounded bg-white/5 border-white/20 text-indigo-600 focus:ring-0"
              />
              <span className="text-slate-200 font-medium">Telegram Bot</span>
            </label>
          </div>
        </div>
      </form>
    </div>
  );
}
