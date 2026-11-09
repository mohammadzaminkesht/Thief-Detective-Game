'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../game-core.js');

test('Fisher–Yates keeps every house exactly once', () => {
  const shuffled = Core.fisherYates(Core.HOUSES, () => 0.37);
  assert.equal(shuffled.length, 10);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), [...Core.HOUSES]);
});

test('candidate count follows the original board geometry', () => {
  assert.equal(Core.getCandidateCount({ T: 0, D: 1 }), 2);
  assert.equal(Core.getCandidateCount({ T: 0, D: 6 }), 3);
  assert.equal(Core.getCandidateCount({ T: 0, D: 9 }), 4);
});

test('candidate generation returns unique valid options for all distinct starting triples', () => {
  let seed = 20261108;
  const rng = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };

  for (const thief of Core.HOUSES) {
    for (const helper of Core.HOUSES) {
      for (const detective of Core.HOUSES) {
        if (new Set([thief, helper, detective]).size !== 3) continue;
        const result = Core.generateCandidates({ T: thief, t: helper, D: detective }, rng);
        assert.equal(result.candidates.length, result.optionCount);
        assert.ok(result.candidates.every(house => Core.HOUSES.includes(house)));
        assert.equal(new Set(result.candidates).size, result.candidates.length);
        assert.equal(result.probabilities.reduce((sum, value) => sum + value, 0), 100);
      }
    }
  }
});

test('eye appearance chance increases by 20 points after every missed check and resets on appearance', () => {
  assert.deepEqual(Core.resolveEyeTurn(0, 0), { enabled: false, parity: null, nextChance: 20 });
  assert.deepEqual(Core.resolveEyeTurn(20, 19, 1), { enabled: true, parity: 1, nextChance: 0 });
  assert.deepEqual(Core.resolveEyeTurn(20, 20), { enabled: false, parity: null, nextChance: 40 });
  assert.deepEqual(Core.resolveEyeTurn(40, 99), { enabled: false, parity: null, nextChance: 60 });
  assert.deepEqual(Core.resolveEyeTurn(60, 99), { enabled: false, parity: null, nextChance: 80 });
  assert.deepEqual(Core.resolveEyeTurn(80, 99), { enabled: false, parity: null, nextChance: 100 });
  assert.deepEqual(Core.resolveEyeTurn(100, 99, 0), { enabled: true, parity: 0, nextChance: 0 });
});

test('eye parity detection distinguishes a matching destination from a matching previous thief house', () => {
  assert.equal(Core.calculateEyeEffect(4, 3, true, 0), 1);
  assert.equal(Core.calculateEyeEffect(5, 8, true, 0), 2);
  assert.equal(Core.calculateEyeEffect(5, 7, true, 0), 0);
  assert.equal(Core.calculateEyeEffect(4, 3, false, 0), 0);
});

test('eye condition 1 sends the detective to the thief current house', () => {
  const options = Core.getEffectiveCandidates({
    candidates: [1, 4, 7],
    eyeEffect: 1,
    eyeParity: 0,
    currentThiefHouse: 8
  });
  assert.deepEqual(options, [8]);
});

test('eye condition 2 removes at most two matching-parity candidates', () => {
  const options = Core.getEffectiveCandidates({
    candidates: [0, 2, 1, 3],
    eyeEffect: 2,
    eyeParity: 0,
    currentThiefHouse: 8
  });
  assert.equal(options.length, 2);
  assert.ok(options.every(house => house % 2 === 1));
  const decision = Core.getDetectiveDecision({
    candidates: [0, 2, 1, 3], eyeEffect: 2, eyeParity: 0, currentThiefHouse: 8, rng: () => 0.1
  });
  assert.deepEqual(decision.options, [3, 1]);
  assert.deepEqual(decision.probabilities, [65, 35]);
  const directHit = Core.getDetectiveDecision({
    candidates: [0, 1, 2], eyeEffect: 1, eyeParity: 0, currentThiefHouse: 8, rng: () => 0.99
  });
  assert.deepEqual(directHit.options, [8]);
  assert.deepEqual(directHit.probabilities, [100]);
  assert.equal(directHit.destination, 8);
});

test('eye condition 2 keeps a valid fallback when every candidate matches', () => {
  const options = Core.getEffectiveCandidates({
    candidates: [0, 2],
    eyeEffect: 2,
    eyeParity: 0,
    currentThiefHouse: 8
  });
  assert.equal(options.length, 1);
  assert.ok(Core.HOUSES.includes(options[0]));
});

test('weighted selection observes the 65/35 threshold for two candidates', () => {
  assert.equal(Core.chooseWeighted(['first', 'second'], () => 0.64), 'first');
  assert.equal(Core.chooseWeighted(['first', 'second'], () => 0.65), 'second');
});

test('player turn counters follow the C++ rules', () => {
  assert.deepEqual(Core.advancePlayerStatus(0, 2, 'T'), { statusT: 1, statusSmallT: 0 });
  assert.deepEqual(Core.advancePlayerStatus(1, 0, 't'), { statusT: 0, statusSmallT: 1 });
  assert.deepEqual(Core.advanceAutomaticStatus(1, 2), { statusT: 0, statusSmallT: 0 });
});

test('the game ends only when detective and main thief share a house', () => {
  assert.equal(Core.isGameOver(5, 5), true);
  assert.equal(Core.isGameOver(5, 4), false);
});

test('special helper/detective shared-house case still keeps candidate identities unique', () => {
  const result = Core.generateCandidates(
    { T: 0, t: 4, D: 4 },
    () => 0.21
  );
  assert.equal(new Set(result.candidates).size, result.candidates.length);
  assert.ok(result.candidates.every(house => Core.HOUSES.includes(house)));
});

test('skipping a player move uses the virtual C++ input value 10 for eye parity', () => {
  assert.equal(Core.calculateEyeEffect(10, 2, true, 0), 1);
  assert.equal(Core.calculateEyeEffect(10, 3, true, 0), 1);
  assert.equal(Core.calculateEyeEffect(10, 3, true, 1), 2);
});

test('weighted selection observes the 60/25/15 thresholds for three candidates', () => {
  assert.equal(Core.chooseWeighted(['a', 'b', 'c'], () => 0.59), 'a');
  assert.equal(Core.chooseWeighted(['a', 'b', 'c'], () => 0.60), 'b');
  assert.equal(Core.chooseWeighted(['a', 'b', 'c'], () => 0.85), 'c');
});
