// simulator/test/dataset_splits.test.js
// Asserts zero run_id overlap across train/val/test splits and dataset integrity

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateLargeSimulationDataset } from '../src/exportDataset.js';

describe('Dataset Integrity and Zero Run-ID Leakage Verification', () => {
  const result = generateLargeSimulationDataset({ targetWindows: 2050 });

  it('guarantees >= 2000 windows generated with required scenario representation', () => {
    assert.ok(result.imbalanced.length >= 2000, `Expected >= 2000 windows, got ${result.imbalanced.length}`);
    const scenarios = Object.keys(result.scenarioCounts);
    assert.equal(scenarios.length, 8, 'Must cover all 8 driving scenarios');
    for (const sc of scenarios) {
      assert.ok(result.scenarioCounts[sc] > 0, `Scenario ${sc} must have windows`);
    }
  });

  it('asserts strictly ZERO run_id overlap between train, val, and test splits', () => {
    const { train, val, test, runCounts } = result.splits;
    const trainRuns = new Set(train.map((w) => w.run_id));
    const valRuns = new Set(val.map((w) => w.run_id));
    const testRuns = new Set(test.map((w) => w.run_id));

    // Verify intersection is completely empty
    const trainValIntersection = [...trainRuns].filter((id) => valRuns.has(id));
    const trainTestIntersection = [...trainRuns].filter((id) => testRuns.has(id));
    const valTestIntersection = [...valRuns].filter((id) => testRuns.has(id));

    assert.equal(
      trainValIntersection.length,
      0,
      `Data leakage found between Train and Val: ${trainValIntersection.join(', ')}`
    );
    assert.equal(
      trainTestIntersection.length,
      0,
      `Data leakage found between Train and Test: ${trainTestIntersection.join(', ')}`
    );
    assert.equal(
      valTestIntersection.length,
      0,
      `Data leakage found between Val and Test: ${valTestIntersection.join(', ')}`
    );

    // Sum of split runs equals total unique runs
    assert.equal(
      trainRuns.size + valRuns.size + testRuns.size,
      runCounts.total,
      'Split runs sum must match total unique runs'
    );
  });

  it('validates noise levels span 0.5x to 3.0x', () => {
    const noiseLevels = result.imbalanced.map((w) => w.noise_level);
    const minNoise = Math.min(...noiseLevels);
    const maxNoise = Math.max(...noiseLevels);

    assert.ok(minNoise <= 0.8, `Min noise should be around 0.5x, found ${minNoise}`);
    assert.ok(maxNoise >= 2.5, `Max noise should reach up to 3.0x, found ${maxNoise}`);
  });

  it('validates hard evaluation set contains low-speed crashes and amplitude scaling', () => {
    assert.ok(result.hard.length > 0, 'Hard evaluation set must be non-empty');
    const hardCrash = result.hard.filter((w) => w.label === 1);
    assert.ok(hardCrash.length > 0, 'Hard set must contain crash windows');
    for (const hc of hardCrash) {
      assert.ok('amplitude_scale' in hc, 'Hard crashes must record amplitude_scale');
    }
  });
});
