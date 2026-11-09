/*
 * Thief & Detective — pure game rules
 * Kept separate from the DOM so the rules can be tested without a browser.
 */
(function attachGameCore(root) {
  'use strict';

  const HOUSES = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  function randomInt(max, rng = Math.random) {
    if (!Number.isInteger(max) || max <= 0) {
      throw new RangeError('max must be a positive integer');
    }
    return Math.floor(rng() * max);
  }

  function fisherYates(items, rng = Math.random) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1, rng);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function getCandidateCount(positions) {
    const thiefHouse = positions.T;
    const detectiveHouse = positions.D;

    if (!HOUSES.includes(thiefHouse) || !HOUSES.includes(detectiveHouse)) {
      throw new RangeError('T and D must occupy valid houses');
    }

    const thiefColumn = Math.floor(thiefHouse / 2);
    const detectiveColumn = Math.floor(detectiveHouse / 2);
    const thiefY = thiefHouse % 2 === 0 ? 5 : 15;
    const detectiveY = detectiveHouse % 2 === 0 ? 8 : 12;
    const verticalDistance = Math.abs(thiefY - detectiveY);

    // This reproduces the geometry conditions in Neighbor() from the C++ source.
    if (
      (verticalDistance === 7 && thiefColumn === detectiveColumn) ||
      (Math.abs(thiefColumn - detectiveColumn) === 1 && verticalDistance === 3)
    ) {
      return 2;
    }

    if (verticalDistance === 3) return 3;
    return 4;
  }

  function getWeights(optionCount) {
    if (optionCount <= 1) return [100];
    if (optionCount === 2) return [65, 35];
    if (optionCount === 3) return [60, 25, 15];
    return [50, 30, 15, 5];
  }

  function swap(list, a, b) {
    [list[a], list[b]] = [list[b], list[a]];
  }

  function generateCandidates(positions, rng = Math.random) {
    const optionCount = getCandidateCount(positions);
    const candidates = [positions.T];

    // The C++ Neighbor() chooses three distinct alternatives, excluding T and D.
    const possibleAlternatives = HOUSES.filter(
      house => house !== positions.T && house !== positions.D
    );
    candidates.push(...fisherYates(possibleAlternatives, rng).slice(0, 3));

    // Preserve the original special case: when t and D share a house,
    // the first candidate can be replaced by a fourth distinct house.
    if (randomInt(100, rng) < 50 && positions.t === positions.D) {
      const used = new Set([
        positions.T,
        candidates[1],
        candidates[2],
        candidates[3]
      ]);
      const replacements = HOUSES.filter(house => !used.has(house));
      if (replacements.length > 0) {
        candidates[0] = replacements[randomInt(replacements.length, rng)];
      }
    }

    // The original program probabilistically changes which candidate receives
    // the largest probability. The thresholds below follow its 0–99 roll.
    const reorderRoll = randomInt(100, rng);
    if (optionCount === 2 && reorderRoll <= 50) {
      swap(candidates, 0, 1);
    } else if (optionCount === 3) {
      if (reorderRoll < 33) swap(candidates, 0, 1);
      else if (reorderRoll < 66) swap(candidates, 0, 2);
    } else if (optionCount === 4) {
      if (reorderRoll < 25) swap(candidates, 0, 1);
      else if (reorderRoll < 50) swap(candidates, 0, 2);
      else if (reorderRoll < 75) swap(candidates, 0, 3);
    }

    const activeCandidates = candidates.slice(0, optionCount);
    return {
      candidates: activeCandidates,
      optionCount,
      probabilities: getWeights(activeCandidates.length)
    };
  }


  function resolveEyeTurn(currentChance, roll, parityRoll = 0) {
    if (!Number.isInteger(currentChance) || currentChance < 0 || currentChance > 100) {
      throw new RangeError('currentChance must be an integer from 0 to 100');
    }
    if (!Number.isInteger(roll) || roll < 0 || roll > 99) {
      throw new RangeError('roll must be an integer from 0 to 99');
    }
    if (!Number.isInteger(parityRoll) || parityRoll < 0 || parityRoll > 1) {
      throw new RangeError('parityRoll must be 0 or 1');
    }

    if (roll < currentChance) {
      return { enabled: true, parity: parityRoll, nextChance: 0 };
    }
    return { enabled: false, parity: null, nextChance: Math.min(100, currentChance + 20) };
  }

  function calculateEyeEffect(chosenHouse, previousThiefHouse, eyeEnabled, eyeParity) {
    if (!eyeEnabled) return 0;
    if (chosenHouse % 2 === eyeParity) return 1;
    if (previousThiefHouse % 2 === eyeParity) return 2;
    return 0;
  }

  function getEffectiveCandidates({
    candidates,
    eyeEffect = 0,
    eyeParity = 0,
    currentThiefHouse
  }) {
    const base = [...candidates];

    // e_T == 1 in the C++ detective(): detective goes directly to the thief's new house.
    if (eyeEffect === 1) {
      return [currentThiefHouse];
    }

    if (eyeEffect !== 2) return base;

    // The C++ code uses swap-with-last and decrements the active option count,
    // with at most two removals. This is the safe, explicit equivalent of that intent.
    let removals = 0;
    for (let index = 0; index < base.length && removals < 2;) {
      if (base[index] % 2 === eyeParity) {
        base[index] = base[base.length - 1];
        base.pop();
        removals += 1;
      } else {
        index += 1;
      }
    }

    // Keep at least one valid destination, matching the original fallback to one option.
    if (base.length === 0 && candidates.length > 0) {
      base.push(candidates[0]);
    }
    if (base.length === 0) base.push(currentThiefHouse);
    return base;
  }

  function chooseWeighted(options, rng = Math.random) {
    if (!Array.isArray(options) || options.length === 0) {
      throw new RangeError('At least one detective destination is required');
    }
    if (options.length === 1) return options[0];

    const weights = getWeights(options.length);
    const roll = randomInt(100, rng) + 1; // 1–100, like the C++ detective().
    let cumulative = 0;

    for (let index = 0; index < options.length; index += 1) {
      cumulative += weights[index];
      if (roll <= cumulative) return options[index];
    }
    return options[options.length - 1];
  }

  function getDetectiveDecision({
    candidates,
    eyeEffect = 0,
    eyeParity = 0,
    currentThiefHouse,
    rng = Math.random
  }) {
    const options = getEffectiveCandidates({
      candidates,
      eyeEffect,
      eyeParity,
      currentThiefHouse
    });
    const probabilities = getWeights(options.length);
    return {
      options,
      probabilities,
      destination: chooseWeighted(options, rng)
    };
  }

  function advancePlayerStatus(statusT, statusSmallT, character) {
    let nextT = statusT;
    let nextSmallT = statusSmallT;

    if (character === 'T') {
      nextT = (nextT + 1) % 2;
      if (nextSmallT !== 0) nextSmallT = (nextSmallT + 1) % 3;
    } else if (character === 't') {
      nextSmallT = (nextSmallT + 1) % 3;
      if (nextT !== 0) nextT = (nextT + 1) % 2;
    } else {
      throw new TypeError('character must be T or t');
    }

    return { statusT: nextT, statusSmallT: nextSmallT };
  }

  function advanceAutomaticStatus(statusT, statusSmallT) {
    return {
      statusT: (statusT + 1) % 2,
      statusSmallT: (statusSmallT + 1) % 3
    };
  }

  function isGameOver(thiefHouse, detectiveHouse) {
    return thiefHouse === detectiveHouse;
  }

  const api = Object.freeze({
    HOUSES,
    randomInt,
    fisherYates,
    getCandidateCount,
    getWeights,
    generateCandidates,
    calculateEyeEffect,
    resolveEyeTurn,
    getEffectiveCandidates,
    chooseWeighted,
    getDetectiveDecision,
    advancePlayerStatus,
    advanceAutomaticStatus,
    isGameOver
  });

  root.ThiefDetectiveCore = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
