// simulator/src/buzzer.js
// Virtual buzzer with firmware-like actuation, state management, and auto-off timer

import { EventEmitter } from 'events';
import logger from './logger.js';

export class VirtualBuzzer extends EventEmitter {
  constructor(deviceId, autoOffSec = 60) {
    super();
    this.deviceId = deviceId;
    this.autoOffSec = autoOffSec;
    this.state = 'OFF';
    this.autoOffTimer = null;
    this.turnedOnAt = null;
  }

  /**
   * IMPORTANT: Named turnOn() rather than on() to avoid overriding EventEmitter.prototype.on
   * @param {string} reason Diagnostic or actuation trigger reason
   */
  turnOn(reason = 'ALERT') {
    if (this.state === 'ON') {
      // Refresh auto-off timer
      this._resetTimer();
      return;
    }

    this.state = 'ON';
    this.turnedOnAt = Date.now();
    logger.event('BUZZER_ON', this.deviceId, `[Reason: ${reason}]`);
    this.emit('change', { state: 'ON', reason, deviceId: this.deviceId });

    this._resetTimer();
  }

  /**
   * IMPORTANT: Named turnOff() rather than off() to avoid overriding EventEmitter.prototype.off
   * @param {string} reason Diagnostic or actuation trigger reason
   */
  turnOff(reason = 'MANUAL') {
    if (this.state === 'OFF') return;

    this.state = 'OFF';
    this.turnedOnAt = null;
    if (this.autoOffTimer) {
      clearTimeout(this.autoOffTimer);
      this.autoOffTimer = null;
    }

    logger.event('BUZZER_OFF', this.deviceId, `[Reason: ${reason}]`);
    this.emit('change', { state: 'OFF', reason, deviceId: this.deviceId });
  }

  getState() {
    return this.state;
  }

  _resetTimer() {
    if (this.autoOffTimer) {
      clearTimeout(this.autoOffTimer);
    }
    if (this.autoOffSec > 0) {
      this.autoOffTimer = setTimeout(() => {
        if (this.state === 'ON') {
          this.turnOff('AUTO_TIMEOUT');
        }
      }, this.autoOffSec * 1000);
      if (this.autoOffTimer.unref) {
        this.autoOffTimer.unref();
      }
    }
  }

  destroy() {
    if (this.autoOffTimer) {
      clearTimeout(this.autoOffTimer);
      this.autoOffTimer = null;
    }
    this.removeAllListeners();
  }
}

export default VirtualBuzzer;
