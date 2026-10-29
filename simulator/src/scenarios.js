// simulator/src/scenarios.js
// 8 Physics-inspired vehicle driving scenarios with randomized parameters and phase lifecycle

import { clamp, lerp, pickRandom, randomRange } from './util.js';

export const SCENARIO_TYPES = {
  NORMAL: 'normal',
  HARD_BRAKING: 'hard_braking',
  SHARP_TURN: 'sharp_turn',
  POTHOLE: 'pothole',
  FRONTAL_COLLISION: 'frontal_collision',
  SIDE_IMPACT: 'side_impact',
  ROLLOVER: 'rollover',
  REAR_END: 'rear_end',
};

export const ACCIDENT_SCENARIOS = new Set([
  SCENARIO_TYPES.FRONTAL_COLLISION,
  SCENARIO_TYPES.SIDE_IMPACT,
  SCENARIO_TYPES.ROLLOVER,
  SCENARIO_TYPES.REAR_END,
]);

export const NON_ACCIDENT_SCENARIOS = new Set([
  SCENARIO_TYPES.NORMAL,
  SCENARIO_TYPES.HARD_BRAKING,
  SCENARIO_TYPES.SHARP_TURN,
  SCENARIO_TYPES.POTHOLE,
]);

export function isAccidentScenario(scenarioName) {
  return ACCIDENT_SCENARIOS.has(scenarioName);
}

/**
 * ScenarioRunner manages the state, timeline, forces, and speed transitions of a scenario
 */
export class ScenarioRunner {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.currentScenario = SCENARIO_TYPES.NORMAL;
    this.elapsedSec = 0;
    this.durationSec = Infinity;
    this.phase = 'active'; // 'pre', 'impact', 'rebound', 'post_crash_hold', 'completed'
    this.params = {};
    this.impactAt = null;
    this.postCrashHoldSec = 20;

