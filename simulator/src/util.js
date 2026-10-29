// simulator/src/util.js
// Deterministic seedable RNG, Gaussian sampling, and numerical utilities

/**
 * SplitMix32 generator for hashing 32-bit seeds
 */
function splitmix32(a) {
  return function () {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/**
 * Mulberry32 PRNG provides fast, high-quality 32-bit pseudo-random numbers
 */
export function createRNG(seed = null) {
  if (seed === null || seed === undefined) {
    return Math.random;
  }
  const init = typeof seed === 'number' ? seed : 123456789;
  let state = (init ^ 0xdeadbeef) | 0;

  return function mulberry32() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box-Muller transform generates normal Gaussian distribution N(mean, stdDev^2)
 */
export function randomGaussian(rng = Math.random, mean = 0, stdDev = 1) {
  let u1 = rng();
  let u2 = rng();
  // Prevent log(0)
  while (u1 <= 1e-15) u1 = rng();
  while (u2 <= 1e-15) u2 = rng();

  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * stdDev;
}

/**
 * Clamp a number between min and max
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Linear interpolation
 */
export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * 3D Vector Euclidean magnitude: sqrt(x^2 + y^2 + z^2)
 */
export function vec3Magnitude(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/**
 * 16-bit ADC Quantization model
 * Emulates physical sensor ADC quantization steps
 * @param {number} value Floating point value
 * @param {number} lsbPerUnit Sensitivity (e.g. 2048 LSB/g or 16.4 LSB/dps)
 */
export function quantize(value, lsbPerUnit) {
  const counts = Math.round(value * lsbPerUnit);
  return counts / lsbPerUnit;
}

/**
 * Format float to fixed decimal places as number
 */
export function roundTo(val, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

/**
 * Random float in range [min, max) using provided RNG
 */
export function randomRange(rng, min, max) {
  return min + rng() * (max - min);
}

/**
 * Random integer in range [min, max] using provided RNG
 */
export function randomInt(rng, min, max) {
  return Math.floor(randomRange(rng, min, max + 1));
}

/**
 * Pick random element from an array
 */
export function pickRandom(rng, array) {
  if (!array || array.length === 0) return null;
  const index = Math.floor(rng() * array.length);
  return array[index];
}

/**
 * High-resolution millisecond timer for drift-free tick loops
 */
export function nowMs() {
  return performance.now();
}
