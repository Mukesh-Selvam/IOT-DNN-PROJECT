#!/usr/bin/env node
// simulator/src/index.js
// CLI entrypoint, argument parsing, interactive REPL, and fleet lifecycle management

import { program } from 'commander';
import readline from 'readline';
import config, { updateSettings } from './config.js';
import { ControlServer } from './control.js';
import { Fleet } from './fleet.js';
import logger from './logger.js';
import { getScenariosList } from './scenarios.js';

program
  .name('iot-simulator')
  .description('Virtual ESP32 Fleet Simulator with MPU6050 & GPS Sensor Emulation')
  .version('1.0.0')
  .option('-v, --vehicles <number>', 'Number of vehicles to emulate', (val) => parseInt(val, 10), config.vehicleCount)
  .option('-r, --rate <hz>', 'Sample rate loop frequency in Hz (10 to 200)', (val) => parseInt(val, 10), config.sampleRateHz)
  .option('-n, --noise <scale>', 'Sensor Gaussian noise multiplier', (val) => parseFloat(val), config.noiseScale)
  .option('-s, --scenario <name>', 'Initial scenario to trigger immediately or after delay')
  .option('-d, --device <id>', 'Target device for scenario trigger (id, 1-based index, or "all")', '1')
  .option('--after <seconds>', 'Seconds to wait before triggering the specified scenario', (val) => parseFloat(val), 0)
  .option('--cancel-after <seconds>', 'Seconds after crash to simulate driver false-alarm cancel', (val) => parseFloat(val))
  .option('--seed <number>', 'Deterministic seed for repeatable sensor traces', (val) => parseInt(val, 10))
  .option('--no-auto', 'Disable automatic periodic non-accident events')
  .option('--dry-run', 'Run without MQTT broker; print 1 Hz status line to console')
  .option('--no-repl', 'Disable interactive REPL prompt (required for headless / Docker)')
  .option('-l, --list', 'List all 8 available driving scenarios and exit');

program.parse(process.argv);
const options = program.opts();

// Handle --list
if (options.list) {
  console.log('\n=== Available Vehicle Driving Scenarios ===\n');
  const scenarios = getScenariosList();
  for (const s of scenarios) {
    const badge = s.type === 'ACCIDENT' ? '\x1b[31m[ACCIDENT]\x1b[0m    ' : '\x1b[32m[NON-ACCIDENT]\x1b[0m';
    console.log(`${badge} ${s.id.padEnd(20, ' ')} : ${s.name}`);
    console.log(`    ↳ ${s.description}\n`);
  }
  process.exit(0);
}

// Merge CLI options into runtime configuration
const vehicleCount = options.vehicles || config.vehicleCount;
const sampleRateHz = options.rate || config.sampleRateHz;
const noiseScale = options.noise !== undefined ? options.noise : config.noiseScale;
const autoEvents = options.auto !== undefined ? options.auto : config.autoEvents;
const dryRun = Boolean(options.dryRun);
const seed = options.seed !== undefined ? options.seed : config.seed;

updateSettings({
  sampleRateHz,
  noiseScale,
  autoEvents,
});

console.log('\n======================================================');
console.log('   IoT Virtual ESP32 Fleet Simulator (Phase 2)       ');
console.log('======================================================');
console.log(`• Vehicles     : ${vehicleCount}`);
console.log(`• Sample Rate  : ${sampleRateHz} Hz (${1000 / sampleRateHz} ms loop)`);
console.log(`• Noise Scale  : ${noiseScale}x`);
console.log(`• Auto-Events  : ${autoEvents ? 'Enabled (20-45s random)' : 'Disabled'}`);
console.log(`• MQTT Broker  : ${dryRun ? 'DRY-RUN (Bypassed)' : config.mqttUrl}`);
console.log(`• Control HTTP : http://localhost:${config.controlPort}`);
console.log(`• Random Seed  : ${seed !== null ? seed : 'Randomized'}`);
console.log('======================================================\n');

// 1. Instantiate Fleet & Control Server
const fleet = new Fleet({
  vehicleCount,
  sampleRateHz,
  dryRun,
  seed,
});

const controlServer = new ControlServer({
  fleet,
  port: config.controlPort,
  apiKey: config.controlApiKey,
  dryRun,
});

// 2. Start simulation and control server
await fleet.start();
controlServer.start();

// 3. Handle initial scenario trigger from CLI (if passed)
if (options.scenario) {
  const triggerSec = options.after || 0;
  const targetDevice = options.device || '1';
  const cancelSec = options.cancelAfter;

  if (triggerSec > 0) {
    logger.info(`Scheduled scenario "${options.scenario}" on device ${targetDevice} in ${triggerSec} seconds...`);
    setTimeout(() => {
      fleet.triggerScenario(targetDevice, options.scenario, cancelSec);
    }, triggerSec * 1000);
  } else {
    fleet.triggerScenario(targetDevice, options.scenario, cancelSec);
  }
}