    // Resting gravity orientation (supports vehicle resting on side/roof after rollover)
    this.restingGravity = { x: 0, y: 0, z: 1.0 };
  }

  setPostCrashHoldSec(sec) {
    this.postCrashHoldSec = Math.max(0, sec);
  }

  /**
   * Trigger a scenario with randomized physical parameters
   */
  trigger(scenarioName, options = {}) {
    this.currentScenario = scenarioName;
    this.elapsedSec = 0;
    this.phase = 'active';
    this.impactAt = null;

    if (options.postCrashHoldSec !== undefined) {
      this.postCrashHoldSec = options.postCrashHoldSec;
    }

    const rng = this.rng;

    switch (scenarioName) {
      case SCENARIO_TYPES.NORMAL: {
        this.durationSec = Infinity;
        this.params = {};
        this.restingGravity = { x: 0, y: 0, z: 1.0 };
        break;
      }

      case SCENARIO_TYPES.HARD_BRAKING: {
        // Deceleration 0.45 to 0.75 g for 1.5 to 2.5 s
        this.durationSec = randomRange(rng, 2.0, 3.2);
        this.params = {
          peakDecelG: randomRange(rng, 0.48, 0.72),
          brakeDuration: randomRange(rng, 1.5, 2.2),
          speedDropKmH: randomRange(rng, 22, 34),
        };
        this.restingGravity = { x: 0, y: 0, z: 1.0 };
        break;
      }

      case SCENARIO_TYPES.SHARP_TURN: {
        // Lateral 0.35 to 0.6 g, yaw rate 25 to 45 deg/s for 2.0 to 3.5 s
        const dir = rng() > 0.5 ? 1 : -1;
        this.durationSec = randomRange(rng, 2.5, 3.8);
        this.params = {
          direction: dir,
          peakLatG: randomRange(rng, 0.38, 0.58) * dir,
          peakYawDps: randomRange(rng, 28, 44) * dir,
          turnDuration: randomRange(rng, 2.0, 3.2),
          speedDropKmH: randomRange(rng, 6, 12),
        };
        this.restingGravity = { x: 0, y: 0, z: 1.0 };
        break;
      }

      case SCENARIO_TYPES.POTHOLE: {
        // Short vertical impulse spike with damped ringing. Speed unchanged.
        const amp = options.amplitude !== undefined ? options.amplitude : 1.0;
        this.durationSec = randomRange(rng, 0.35, 0.55);
        this.params = {
          peakVerticalG: randomRange(rng, 1.5, 2.2) * amp,
          impulseDuration: randomRange(rng, 0.08, 0.12),
          frequencyHz: randomRange(rng, 14, 22),
          decayRate: randomRange(rng, 10, 16),
          clampMax: 3.4 * amp,
        };
        this.restingGravity = { x: 0, y: 0, z: 1.0 };
        break;
      }

      case SCENARIO_TYPES.FRONTAL_COLLISION: {
        // 8 to 14g spike over ~0.1s, pre-braking, speed drops to 0 within ~0.35s
        const impactDuration = randomRange(rng, 0.09, 0.14);
        this.durationSec = 0.2 + impactDuration + 0.8; // Pre-brake + impact + rebound
        this.params = {
          preBrakeSec: 0.2,
          impactDuration,
          // Massive deceleration along X (forward) axis
          peakG: randomRange(rng, 8.5, 13.8),
          pitchDps: randomRange(rng, -120, -70),
          stopTimeSec: 0.2 + randomRange(rng, 0.25, 0.35),
        };
        this.restingGravity = { x: 0, y: 0, z: 1.0 };
        break;
      }

      case SCENARIO_TYPES.SIDE_IMPACT: {
        // 6 to 11g lateral spike, strong yaw/roll, stops within ~1.2s
        const sideDir = rng() > 0.5 ? 1 : -1;
        const impactDuration = randomRange(rng, 0.1, 0.16);
        this.durationSec = impactDuration + 1.4;
        this.params = {
          direction: sideDir,
          peakG: randomRange(rng, 6.5, 10.8) * sideDir,
          yawDps: randomRange(rng, 65, 115) * sideDir,
          rollDps: randomRange(rng, 50, 95) * -sideDir,
          impactDuration,
          stopTimeSec: randomRange(rng, 0.9, 1.2),
        };
        this.restingGravity = { x: 0, y: 0, z: 1.0 };
        break;
      }

      case SCENARIO_TYPES.ROLLOVER: {
        // Trip impact (4 to 7g) + roll rate 150 to 400 deg/s + gravity vector rotation + rest in rotated orientation
        const rollDir = rng() > 0.5 ? 1 : -1;
        const rollDuration = randomRange(rng, 1.2, 1.8);
        this.durationSec = rollDuration + 0.8;

        // Final resting orientation: car on its side (roll 90 deg -> Y points down/up) or roof (180 deg)
        // A 90 deg roll puts gravity on the Y axis (|ay| ≈ 1.0g, az ≈ 0g)
        const finalRest = rng() > 0.3 ? 'side' : 'roof';
        this.params = {
          direction: rollDir,
          tripG: randomRange(rng, 4.5, 6.8),
          rollDuration,
          peakRollRate: randomRange(rng, 180, 360) * rollDir,
          finalRest,
          stopTimeSec: rollDuration * 0.9,
        };
        // Resting gravity will be set dynamically as roll progresses
        break;
      }

      case SCENARIO_TYPES.REAR_END: {
        // +5 to 9g forward spike, brief speed jump, then stops
        const impactDuration = randomRange(rng, 0.08, 0.13);
        this.durationSec = impactDuration + 1.6;
        this.params = {
          peakG: randomRange(rng, 5.5, 8.8), // Forward acceleration +ax
          impactDuration,
          speedJumpKmH: randomRange(rng, 6, 12),
          stopTimeSec: randomRange(rng, 1.2, 1.5),
        };
        this.restingGravity = { x: 0, y: 0, z: 1.0 };
        break;
      }

      default:
        this.trigger(SCENARIO_TYPES.NORMAL);
    }
  }

  /**
   * Advance simulation step by dt seconds
   * @param {number} dt Time step in seconds
   * @param {number} currentSpeedKmH Vehicle speed before this step
   * @param {number} cruiseSpeedKmH Nominal vehicle cruise speed
   * @returns {{ dynamicState: Object, targetSpeedKmH: number, isFinished: boolean }}
   */
  step(dt, currentSpeedKmH, cruiseSpeedKmH) {
    this.elapsedSec += dt;
    const t = this.elapsedSec;

    let ax = 0;
    let ay = 0;
    let az = 0;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    let gravityX = this.restingGravity.x;
    let gravityY = this.restingGravity.y;
    let gravityZ = this.restingGravity.z;
    let targetSpeedKmH = currentSpeedKmH;

    switch (this.currentScenario) {
      case SCENARIO_TYPES.NORMAL: {
        this.phase = 'active';
        targetSpeedKmH = cruiseSpeedKmH;
        break;
      }

      case SCENARIO_TYPES.HARD_BRAKING: {
        const { peakDecelG, brakeDuration, speedDropKmH } = this.params;
        if (t <= brakeDuration) {
          this.phase = 'braking';
          // Smooth bell curve deceleration
          const progress = t / brakeDuration;
          const curve = Math.sin(progress * Math.PI);
          ax = -peakDecelG * curve;
          // Pitch down slightly under braking
          gy = -6 * curve;
          targetSpeedKmH = Math.max(10, cruiseSpeedKmH - speedDropKmH * curve);
        } else if (t <= this.durationSec) {
          this.phase = 'recovering';
          const recT = (t - brakeDuration) / (this.durationSec - brakeDuration);
          targetSpeedKmH = lerp(cruiseSpeedKmH - speedDropKmH, cruiseSpeedKmH, recT);
        } else {
          this.phase = 'completed';
          targetSpeedKmH = cruiseSpeedKmH;
        }
        break;
      }

      case SCENARIO_TYPES.SHARP_TURN: {
        const { peakLatG, peakYawDps, turnDuration, speedDropKmH, direction } = this.params;
        if (t <= turnDuration) {
          this.phase = 'turning';
          const progress = t / turnDuration;
          const curve = Math.sin(progress * Math.PI);
          ay = peakLatG * curve;
          gz = peakYawDps * curve;
          // Body roll during turn
          gx = -8 * direction * curve;
          targetSpeedKmH = Math.max(15, cruiseSpeedKmH - speedDropKmH * curve);
        } else if (t <= this.durationSec) {
          this.phase = 'straightening';
          const recT = (t - turnDuration) / (this.durationSec - turnDuration);
          targetSpeedKmH = lerp(cruiseSpeedKmH - speedDropKmH, cruiseSpeedKmH, recT);
        } else {
          this.phase = 'completed';
          targetSpeedKmH = cruiseSpeedKmH;
        }
        break;
      }

      case SCENARIO_TYPES.POTHOLE: {
        const { peakVerticalG, impulseDuration, frequencyHz, decayRate } = this.params;
        // Speed is unchanged during pothole
        targetSpeedKmH = cruiseSpeedKmH;

        if (t <= this.durationSec) {
          this.phase = 'impulse';
          // Damped sinusoidal vertical bounce
          const envelope = Math.exp(-decayRate * t);
          const oscillation = Math.sin(2 * Math.PI * frequencyHz * t);
          // Pure dynamic vertical spike
          let dynAz = peakVerticalG * envelope * oscillation;
          // Explicit clamp: ensure vertical dynamic spike respects clampMax
          const maxAllowed = this.params.clampMax || 3.4;
          if (dynAz + 1.0 > maxAllowed) {
            dynAz = maxAllowed - 1.0;
          } else if (dynAz + 1.0 < -1.5) {
            dynAz = -2.4;
          }
          az = dynAz;
          gy = 15 * envelope * oscillation;
        } else {
          this.phase = 'completed';
        }
        break;
      }

      case SCENARIO_TYPES.FRONTAL_COLLISION: {
        const { preBrakeSec, impactDuration, peakG, pitchDps, stopTimeSec } = this.params;
        if (t < preBrakeSec) {
          this.phase = 'pre';
          ax = -0.5;
          targetSpeedKmH = Math.max(20, cruiseSpeedKmH - 15 * (t / preBrakeSec));
        } else if (t < preBrakeSec + impactDuration) {
          this.phase = 'impact';
          if (!this.impactAt) this.impactAt = Date.now();
          const impactT = (t - preBrakeSec) / impactDuration;
          // Sharp half-sine pulse of severe negative longitudinal acceleration
          const pulse = Math.sin(impactT * Math.PI);
          ax = -peakG * pulse;
          gy = pitchDps * pulse;
          az = 1.2 * pulse;
          // Rapid speed loss
          targetSpeedKmH = Math.max(0, cruiseSpeedKmH * (1 - impactT * 1.5));
        } else if (t < stopTimeSec) {
          this.phase = 'rebound';
          const postT = (t - (preBrakeSec + impactDuration)) / 0.5;
          const decay = Math.exp(-6 * postT);
          ax = peakG * 0.15 * Math.sin(postT * Math.PI * 8) * decay;
          targetSpeedKmH = 0;
        } else if (t < stopTimeSec + this.postCrashHoldSec) {
          this.phase = 'post_crash_hold';
          targetSpeedKmH = 0;
        } else {
          this.phase = 'completed';
          targetSpeedKmH = cruiseSpeedKmH;
        }
        break;
      }

      case SCENARIO_TYPES.SIDE_IMPACT: {
        const { peakG, yawDps, rollDps, impactDuration, stopTimeSec } = this.params;
        if (t < impactDuration) {
          this.phase = 'impact';
          if (!this.impactAt) this.impactAt = Date.now();
          const pulse = Math.sin((t / impactDuration) * Math.PI);
          ay = peakG * pulse;
          gz = yawDps * pulse;
          gx = rollDps * pulse;
          ax = -1.5 * pulse;
          targetSpeedKmH = Math.max(0, currentSpeedKmH - currentSpeedKmH * (t / stopTimeSec));
        } else if (t < stopTimeSec) {
          this.phase = 'rebound';
          const remT = (t - impactDuration) / (stopTimeSec - impactDuration);
          const decay = Math.exp(-4 * remT);
          ay = (peakG * 0.2) * Math.sin(remT * Math.PI * 6) * decay;
          targetSpeedKmH = Math.max(0, currentSpeedKmH * (1 - remT));
        } else if (t < stopTimeSec + this.postCrashHoldSec) {
          this.phase = 'post_crash_hold';
          targetSpeedKmH = 0;
        } else {
          this.phase = 'completed';
          targetSpeedKmH = cruiseSpeedKmH;
        }
        break;
      }

      case SCENARIO_TYPES.ROLLOVER: {
        const { tripG, rollDuration, peakRollRate, finalRest, stopTimeSec } = this.params;
        if (t < 0.2) {
          // Phase 1: Trip impact
          this.phase = 'impact';
          if (!this.impactAt) this.impactAt = Date.now();
          const pulse = Math.sin((t / 0.2) * Math.PI);
          ay = tripG * pulse;
          az = 2.0 * pulse;
          gx = peakRollRate * 0.5 * pulse;
          targetSpeedKmH = Math.max(0, currentSpeedKmH - 20 * pulse);
        } else if (t < rollDuration) {
          // Phase 2: Active tumbling / rolling
          this.phase = 'rolling';
          const rollT = (t - 0.2) / (rollDuration - 0.2);
          const rollAngleRad = rollT * Math.PI * (finalRest === 'roof' ? 1.0 : 0.5);

          gx = peakRollRate * (1 - rollT * 0.4);
          gz = 40 * Math.sin(rollT * Math.PI);

          // Ground bounce spikes while tumbling
          if (Math.sin(rollT * Math.PI * 4) > 0.8) {
            az = randomRange(this.rng, 2.5, 4.5);
            ay = randomRange(this.rng, -2.5, 2.5);
          }

          // Dynamic gravity vector rotation: gravity shifts from Z to Y
          gravityZ = Math.cos(rollAngleRad) * 1.0;
          gravityY = Math.sin(rollAngleRad) * 1.0;

          targetSpeedKmH = Math.max(0, cruiseSpeedKmH * (1 - rollT));
        } else if (t < stopTimeSec + this.postCrashHoldSec) {
          // Phase 3: Vehicle at rest in rotated orientation
          this.phase = 'post_crash_hold';
          targetSpeedKmH = 0;

          // The gravity vector REMAINS rotated while stopped!
          if (finalRest === 'side') {
            // Vehicle on side: resting ay is ±1.0g, az is ~0g
            const sideSign = this.params.direction;
            gravityX = 0;
            gravityY = sideSign * 0.98;
            gravityZ = 0.05;
          } else {
            // Vehicle inverted on roof: resting az is -1.0g
            gravityX = 0;
            gravityY = 0;
            gravityZ = -0.98;
          }
          this.restingGravity = { x: gravityX, y: gravityY, z: gravityZ };
        } else {
          this.phase = 'completed';
          targetSpeedKmH = cruiseSpeedKmH;
          this.restingGravity = { x: 0, y: 0, z: 1.0 };
        }
        break;
      }

      case SCENARIO_TYPES.REAR_END: {
        const { peakG, impactDuration, speedJumpKmH, stopTimeSec } = this.params;
        if (t < impactDuration) {
          this.phase = 'impact';
          if (!this.impactAt) this.impactAt = Date.now();
          const pulse = Math.sin((t / impactDuration) * Math.PI);
          // Sudden forward push (+ax)
          ax = peakG * pulse;
          // Temporary speed jump
          targetSpeedKmH = cruiseSpeedKmH + speedJumpKmH * pulse;
        } else if (t < stopTimeSec) {
          this.phase = 'braking_to_stop';
          const decelT = (t - impactDuration) / (stopTimeSec - impactDuration);
          ax = -2.5 * (1 - decelT);
          targetSpeedKmH = Math.max(0, (cruiseSpeedKmH + speedJumpKmH) * (1 - decelT));
        } else if (t < stopTimeSec + this.postCrashHoldSec) {
          this.phase = 'post_crash_hold';
          targetSpeedKmH = 0;
        } else {
          this.phase = 'completed';
          targetSpeedKmH = cruiseSpeedKmH;
        }
        break;
      }
    }

    const isFinished = this.phase === 'completed';

    return {
      dynamicState: {
        ax,
        ay,
        az,
        gx,
        gy,
        gz,
        gravityX,
        gravityY,
        gravityZ,
      },
      targetSpeedKmH: Math.max(0, targetSpeedKmH),
      isFinished,
    };
  }

  getGroundTruth() {
    return {
      scenario: this.currentScenario,
      label: isAccidentScenario(this.currentScenario) ? 'ACCIDENT' : 'NON_ACCIDENT',
      phase: this.phase,
      scenarioTime: Math.round(this.elapsedSec * 100) / 100,
      impactAt: this.impactAt,
    };
  }
}

