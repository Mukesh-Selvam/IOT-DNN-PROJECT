// client/src/pages/FleetPage.jsx
import React, { useEffect, useState } from 'react';
import { deviceApi } from '../lib/api';
import { useSocketEvent } from '../lib/socket';

function SignalBar({ value, max = 20 }) {
  const pct = Math.min(100, (Math.abs(value) / max) * 100);
  return (
    <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
      <div
        className="h-full rounded-full bg-indigo-500 transition-all duration-150"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function VehicleCard({ device, liveData }) {
  const live = liveData?.get(device.deviceId);
  const isOnline = device.online ?? !!live;
  const accelMag = live?.accel
    ? Math.sqrt(live.accel.x ** 2 + live.accel.y ** 2 + live.accel.z ** 2)
    : 0;

  return (
    <div className={`glass-card-hover p-5 transition-all ${isOnline ? '' : 'opacity-50'}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${isOnline ? 'bg-green-500/15 border border-green-500/20' : 'bg-slate-500/15 border border-slate-500/20'}`}>
            🚗
          </div>
          <div>
            <p className="font-semibold text-sm text-white mono">{device.deviceId}</p>
            <p className="text-xs text-slate-500">{device.plate || 'No plate'}</p>
          </div>
        </div>
        <span className={`badge ${isOnline ? 'badge-success' : 'badge-neutral'}`}>
          <span className={`dot-pulse ${isOnline ? 'bg-emerald-400' : 'bg-slate-400'}`} />
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>

      {/* Live metrics */}
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Speed', value: `${(live?.gps?.speed ?? device.lastGps?.speed ?? 0).toFixed(0)}`, unit: 'km/h' },
            { label: 'G-Force', value: accelMag.toFixed(2), unit: 'g' },
            { label: 'Heading', value: `${(live?.gps?.heading ?? 0).toFixed(0)}°`, unit: '' },
          ].map(({ label, value, unit }) => (
            <div key={label} className="p-2 rounded-lg bg-white/3 border border-white/5">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="text-sm font-bold text-white">{value}<span className="text-xs text-slate-500 ml-0.5">{unit}</span></p>
            </div>
          ))}
        </div>

        {/* Accel bars */}
        {live?.accel && (
          <div className="space-y-1.5">
            {[['X', live.accel.x], ['Y', live.accel.y], ['Z', live.accel.z]].map(([axis, val]) => (
              <div key={axis} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-slate-500">A{axis}</span>
                <SignalBar value={val} />
                <span className="w-10 text-right mono text-slate-400">{val?.toFixed(2)}g</span>
              </div>
            ))}
          </div>
        )}

        {/* Route */}
        {(device.routeName || live?.route) && (
          <p className="text-xs text-slate-500 border-t border-white/5 pt-2">
            Route: <span className="text-slate-300">{device.routeName || live?.route}</span>
          </p>
        )}

        {/* GPS */}
        {(device.lastGps || live?.gps) && (
          <p className="text-xs mono text-slate-500">
            {(device.lastGps?.lat ?? live?.gps?.lat)?.toFixed(5)},&nbsp;
            {(device.lastGps?.lng ?? live?.gps?.lng)?.toFixed(5)}
          </p>
        )}
      </div>
    </div>
  );
}

export default function FleetPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveData, setLiveData] = useState(new Map());

  useEffect(() => {
    deviceApi.list({ limit: 50 })
      .then((r) => {
        const list = r.data.data?.devices || r.data.devices || r.data.data || [];
        setDevices(Array.isArray(list) ? list : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useSocketEvent('telemetry', (data) => {
    setLiveData((prev) => {
      const next = new Map(prev);
      next.set(data.deviceId, data);
      return next;
    });
  });

  useSocketEvent('device:status', (data) => {
    setDevices((prev) => {
      const idx = prev.findIndex((d) => d.deviceId === data.deviceId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], online: data.online, routeName: data.route || next[idx].routeName };
        return next;
      }
      if (data.online) {
        return [...prev, { deviceId: data.deviceId, online: true, plate: data.plate, routeName: data.route }];
      }
      return prev;
    });
  });

  // Merge liveData devices that aren't in devices list
  const allDeviceIds = new Set(devices.map((d) => d.deviceId));
  const liveOnlyDevices = Array.from(liveData.keys())
    .filter((id) => !allDeviceIds.has(id))
    .map((id) => ({ deviceId: id, online: true }));
  const allDevices = [...devices, ...liveOnlyDevices];

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Fleet Monitor</h1>
          <p className="text-sm text-slate-500">
            {allDevices.filter((d) => d.online || liveData.has(d.deviceId)).length} online · {allDevices.length} registered
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="dot-pulse bg-emerald-400" />
          Live telemetry stream
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-500">Loading fleet…</div>
      ) : allDevices.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-4xl mb-4">🚗</p>
          <p className="text-slate-400 font-medium">No vehicles registered</p>
          <p className="text-sm text-slate-500 mt-1">Start the simulator to see vehicles appear here automatically.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {allDevices.map((device) => (
            <VehicleCard key={device.deviceId} device={device} liveData={liveData} />
          ))}
        </div>
      )}
    </div>
  );
}
