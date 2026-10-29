// client/src/pages/DashboardPage.jsx
import React, { useEffect, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { incidentApi } from '../lib/api';
import { useSocketEvent } from '../lib/socket';

const MAX_POINTS = 120;

function StatCard({ label, value, sub, color = 'indigo', icon }) {
  const colors = {
    indigo: 'from-indigo-500/15 to-indigo-600/5 border-indigo-500/20 text-indigo-400',
    red: 'from-red-500/15 to-red-600/5 border-red-500/20 text-red-400',
    green: 'from-green-500/15 to-green-600/5 border-green-500/20 text-green-400',
    amber: 'from-amber-500/15 to-amber-600/5 border-amber-500/20 text-amber-400',
  };
  return (
    <div className={`glass-card-hover bg-gradient-to-br ${colors[color]} p-5`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">{label}</p>
          <p className="text-3xl font-bold text-white">{value ?? '—'}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        <div className="text-2xl opacity-80">{icon}</div>
      </div>
    </div>
  );
}

const CHART_CFG = [
  { key: 'ax', color: '#818cf8', label: 'Accel X (g)' },
  { key: 'ay', color: '#a78bfa', label: 'Accel Y (g)' },
  { key: 'az', color: '#c084fc', label: 'Accel Z (g)' },
];

const GYRO_CFG = [
  { key: 'gx', color: '#34d399', label: 'Gyro X (°/s)' },
  { key: 'gy', color: '#6ee7b7', label: 'Gyro Y (°/s)' },
  { key: 'gz', color: '#a7f3d0', label: 'Gyro Z (°/s)' },
];

function LiveChart({ title, data, series, yDomain = ['auto', 'auto'] }) {
  return (
    <div className="chart-container">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        <div className="flex gap-3">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} domain={yDomain} />
          <Tooltip
            contentStyle={{ background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 12 }}
            labelStyle={{ color: '#94a3b8' }}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={1.5}
              fill={`url(#grad-${s.key})`}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function RecentIncidentRow({ incident }) {
  const statusColor = {
    DETECTED: 'badge-danger',
    PENDING_CONFIRMATION: 'badge-warning',
    CONFIRMED: 'badge-danger',
    RESOLVED: 'badge-success',
    CANCELLED: 'badge-neutral',
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/3 transition-colors">
      <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-sm">
        🚨
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200 truncate">{incident.deviceId}</p>
        <p className="text-xs text-slate-500">
          {new Date(incident.createdAt).toLocaleTimeString()} · Peak {(incident.peakG || 0).toFixed(1)}g
        </p>
      </div>
      <span className={statusColor[incident.status] || 'badge-neutral'}>
        {incident.status?.replace('_', ' ')}
      </span>
    </div>
  );
}

function playAlertBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(440, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    // browser auto-play policy
  }
}

export default function DashboardPage() {
  const [accelData, setAccelData] = useState([]);
  const [gyroData, setGyroData] = useState([]);
  const [stats, setStats] = useState(null);
  const [recentIncidents, setRecentIncidents] = useState([]);
  const [activeDevices, setActiveDevices] = useState(new Map());
  const [activeAlert, setActiveAlert] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const tickRef = useRef(0);
  const countdownIntervalRef = useRef(null);

  useEffect(() => {
    incidentApi.stats().then((r) => setStats(r.data.data || r.data)).catch(() => {});
    incidentApi.list({ limit: 5, sort: '-createdAt' }).then((r) => {
      const list = r.data.data?.incidents || r.data.incidents || [];
      setRecentIncidents(list);
    }).catch(() => {});

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  const triggerCountdown = (incident, initialSec = 15) => {
    playAlertBeep();
    setActiveAlert(incident);
    setCountdown(initialSec);

    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          return 0;
        }
        playAlertBeep();
        return prev - 1;
      });
    }, 1000);
  };

  useSocketEvent('incident:pending', (payload) => {
    triggerCountdown(payload, payload.remainingSec || 15);
  });

  useSocketEvent('incident:new', (incident) => {
    setRecentIncidents((prev) => [incident, ...prev].slice(0, 8));
    setStats((prev) => (prev ? { ...prev, total: (prev.total || 0) + 1, open: (prev.open || 0) + 1 } : prev));
    triggerCountdown(incident, 15);
  });

  useSocketEvent('incident:confirmed', (incident) => {
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    setActiveAlert((prev) => (prev ? { ...prev, status: 'CONFIRMED' } : incident));
    setCountdown(0);
  });

  useSocketEvent('incident:cancelled', (payload) => {
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    setActiveAlert(null);
    setCountdown(0);
  });

  const handleCancelAlert = async () => {
    if (!activeAlert) return;
    setCancelling(true);
    try {
      const id = activeAlert.incidentId || activeAlert._id || activeAlert.deviceId;
      await incidentApi.cancel(id, 'Driver false alarm button press');
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      setActiveAlert(null);
      setCountdown(0);
    } catch (err) {
      console.error('Cancel alert error:', err);
    } finally {
      setCancelling(false);
    }
  };

  useSocketEvent('telemetry', (data) => {
    const tick = (tickRef.current = (tickRef.current + 1) % 1000);
    const t = new Date(data.ts || Date.now()).toLocaleTimeString('en', { hour12: false });
    const pt = {
      t,
      ax: parseFloat((data.accel?.x ?? 0).toFixed(3)),
      ay: parseFloat((data.accel?.y ?? 0).toFixed(3)),
      az: parseFloat((data.accel?.z ?? 0).toFixed(3)),
      gx: parseFloat((data.gyro?.x ?? 0).toFixed(1)),
      gy: parseFloat((data.gyro?.y ?? 0).toFixed(1)),
      gz: parseFloat((data.gyro?.z ?? 0).toFixed(1)),
      speed: data.gps?.speed ?? 0,
    };
    setAccelData((prev) => [...prev.slice(-MAX_POINTS + 1), pt]);
    setGyroData((prev) => [...prev.slice(-MAX_POINTS + 1), pt]);

    setActiveDevices((prev) => {
      const next = new Map(prev);
      next.set(data.deviceId, { ...data, updatedAt: Date.now() });
      return next;
    });
  });

  useSocketEvent('device:status', (data) => {
    setActiveDevices((prev) => {
      const next = new Map(prev);
      if (data.online) {
        next.set(data.deviceId, { ...next.get(data.deviceId), ...data, updatedAt: Date.now() });
      } else {
        next.delete(data.deviceId);
      }
      return next;
    });
  });

  const devicesArr = Array.from(activeDevices.values());

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Dynamic Emergency Red Banner with Real Countdown Timer */}
      {activeAlert && (
        <div
          className={`p-5 rounded-2xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-2xl transition-all ${
            countdown > 0
              ? 'bg-gradient-to-r from-rose-950/90 via-red-900/80 to-rose-950/90 border-rose-500/80 shadow-rose-900/40 animate-pulse'
              : 'bg-rose-900/60 border-rose-500/40'
          }`}
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-rose-600/30 border border-rose-500/50 flex items-center justify-center text-3xl animate-bounce">
              🚨
            </div>
            <div>
              <div className="flex items-center gap-3">
                <span className="text-base font-extrabold text-white tracking-wide uppercase">
                  {countdown > 0 ? 'CRASH DETECTED — CONFIRMATION COUNTDOWN' : 'EMERGENCY: CRASH CONFIRMED'}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-white/10 text-rose-200 border border-rose-400/30">
                  {activeAlert.deviceId}
                </span>
              </div>
              <p className="text-xs text-rose-200/80 mt-1">
                Peak <span className="font-bold text-white">{(activeAlert.peakG || 0).toFixed(1)}g</span> · Confidence{' '}
                <span className="font-bold text-white">{((activeAlert.confidence || 0.9) * 100).toFixed(0)}%</span> · Virtual Buzzer Active
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 self-end md:self-auto">
            {countdown > 0 ? (
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <span className="block text-[10px] uppercase font-bold text-rose-300">Auto-Dispatch In</span>
                  <span className="text-2xl font-black font-mono text-white tracking-wider">{countdown}s</span>
                </div>
                <button
                  onClick={handleCancelAlert}
                  disabled={cancelling}
                  className="px-5 py-2.5 rounded-xl bg-white text-rose-900 hover:bg-slate-100 font-bold text-xs uppercase tracking-wider shadow-lg transition-all"
                >
                  {cancelling ? 'Cancelling...' : '🔕 Cancel False Alarm'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="px-3 py-1.5 rounded-lg bg-rose-500/30 text-rose-200 text-xs font-semibold border border-rose-400/30">
                  Responders Dispatched
                </span>
                <button
                  onClick={() => setActiveAlert(null)}
                  className="p-2 text-rose-300 hover:text-white text-sm"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Total Incidents" value={stats?.total ?? '—'} sub="All time" color="indigo" icon="📊" />
        <StatCard label="Open / Active" value={stats?.open ?? '—'} sub="Pending review" color="red" icon="🚨" />
        <StatCard label="Online Vehicles" value={devicesArr.length} sub="Live fleet" color="green" icon="🚗" />
        <StatCard label="Resolved" value={stats?.resolved ?? '—'} sub="Closed cases" color="amber" icon="✅" />
      </div>

      {/* Live charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <LiveChart
          title="Accelerometer (g-force)"
          data={accelData}
          series={CHART_CFG}
          yDomain={[-6, 6]}
        />
        <LiveChart
          title="Gyroscope (°/s)"
          data={gyroData}
          series={GYRO_CFG}
          yDomain={[-400, 400]}
        />
      </div>

      {/* Bottom row: Active devices + Recent incidents */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Active devices */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <span className="dot-pulse bg-emerald-400" />
            Live Fleet ({devicesArr.length} vehicles)
          </h3>
          {devicesArr.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">
              No vehicles online. Start the simulator to see live data.
            </p>
          ) : (
            <div className="space-y-2">
              {devicesArr.map((d) => (
                <div key={d.deviceId} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/3 border border-white/5">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="mono text-xs font-medium text-slate-300 flex-1">{d.deviceId}</span>
                  <span className="text-xs text-slate-500">{(d.gps?.speed ?? 0).toFixed(0)} km/h</span>
                  <span className={`badge ${d.buzzer?.type === 'ACCIDENT' ? 'badge-danger' : 'badge-success'}`}>
                    {d.buzzer?.type || d.lastBuzzer || 'OK'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent incidents */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">Recent Incidents</h3>
          {recentIncidents.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">No incidents recorded yet.</p>
          ) : (
            <div className="space-y-1">
              {recentIncidents.map((inc) => (
                <RecentIncidentRow key={inc._id} incident={inc} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
