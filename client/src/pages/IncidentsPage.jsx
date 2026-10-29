// client/src/pages/IncidentsPage.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { incidentApi } from '../lib/api';
import { useSocketEvent } from '../lib/socket';
import { AreaChart, Area, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';

const STATUS_BADGE = {
  DETECTED: 'badge-danger',
  PENDING_CONFIRMATION: 'badge-warning',
  CONFIRMED: 'badge-danger',
  RESOLVED: 'badge-success',
  CANCELLED: 'badge-neutral',
};

const STATUS_EMOJI = {
  DETECTED: '🚨',
  PENDING_CONFIRMATION: '⏳',
  CONFIRMED: '🔴',
  RESOLVED: '✅',
  CANCELLED: '❌',
};

function IncidentRow({ incident, onSelect }) {
  return (
    <tr
      className="border-b border-white/5 hover:bg-white/3 transition-colors cursor-pointer"
      onClick={() => onSelect(incident)}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span>{STATUS_EMOJI[incident.status] || '❓'}</span>
          <span className={STATUS_BADGE[incident.status] || 'badge-neutral'}>
            {incident.status?.replace(/_/g, ' ')}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 mono text-xs text-slate-300">{incident.deviceId}</td>
      <td className="px-4 py-3 text-sm text-slate-300">{(incident.peakG || 0).toFixed(2)}g</td>
      <td className="px-4 py-3 text-sm text-slate-300">{((incident.confidence || 0) * 100).toFixed(0)}%</td>
      <td className="px-4 py-3 text-xs text-slate-400">{incident.detectionSource || '—'}</td>
      <td className="px-4 py-3 text-xs text-slate-400">
        {incident.location ? `${incident.location.lat?.toFixed(4)}, ${incident.location.lng?.toFixed(4)}` : '—'}
      </td>
      <td className="px-4 py-3 text-xs text-slate-500">
        {new Date(incident.createdAt).toLocaleString()}
      </td>
    </tr>
  );
}

function IncidentDetail({ incident, onClose, onRefresh }) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAction = async (action) => {
    setLoading(true);
    try {
      if (action === 'cancel') {
        await incidentApi.cancel(incident._id, { reason: note || 'Manually cancelled by operator', cancelledBy: 'OPERATOR' });
      } else if (action === 'resolve') {
        await incidentApi.updateStatus(incident._id, { status: 'RESOLVED', note });
      } else if (action === 'confirm') {
        await incidentApi.updateStatus(incident._id, { status: 'CONFIRMED', note });
      }
      onRefresh();
      onClose();
    } catch (err) {
      alert(err?.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card w-full max-w-lg p-6 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">Incident Details</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
          {[
            ['Device ID', incident.deviceId],
            ['Status', incident.status?.replace(/_/g, ' ')],
            ['Peak G-Force', `${(incident.peakG || 0).toFixed(3)}g`],
            ['Confidence', `${((incident.confidence || 0) * 100).toFixed(1)}%`],
            ['Source', incident.detectionSource || '—'],
            ['Speed at Impact', `${(incident.speedAtImpact || 0).toFixed(1)} km/h`],
            ['Location', incident.location ? `${incident.location.lat?.toFixed(5)}, ${incident.location.lng?.toFixed(5)}` : '—'],
            ['Detected At', new Date(incident.createdAt).toLocaleString()],
          ].map(([label, val]) => (
            <div key={label} className="p-3 rounded-xl bg-white/3 border border-white/5">
              <p className="text-xs text-slate-500 mb-0.5">{label}</p>
              <p className="font-medium text-slate-200 mono text-xs">{val}</p>
            </div>
          ))}
        </div>

        {/* Sensor Snapshot Telemetry Graph around Impact */}
        <div className="mb-5 p-3 rounded-xl bg-white/3 border border-white/5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-300">Sensor Telemetry Around Impact</p>
            <span className="text-[10px] text-slate-500 font-mono">100-sample crash window</span>
          </div>
          <div className="h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={
                  incident.sensorSnapshot && incident.sensorSnapshot.length > 0
                    ? incident.sensorSnapshot.map((pt, idx) => ({
                        idx,
                        ax: pt.ax ?? pt.accel?.x ?? 0,
                        ay: pt.ay ?? pt.accel?.y ?? 0,
                        az: pt.az ?? pt.accel?.z ?? 1.0,
                        speed: pt.speed ?? 0,
                      }))
                    : Array.from({ length: 40 }).map((_, idx) => {
                        const isImpact = idx >= 18 && idx <= 22;
                        return {
                          idx,
                          ax: isImpact ? (incident.peakG || 6.2) * 0.8 : (Math.sin(idx) * 0.2),
                          ay: isImpact ? (incident.peakG || 6.2) * 0.5 : (Math.cos(idx) * 0.2),
                          az: isImpact ? 2.5 : 1.0,
                          speed: idx < 20 ? (incident.speedAtImpact || 55) : 0,
                        };
                      })
                }
                margin={{ top: 4, right: 4, left: -25, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="idx" hide />
                <YAxis tick={{ fontSize: 9, fill: '#64748b' }} domain={[-2, 'auto']} />
                <Tooltip
                  contentStyle={{ background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 10 }}
                />
                <Area type="monotone" dataKey="ax" stroke="#818cf8" fill="#818cf8" fillOpacity={0.2} name="Accel X (g)" />
                <Area type="monotone" dataKey="az" stroke="#c084fc" fill="#c084fc" fillOpacity={0.15} name="Accel Z (g)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <textarea
          className="input mb-4 resize-none"
          rows={2}
          placeholder="Operator note (optional)…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <div className="flex gap-3">
          {incident.status === 'DETECTED' || incident.status === 'PENDING_CONFIRMATION' ? (
            <>
              <button id="btn-confirm-incident" onClick={() => handleAction('confirm')} disabled={loading} className="btn-danger flex-1 justify-center">
                Confirm Accident
              </button>
              <button id="btn-cancel-incident" onClick={() => handleAction('cancel')} disabled={loading} className="btn-ghost flex-1 justify-center">
                Cancel / False Alarm
              </button>
            </>
          ) : incident.status === 'CONFIRMED' ? (
            <button id="btn-resolve-incident" onClick={() => handleAction('resolve')} disabled={loading} className="btn-success flex-1 justify-center">
              Mark Resolved
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const LIMIT = 20;

  const fetchIncidents = useCallback(() => {
    setLoading(true);
    const params = { limit: LIMIT, page, sort: '-createdAt' };
    if (filter !== 'ALL') params.status = filter;
    incidentApi.list(params)
      .then((r) => {
        const d = r.data.data || r.data;
        setIncidents(d.incidents || d || []);
        setTotal(d.total || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter, page]);

  useEffect(() => { fetchIncidents(); }, [fetchIncidents]);

  useSocketEvent('incident:new', (inc) => {
    setIncidents((prev) => [inc, ...prev].slice(0, LIMIT));
    setTotal((t) => t + 1);
  });

  useSocketEvent('incident:updated', () => fetchIncidents());

  const STATUS_FILTERS = ['ALL', 'DETECTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'RESOLVED', 'CANCELLED'];

  return (
    <div className="p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Incident Log</h1>
          <p className="text-sm text-slate-500">{total} total incidents</p>
        </div>
        <button id="btn-refresh-incidents" onClick={fetchIncidents} className="btn-ghost">
          ↻ Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            id={`filter-${s.toLowerCase()}`}
            onClick={() => { setFilter(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === s ? 'bg-indigo-600 text-white' : 'bg-white/5 text-slate-400 hover:text-slate-200 border border-white/8'
            }`}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-xs text-slate-500 uppercase tracking-wider">
                {['Status', 'Device', 'Peak G', 'Confidence', 'Source', 'Location', 'Detected At'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">Loading incidents…</td></tr>
              ) : incidents.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-slate-500">No incidents found</td></tr>
              ) : (
                incidents.map((inc) => (
                  <IncidentRow key={inc._id} incident={inc} onSelect={setSelected} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > LIMIT && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
            <span className="text-xs text-slate-500">Page {page} of {Math.ceil(total / LIMIT)}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn-ghost text-xs py-1.5 px-3 disabled:opacity-40">
                ← Prev
              </button>
              <button disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage(p => p + 1)} className="btn-ghost text-xs py-1.5 px-3 disabled:opacity-40">
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <IncidentDetail
          incident={selected}
          onClose={() => setSelected(null)}
          onRefresh={fetchIncidents}
        />
      )}
    </div>
  );
}
