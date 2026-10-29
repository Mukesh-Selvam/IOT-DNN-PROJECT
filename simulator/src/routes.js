// simulator/src/routes.js
// Real-world closed-loop routes around Coimbatore and Pollachi, Tamil Nadu

import { RouteInterpolator } from './geo.js';

export const ROUTES = {
  // Route 1: Pollachi to Coimbatore via NH 209 (NH 83) and return loop
  pollachi_coimbatore: {
    id: 'pollachi_coimbatore',
    name: 'Pollachi - Coimbatore Corridor (NH 209)',
    description: 'Intercity arterial highway connecting Pollachi and Coimbatore via Kinathukadavu & Eachanari',
    waypoints: [
      { lat: 10.6609, lng: 77.0048, name: 'Pollachi Bus Stand' },
      { lat: 10.6865, lng: 77.0112, name: 'Achipatti' },
      { lat: 10.7420, lng: 77.0155, name: 'Thamaraikulam' },
      { lat: 10.8174, lng: 77.0194, name: 'Kinathukadavu' },
      { lat: 10.8650, lng: 77.0080, name: 'Arasampalayam' },
      { lat: 10.8988, lng: 76.9965, name: 'Othakkalmandapam' },
      { lat: 10.9254, lng: 76.9856, name: 'Malumichampatti' },
      { lat: 10.9388, lng: 76.9745, name: 'Eachanari Temple' },
      { lat: 10.9602, lng: 76.9682, name: 'Sundarapuram' },
      { lat: 10.9780, lng: 76.9635, name: 'Kurichi Pirivu' },
      { lat: 10.9882, lng: 76.9608, name: 'Ukkadam Junction' },
      { lat: 10.9980, lng: 76.9660, name: 'Coimbatore Railway Station' },
      // Return Leg
      { lat: 10.9820, lng: 76.9750, name: 'Podanur Junction' },
      { lat: 10.9510, lng: 76.9920, name: 'Chettipalayam Road' },
      { lat: 10.9020, lng: 77.0150, name: 'Chettipalayam Bypass' },
      { lat: 10.8250, lng: 77.0250, name: 'Kinathukadavu East' },
      { lat: 10.7450, lng: 77.0210, name: 'Kovilpalayam (Pollachi)' },
      { lat: 10.6720, lng: 77.0090, name: 'Pollachi North Entry' },
      { lat: 10.6609, lng: 77.0048, name: 'Pollachi Bus Stand' },
    ],
  },

  // Route 2: Coimbatore City Circuit
  coimbatore_city: {
    id: 'coimbatore_city',
    name: 'Coimbatore Urban Circuit',
    description: 'City ring route covering Gandhipuram, RS Puram, Race Course, and Avinashi Road',
    waypoints: [
      { lat: 11.0168, lng: 76.9685, name: 'Gandhipuram Central' },
      { lat: 11.0255, lng: 76.9632, name: 'Cross Cut Road' },
      { lat: 11.0220, lng: 76.9510, name: 'Thadagam Road Junction' },
      { lat: 11.0115, lng: 76.9482, name: 'RS Puram D.B. Road' },
      { lat: 11.0020, lng: 76.9555, name: 'Town Hall' },
      { lat: 11.0028, lng: 76.9744, name: 'Race Course South' },
      { lat: 11.0095, lng: 76.9780, name: 'Race Course North' },
      { lat: 10.9942, lng: 76.9912, name: 'Ramanathapuram Trichy Rd' },
      { lat: 10.9995, lng: 77.0255, name: 'Singanallur Junction' },
      { lat: 11.0286, lng: 77.0035, name: 'Peelamedu Avinashi Rd' },
      { lat: 11.0210, lng: 76.9840, name: 'Nava India' },
      { lat: 11.0168, lng: 76.9685, name: 'Gandhipuram Central' },
    ],
  },

  // Route 3: Pollachi to Udumalpet (NH 83)
  pollachi_udumalpet: {
    id: 'pollachi_udumalpet',
    name: 'Pollachi - Udumalpet Expressway',
    description: 'State highway route passing agricultural corridors and wind farm regions',
    waypoints: [
      { lat: 10.6625, lng: 77.0090, name: 'Pollachi New Scheme Rd' },
      { lat: 10.6550, lng: 77.0340, name: 'Makkinampatti' },
      { lat: 10.6480, lng: 77.0620, name: 'Unjavelampatti' },
      { lat: 10.6370, lng: 77.0980, name: 'Chinnampalayam' },
      { lat: 10.6285, lng: 77.1350, name: 'Gomangalampudur' },
      { lat: 10.6180, lng: 77.1650, name: 'Kaniyur Pirivu' },
      { lat: 10.6050, lng: 77.1980, name: 'Kurichikottai' },
      { lat: 10.5920, lng: 77.2250, name: 'Udumalpet Bypass' },
      { lat: 10.5855, lng: 77.2475, name: 'Udumalpet Central' },
      // Return Leg
      { lat: 10.5900, lng: 77.2350, name: 'Udumalpet West' },
      { lat: 10.6120, lng: 77.1850, name: 'Gomangalam Return' },
      { lat: 10.6350, lng: 77.1150, name: 'Pukkulam' },
      { lat: 10.6510, lng: 77.0500, name: 'Vettaikaranpudur Pirivu' },
      { lat: 10.6625, lng: 77.0090, name: 'Pollachi New Scheme Rd' },
    ],
  },
};

const routeInterpolators = {};

export function getRoute(routeId = 'pollachi_coimbatore') {
  if (!routeInterpolators[routeId]) {
    const routeDef = ROUTES[routeId] || ROUTES.pollachi_coimbatore;
    routeInterpolators[routeId] = new RouteInterpolator(routeDef.name, routeDef.waypoints);
  }
  return routeInterpolators[routeId];
}

export function getAllRoutes() {
  return Object.values(ROUTES);
}

export function getRouteByIndex(index = 0) {
  const keys = Object.keys(ROUTES);
  const key = keys[index % keys.length];
  return {
    id: key,
    def: ROUTES[key],
    interpolator: getRoute(key),
  };
}
