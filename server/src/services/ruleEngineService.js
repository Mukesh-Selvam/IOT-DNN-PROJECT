// server/src/services/ruleEngineService.js
// Rule-based accident classification engine used as deterministic fallback and pre-filter

import { getCachedSettings } from './settingsService.js';

/**
 * Evaluates extracted kinematic window features against physical crash boundaries
 * @param {Object} features Extracted feature set from sliding window
 * @returns {{ isAccident: boolean, confidence: number, label: string, reason: string }}
 */
export function evaluateRuleBased(features = {}) {
  const settings = getCachedSettings();
  const impactThreshold = settings.impactThresholdG || 3.5;

  const peakG = features.peakG || 0;
  const speedDropRatio = features.speedDropRatio || 0;
  const maxGyroDps = features.maxGyroDps || 0;
  const speedInitial = features.speedInitial || 0;

  // Criteria 1: Peak resultant acceleration exceeds physical collision threshold
  const hasImpactSpike = peakG >= impactThreshold;

  // Criteria 2: Kinematic confirmation (sudden velocity drop OR violent chassis rotation)
  const hasSpeedDrop = (speedInitial > 15 && speedDropRatio >= 0.40) || (speedDropRatio >= 0.70 && speedInitial > 10);
  const hasViolentRotation = maxGyroDps >= 65; // High yaw/roll rate typical in rollover or side crash
  const isRolloverOrSide = maxGyroDps >= 65 && (speedDropRatio >= 0.15 || peakG >= 2.2);
  const isCrashStop = speedDropRatio >= 0.65 && speedInitial > 10 && peakG >= 1.8;

  // Non-accident immunity check (e.g. pothole vertical spike has no speed loss or rotation)
  const isPotholeBump = peakG < 5.8 && speedDropRatio < 0.08 && maxGyroDps < 25.0;
  const isAccident = !isPotholeBump && (
    (hasImpactSpike && (hasSpeedDrop || hasViolentRotation)) || isRolloverOrSide || isCrashStop
  );

  let confidence = 0.15;
  let reason = 'Normal driving or minor non-accident vibration';

  if (isAccident) {
    confidence = Math.min(0.98, 0.85 + (peakG >= impactThreshold ? 0.08 : 0) + (hasSpeedDrop ? 0.05 : 0));
    reason = `Impact spike ${peakG.toFixed(1)}g with ${
      hasSpeedDrop ? `speed drop ${(speedDropRatio * 100).toFixed(0)}%` : `angular rate ${maxGyroDps.toFixed(0)} dps`
    }`;
  } else if (hasImpactSpike) {
    reason = `High acceleration (${peakG.toFixed(1)}g) without kinematic speed drop or chassis spin (likely pothole / false bump)`;
  }

  return {
    isAccident,
    label: isAccident ? 'ACCIDENT' : 'NON_ACCIDENT',
    confidence: Math.round(confidence * 100) / 100,
    peakG,
    reason,
  };
}

export default {
  evaluateRuleBased,
};
