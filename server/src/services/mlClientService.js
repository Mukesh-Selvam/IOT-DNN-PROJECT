// server/src/services/mlClientService.js
// Client interface to Python FastAPI ML microservice with timeout, retry, and rule-based fallback

import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { evaluateRuleBased } from './ruleEngineService.js';

export async function predict(deviceId, window, features) {
  const startTime = Date.now();
  const url = `${config.mlServiceUrl}/predict`;

  const payload = {
    deviceId,
    sampleRateHz: 50,
    features,
    window,
  };

  // Attempt 1: Call ML microservice
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await axios.post(url, payload, {
        timeout: config.mlTimeoutMs,
      });

      const latencyMs = Date.now() - startTime;
      const data = response.data;

      return {
        label: data.label || 'NON_ACCIDENT',
        confidence: data.confidence ?? 0.5,
        peakG: data.peakG || features.peakG,
        detectionSource: 'ML',
        model: data.model || 'fastapi-dnn',
        latencyMs,
      };
    } catch (err) {
      if (attempt === 1) {
        logger.debug(`[ML Client] Attempt 1 failed for ${deviceId}: ${err.message}. Retrying...`);
      } else {
        logger.warn(
          `[ML Client] ML service unreachable at ${url} (${err.message}). Activating Rule-Based Fallback Engine.`
        );
      }
    }
  }

  // Fallback to Rule Engine
  const latencyMs = Date.now() - startTime;
  const ruleResult = evaluateRuleBased(features);

  return {
    label: ruleResult.label,
    confidence: ruleResult.confidence,
    peakG: ruleResult.peakG,
    detectionSource: 'RULE_BASED',
    model: 'rule-fallback',
    reason: ruleResult.reason,
    latencyMs,
  };
}

export default {
  predict,
};
