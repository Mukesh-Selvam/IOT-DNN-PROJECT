// simulator/src/geo.js
// Geodesic calculations (Haversine, initial bearing) and closed-loop route interpolation

const EARTH_RADIUS_M = 6371000; // Mean Earth radius in meters
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Calculates Haversine distance between two coordinates in meters
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const deltaPhi = (lat2 - lat1) * DEG_TO_RAD;
  const deltaLambda = (lon2 - lon1) * DEG_TO_RAD;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

/**
 * Calculates initial bearing from (lat1, lon1) to (lat2, lon2) in degrees [0, 360)
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const deltaLambda = (lon2 - lon1) * DEG_TO_RAD;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);

  const bearing = (theta * RAD_TO_DEG + 360) % 360;
  return bearing;
}

/**
 * RouteInterpolator provides continuous waypoint navigation and progress tracking along a closed-loop route.
 */
export class RouteInterpolator {
  constructor(name, waypoints) {
    if (!waypoints || waypoints.length < 2) {
      throw new Error(`Route "${name}" must have at least 2 waypoints`);
    }
    this.name = name;
    this.waypoints = waypoints;

    // Ensure loop closure: if last waypoint does not equal first, add first as terminal waypoint
    const first = waypoints[0];
    const last = waypoints[waypoints.length - 1];
    if (Math.abs(first.lat - last.lat) > 1e-6 || Math.abs(first.lng - last.lng) > 1e-6) {
      this.waypoints = [...waypoints, { ...first }];
    }

    // Precalculate leg distances and cumulative distances
    this.segmentDistances = [];
    this.cumulativeDistances = [0];
    let total = 0;

    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const p1 = this.waypoints[i];
      const p2 = this.waypoints[i + 1];
      const d = haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
      this.segmentDistances.push(d);
      total += d;
      this.cumulativeDistances.push(total);
    }

    this.totalDistance = total;
  }

  /**
   * Interpolate coordinates and heading given distance traveled along the route
   * @param {number} distanceMeters Distance in meters from origin
   * @returns {{ lat: number, lng: number, heading: number }}
   */
  interpolate(distanceMeters) {
    if (this.totalDistance <= 0) {
      return { lat: this.waypoints[0].lat, lng: this.waypoints[0].lng, heading: 0 };
    }

    // Wrap around for closed loop
    const normalizedDistance = ((distanceMeters % this.totalDistance) + this.totalDistance) % this.totalDistance;

    // Binary search or linear search for active segment
    let segIdx = 0;
    for (let i = 0; i < this.cumulativeDistances.length - 1; i++) {
      if (normalizedDistance >= this.cumulativeDistances[i] && normalizedDistance <= this.cumulativeDistances[i + 1]) {
        segIdx = i;
        break;
      }
    }

    const segStartDist = this.cumulativeDistances[segIdx];
    const segLen = this.segmentDistances[segIdx];
    const t = segLen > 0 ? (normalizedDistance - segStartDist) / segLen : 0;

    const p1 = this.waypoints[segIdx];
    const p2 = this.waypoints[segIdx + 1] || this.waypoints[0];

    const lat = p1.lat + (p2.lat - p1.lat) * t;
    const lng = p1.lng + (p2.lng - p1.lng) * t;
    const heading = calculateBearing(p1.lat, p1.lng, p2.lat, p2.lng);

    return { lat, lng, heading };
  }
}

/**
 * Adds Gaussian GPS position noise (approx 1.5m standard deviation)
 */
export function addGPSJitter(lat, lng, gaussianNoiseLat, gaussianNoiseLng) {
  // 1 deg latitude ≈ 111,139 meters
  const metersPerDegLat = 111139;
  const metersPerDegLng = 111139 * Math.cos(lat * DEG_TO_RAD);

  const deltaLat = gaussianNoiseLat / metersPerDegLat;
  const deltaLng = gaussianNoiseLng / Math.max(1, metersPerDegLng);

  return {
    lat: lat + deltaLat,
    lng: lng + deltaLng,
  };
}