/**
 * Returns a list of all scenario metadata (used by /scenarios API)
 */
export function getScenariosList() {
  return [
    {
      id: SCENARIO_TYPES.NORMAL,
      name: 'Normal Driving',
      type: 'NON_ACCIDENT',
      description: 'Standard cruising along route with minor chassis vibration and road surface noise.',
    },
    {
      id: SCENARIO_TYPES.HARD_BRAKING,
      name: 'Hard Braking',
      type: 'NON_ACCIDENT',
      description: 'Sudden longitudinal deceleration (0.45 to 0.75 g) followed by smooth speed recovery.',
    },
    {
      id: SCENARIO_TYPES.SHARP_TURN,
      name: 'Sharp Turn / Evasive Maneuver',
      type: 'NON_ACCIDENT',
      description: 'Aggressive lateral steering (0.35 to 0.6 g, 25 to 45 deg/s yaw) without collision.',
    },
    {
      id: SCENARIO_TYPES.POTHOLE,
      name: 'Pothole / Speed Bump',
      type: 'NON_ACCIDENT',
      description: 'Damped vertical impulse (2.5 to 3.3 g total peak) staying strictly below 4.0 g crash threshold.',
    },
    {
      id: SCENARIO_TYPES.FRONTAL_COLLISION,
      name: 'Frontal Collision',
      type: 'ACCIDENT',
      description: 'Severe head-on impact (8 to 14 g spike) with rapid velocity drop to 0 within 0.35 s.',
    },
    {
      id: SCENARIO_TYPES.SIDE_IMPACT,
      name: 'Side Impact (T-Bone)',
      type: 'ACCIDENT',
      description: 'Violent lateral acceleration (6 to 11 g spike) accompanied by high chassis yaw and roll spin.',
    },
    {
      id: SCENARIO_TYPES.ROLLOVER,
      name: 'Vehicle Rollover',
      type: 'ACCIDENT',
      description: 'Trip impact (4 to 7 g) with 150 to 400 deg/s roll rotation; gravity vector permanently rotates while stopped.',
    },
    {
      id: SCENARIO_TYPES.REAR_END,
      name: 'Rear-End Collision',
      type: 'ACCIDENT',
      description: 'Forward acceleration impulse (+5 to 9 g), brief velocity surge, followed by emergency stop.',
    },
  ];
}
