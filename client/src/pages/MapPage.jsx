// client/src/pages/MapPage.jsx
import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useSocketEvent } from '../lib/socket';

// Fix Leaflet default icons in Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const vehicleIcon = (color = '#10b981') => L.divIcon({
  html: `<div style="
    width:28px;height:28px;border-radius:50%;
    background:${color}22;border:2px solid ${color};
    display:flex;align-items:center;justify-content:center;
    font-size:14px;box-shadow:0 0 12px ${color}66;
  ">🚗</div>`,
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
});

const accidentIcon = L.divIcon({
  html: `<div style="
    width:36px;height:36px;border-radius:50%;
    background:#ef444422;border:2px solid #ef4444;
    display:flex;align-items:center;justify-content:center;
    font-size:20px;animation:pulse 1s infinite;
    box-shadow:0 0 16px #ef444488;
  ">🚨</div>`,
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
});

function FlyToMarker({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo(position, 15, { duration: 1.2 });
  }, [position, map]);
  return null;
}

export default function MapPage() {
  const [vehicles, setVehicles] = useState(new Map()); // deviceId -> {lat, lng, speed, deviceId, accident}
  const [accidents, setAccidents] = useState([]);
  const [flyTo, setFlyTo] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const CENTER = [10.998, 76.966]; // Coimbatore, India (default for demo routes)

  useSocketEvent('telemetry', (data) => {
    if (!data.gps?.lat) return;
    setVehicles((prev) => {
      const next = new Map(prev);
      next.set(data.deviceId, {
        deviceId: data.deviceId,
        lat: data.gps.lat,
        lng: data.gps.lng,
        speed: data.gps.speed || 0,
        heading: data.gps.heading || 0,
        buzzer: data.buzzer,
        ts: data.ts,
      });
      return next;
    });
  });

  useSocketEvent('device:status', (data) => {
    if (!data.online) {
      setVehicles((prev) => {
        const next = new Map(prev);
        next.delete(data.deviceId);
        return next;
      });
    }
  });

  useSocketEvent('incident:new', (incident) => {
    if (incident.location?.lat) {
      const acc = {
        id: incident._id || Date.now(),
        lat: incident.location.lat,
        lng: incident.location.lng,
        deviceId: incident.deviceId,
        peakG: incident.peakG,
        confidence: incident.confidence,
        ts: incident.createdAt || Date.now(),
      };
      setAccidents((prev) => [acc, ...prev].slice(0, 50));
      setFlyTo([acc.lat, acc.lng]);
    }
  });

  const vehicleArr = Array.from(vehicles.values());

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col p-6 gap-4 animate-fade-in">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white">Live Map</h1>
          <p className="text-sm text-slate-500">
            {vehicleArr.length} vehicles · {accidents.length} incident pins
          </p>
        </div>

        {/* Device selector */}
        {vehicleArr.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {vehicleArr.map((v) => (
              <button
                key={v.deviceId}
                id={`map-focus-${v.deviceId}`}
                onClick={() => { setFlyTo([v.lat, v.lng]); setSelectedDevice(v.deviceId); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all mono ${
                  selectedDevice === v.deviceId
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white/5 text-slate-400 border border-white/10 hover:border-indigo-500/40'
                }`}
              >
                {v.deviceId}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 rounded-2xl overflow-hidden border border-white/8 shadow-2xl">
        <MapContainer
          center={CENTER}
          zoom={13}
          style={{ height: '100%', width: '100%', background: '#0f0f1e' }}
          zoomControl={true}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          />
          {flyTo && <FlyToMarker position={flyTo} />}

          {/* Vehicle markers */}
          {vehicleArr.map((v) => (
            <Marker
              key={v.deviceId}
              position={[v.lat, v.lng]}
              icon={vehicleIcon(v.buzzer?.type === 'ACCIDENT' ? '#ef4444' : '#10b981')}
            >
              <Popup className="leaflet-dark-popup">
                <div className="text-xs space-y-1" style={{ minWidth: 160 }}>
                  <p className="font-bold text-sm mb-2">🚗 {v.deviceId}</p>
                  <p>Speed: <strong>{v.speed?.toFixed(1)} km/h</strong></p>
                  <p>Heading: <strong>{v.heading?.toFixed(0)}°</strong></p>
                  <p>GPS: <span className="mono">{v.lat?.toFixed(5)}, {v.lng?.toFixed(5)}</span></p>
                  {v.buzzer && <p>Alert: <strong style={{ color: v.buzzer.type === 'ACCIDENT' ? '#ef4444' : '#10b981' }}>{v.buzzer.type}</strong></p>}
                  <p className="text-slate-400">{new Date(v.ts || Date.now()).toLocaleTimeString()}</p>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Accident pins */}
          {accidents.map((a) => (
            <Marker key={a.id} position={[a.lat, a.lng]} icon={accidentIcon}>
              <Popup>
                <div className="text-xs space-y-1" style={{ minWidth: 160 }}>
                  <p className="font-bold text-sm mb-2 text-red-400">🚨 ACCIDENT</p>
                  <p>Device: <strong>{a.deviceId}</strong></p>
                  <p>Peak G: <strong>{(a.peakG || 0).toFixed(2)}g</strong></p>
                  <p>Confidence: <strong>{((a.confidence || 0) * 100).toFixed(0)}%</strong></p>
                  <p className="text-slate-400">{new Date(a.ts).toLocaleString()}</p>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="flex gap-6 text-xs text-slate-400 flex-shrink-0">
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-emerald-400 inline-block" /> Vehicle (normal)</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-400 inline-block" /> Vehicle (alert)</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500 inline-block animate-pulse" /> Accident pin</span>
      </div>
    </div>
  );
}