// 4. Interactive REPL Prompt (unless --no-repl or non-interactive terminal)
const shouldRunRepl = options.repl && process.stdin.isTTY;

if (shouldRunRepl) {
  console.log('Interactive CLI ready. Type "help" or "?" for commands.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'sim> ',
  });

  rl.prompt();

  rl.on('line', (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    const parts = input.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'help':
      case '?':
        console.log('\nAvailable Interactive Commands:');
        console.log('  list                                     : Show all 8 scenarios');
        console.log('  status                                   : Show vehicle fleet status');
        console.log('  trigger <id|all> <scenario> [cancelSec]  : Trigger crash or event');
        console.log('  cancel [id|all]                          : Simulate driver false-alarm cancel');
        console.log('  reset [id|all]                           : Reset vehicle to normal driving');
        console.log('  noise <scale>                            : Adjust sensor noise scale');
        console.log('  rate <hz>                                : Adjust sample rate frequency');
        console.log('  auto <on|off>                            : Toggle auto non-accident events');
        console.log('  pause                                    : Pause simulation loop');
        console.log('  resume                                   : Resume simulation loop');
        console.log('  quit / exit                              : Terminate simulator\n');
        break;

      case 'list': {
        const scenarios = getScenariosList();
        console.log('\nAvailable Scenarios:');
        for (const s of scenarios) {
          const type = s.type === 'ACCIDENT' ? '\x1b[31mACCIDENT\x1b[0m' : '\x1b[32mNON-ACCIDENT\x1b[0m';
          console.log(`  ${s.id.padEnd(20, ' ')} [${type}] : ${s.description}`);
        }
        console.log('');
        break;
      }

      case 'status': {
        const statuses = fleet.getVehiclesStatus();
        console.log('\nFleet Status:');
        for (const s of statuses) {
          console.log(
            `  [${s.deviceId}] Plate: ${s.plate} | Speed: ${s.speedKmH} km/h | Scenario: ${s.scenario} (${s.phase}) | Buzzer: ${s.buzzer} | Alert: ${s.alertPending ? 'YES' : 'NO'}`
          );
        }
        console.log('');
        break;
      }

      case 'trigger': {
        if (args.length < 2) {
          console.log('Usage: trigger <device_id|1-based_index|all> <scenario_name> [cancelAfterSec]');
          break;
        }
        const target = args[0];
        const scenario = args[1];
        const cancelSec = args[2] ? parseFloat(args[2]) : null;
        try {
          const res = fleet.triggerScenario(target, scenario, cancelSec);
          console.log(`✓ Triggered "${res.scenario}" on [${res.affected.join(', ')}]`);
        } catch (err) {
          console.error(`✗ Error: ${err.message}`);
        }
        break;
      }

      case 'cancel': {
        const target = args[0] || 'all';
        const res = fleet.cancelAlert(target, 'CLI_CANCEL');
        console.log(`✓ Cancelled alert for: [${res.affected.join(', ')}]`);
        break;
      }

      case 'reset': {
        const target = args[0] || 'all';
        const res = fleet.reset(target);
        console.log(`✓ Reset state for: [${res.affected.join(', ')}]`);
        break;
      }

      case 'noise': {
        const scale = parseFloat(args[0]);
        if (isNaN(scale) || scale < 0) {
          console.log('Usage: noise <number >= 0>');
        } else {
          fleet.updateFleetSettings({ noiseScale: scale });
          console.log(`✓ Sensor noise scale updated to ${scale}x`);
        }
        break;
      }

      case 'rate': {
        const hz = parseInt(args[0], 10);
        if (isNaN(hz) || hz < 10 || hz > 200) {
          console.log('Usage: rate <10 to 200>');
        } else {
          fleet.updateFleetSettings({ sampleRateHz: hz });
          console.log(`✓ Sample rate frequency updated to ${hz} Hz`);
        }
        break;
      }

      case 'auto': {
        const state = args[0] ? args[0].toLowerCase() : '';
        if (state === 'on' || state === 'true' || state === '1') {
          fleet.updateFleetSettings({ autoEvents: true });
          console.log('✓ Automatic non-accident events enabled');
        } else if (state === 'off' || state === 'false' || state === '0') {
          fleet.updateFleetSettings({ autoEvents: false });
          console.log('✓ Automatic non-accident events disabled');
        } else {
          console.log('Usage: auto <on|off>');
        }
        break;
      }

      case 'pause':
        fleet.pause();
        console.log('✓ Simulation paused');
        break;

      case 'resume':
        fleet.resume();
        console.log('✓ Simulation resumed');
        break;

      case 'quit':
      case 'exit':
        shutdown();
        return;

      default:
        console.log(`Unknown command: "${cmd}". Type "help" for available commands.`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    shutdown();
  });
}

// 5. Graceful Process Shutdown
function shutdown() {
  console.log('\nShutting down IoT Device Simulator...');
  controlServer.stop();
  fleet.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
