'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const Core = window.ThiefDetectiveCore;

if (!Core) {
  throw new Error('game-core.js باید قبل از game.js بارگذاری شود.');
}

const screens = {
  menu: $('#menuScreen'),
  game: $('#gameScreen'),
  records: $('#recordsScreen'),
  tips: $('#tipsScreen'),
  settings: $('#settingsScreen')
};

const STORAGE_KEYS = {
  records: 'thiefDetectiveRecordsV1',
  settings: 'thiefDetectiveSettingsV1',
  stats: 'thiefDetectiveStatsV1',
  onboarding: 'thiefDetectiveOnboardingSeenV1'
};

const ANIMATION_DURATIONS = Object.freeze({
  fast: 2500,
  normal: 5000,
  slow: 7500
});

// This is only a short pause between turns, not part of a character animation.
const TURN_PAUSES = Object.freeze({ fast: 180, normal: 220, slow: 260 });
// Give the player enough time to notice the detective's chosen destination before movement.
const DETECTIVE_REVEAL_DELAYS = Object.freeze({ fast: 900, normal: 1150, slow: 1350 });
const LOADING_MIN_DURATION = 3100;
const LOADING_FADE_DURATION = 420;

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn(`Storage read failed for ${key}:`, error);
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Storage write failed for ${key}:`, error);
    return false;
  }
}

function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`Storage remove failed for ${key}:`, error);
    return false;
  }
}

function parseStoredJSON(key, fallback) {
  const raw = readStorage(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`Invalid stored JSON for ${key}:`, error);
    return fallback;
  }
}

function normalizeSettings(value) {
  const allowedSpeeds = Object.keys(ANIMATION_DURATIONS);
  return {
    soundEnabled: typeof value?.soundEnabled === 'boolean' ? value.soundEnabled : true,
    animationSpeed: allowedSpeeds.includes(value?.animationSpeed) ? value.animationSpeed : 'normal',
    reduceMotion: typeof value?.reduceMotion === 'boolean' ? value.reduceMotion : false
  };
}

const savedSettings = normalizeSettings(
  parseStoredJSON(STORAGE_KEYS.settings, {})
);

const state = {
  screen: 'menu',
  returnScreen: 'menu',
  positions: { T: null, t: null, D: null },
  statusT: 0,
  statusSmallT: 0,
  score: 0,
  selectedCharacter: null,
  candidates: [],
  candidateProbabilities: [],
  detectiveOptions: [],
  detectiveProbabilities: [],
  detectiveDecision: null,
  detectiveTargetHouse: null,
  detectiveTargetProbability: null,
  detectivePreviewActive: false,
  probabilityAnimationPending: false,
  eyeProbability: 0,
  eyeCheckedChance: 0,
  eyeEnabled: false,
  eyeParity: 0,
  eyeEffect: 0,
  eyeEffectMessage: '',
  eyeActionPending: false,
  optionCount: 4,
  busy: false,
  gameEnded: false,
  soundEnabled: savedSettings.soundEnabled,
  animationSpeed: savedSettings.animationSpeed,
  reduceMotion: savedSettings.reduceMotion,
  records: [],
  stats: {
    gamesPlayed: 0,
    totalScore: 0,
    bestScore: 0,
    lastScore: null,
    lastPlayedAt: null
  }
};

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function nextFrame() {
  return new Promise(resolve => window.requestAnimationFrame(resolve));
}

function toFaNumber(value) {
  return String(value).replace(/[0-9]/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

function showScreen(name) {
  if (!screens[name]) return;

  Object.entries(screens).forEach(([screenName, element]) => {
    element.classList.toggle('hidden', screenName !== name);
  });

  state.screen = name;
  window.scrollTo({ top: 0, behavior: state.reduceMotion ? 'auto' : 'smooth' });

  if (name === 'game') {
    window.setTimeout(() => $('#quitGameBtn')?.focus({ preventScroll: true }), 0);
  }
}

function getRecords() {
  const stored = parseStoredJSON(STORAGE_KEYS.records, null);
  if (Array.isArray(stored)) {
    return stored.filter(Number.isFinite).map(Number).sort((a, b) => b - a).slice(0, 3);
  }
  return [...state.records];
}

function saveRecord(score) {
  const previous = getRecords();
  const updated = [...previous, score].sort((a, b) => b - a).slice(0, 3);
  state.records = updated;
  const persisted = writeStorage(STORAGE_KEYS.records, JSON.stringify(updated));
  return { records: updated, persisted };
}

function getGameStats() {
  const stored = parseStoredJSON(STORAGE_KEYS.stats, null);
  if (!stored || typeof stored !== 'object') return { ...state.stats };

  return {
    gamesPlayed: Number.isFinite(stored.gamesPlayed) && stored.gamesPlayed >= 0 ? stored.gamesPlayed : 0,
    totalScore: Number.isFinite(stored.totalScore) && stored.totalScore >= 0 ? stored.totalScore : 0,
    bestScore: Number.isFinite(stored.bestScore) && stored.bestScore >= 0 ? stored.bestScore : 0,
    lastScore: Number.isFinite(stored.lastScore) ? stored.lastScore : null,
    lastPlayedAt: typeof stored.lastPlayedAt === 'string' ? stored.lastPlayedAt : null
  };
}

function updateGameStats(score) {
  const current = getGameStats();
  const updated = {
    gamesPlayed: current.gamesPlayed + 1,
    totalScore: current.totalScore + score,
    bestScore: Math.max(current.bestScore, score),
    lastScore: score,
    lastPlayedAt: new Date().toISOString()
  };

  state.stats = updated;
  const persisted = writeStorage(STORAGE_KEYS.stats, JSON.stringify(updated));
  return persisted;
}

function renderRecords() {
  const records = getRecords();
  const stats = getGameStats();
  state.records = records;
  state.stats = stats;

  const summary = $('#recordsSummary');
  if (summary) {
    const average = stats.gamesPlayed > 0
      ? Math.round(stats.totalScore / stats.gamesPlayed)
      : 0;
    summary.innerHTML = `
      <div class="record-stat"><small>تعداد بازی‌ها</small><strong>${toFaNumber(stats.gamesPlayed)}</strong></div>
      <div class="record-stat"><small>میانگین امتیاز</small><strong>${toFaNumber(average)}</strong></div>
      <div class="record-stat"><small>بهترین امتیاز</small><strong>${toFaNumber(stats.bestScore)}</strong></div>
    `;
  }

  const container = $('#recordsList');
  if (!container) return;

  if (records.length === 0) {
    container.innerHTML = '<div class="empty-records">هنوز رکوردی ثبت نشده است. یک بازی شروع کن!</div>';
    return;
  }

  const labels = ['اول', 'دوم', 'سوم'];
  container.innerHTML = records.map((score, index) => `
    <div class="record-row">
      <span class="record-rank">${index + 1}</span>
      <span>رتبه ${labels[index]}</span>
      <strong>${toFaNumber(score)}</strong>
    </div>
  `).join('');
}

function setValidation(message, tone = 'normal') {
  const element = $('#validationMessage');
  if (!element) return;
  element.textContent = message;
  element.dataset.tone = tone;
}

function setNavigationLocked(locked) {
  const brand = $('#brandHome');
  const quitButton = $('#quitGameBtn');
  const gameTipsButton = $('#gameTipsBtn');
  if (brand) {
    brand.setAttribute('aria-disabled', locked ? 'true' : 'false');
    brand.tabIndex = locked ? -1 : 0;
    brand.classList.toggle('is-disabled', locked);
  }
  if (quitButton) quitButton.disabled = locked;
  if (gameTipsButton) gameTipsButton.disabled = locked;
}

function getAvailableCharacters() {
  if (state.statusT === 0 && state.statusSmallT === 0) return ['T', 't'];
  if (state.statusT === 0) return ['T'];
  if (state.statusSmallT === 0) return ['t'];
  return [];
}

function scrollToMobileTarget(selector) {
  if (!window.matchMedia('(max-width: 640px)').matches) return;
  const target = document.querySelector(selector);
  if (!target) return;
  window.setTimeout(() => {
    target.scrollIntoView({
      behavior: state.reduceMotion ? 'auto' : 'smooth',
      block: 'start'
    });
  }, 100);
}

function setSelectedCharacter(character) {
  if (state.busy || !getAvailableCharacters().includes(character)) return;

  state.selectedCharacter = character;
  renderCharacterControls();
  renderBoard();
  setValidation(
    character === 'T'
      ? 'دزد اصلی انتخاب شد؛ حالا خانه مقصد را انتخاب کن.'
      : 'کمک‌دزد انتخاب شد؛ حالا خانه مقصد را انتخاب کن.',
    'success'
  );
  $('#boardNote').textContent = `مهره ${character === 'T' ? 'دزد اصلی' : 'کمک‌دزد'} انتخاب شد. حالا یکی از خانه‌های خالی با کادر روشن را انتخاب کن.`;
  updateTurnGuide();
  scrollToMobileTarget('.board-panel');
}

function updateTurnGuide() {
  const title = $('#turnGuideTitle');
  const description = $('#turnGuideDescription');
  const instruction = $('#boardInstruction');
  const steps = $$('.turn-steps [data-turn-step]');
  if (!title || !description) return;

  let activeStep = 1;
  if (state.busy) {
    activeStep = 3;
    title.textContent = state.gameEnded ? 'بازی به پایان رسید' : state.detectivePreviewActive ? '۳. مقصد کارآگاه مشخص شد' : '۳. کارآگاه در حال حرکت است';
    description.textContent = state.gameEnded
      ? 'نتیجه این دور ثبت شد. می‌توانی دوباره بازی کنی یا به منو برگردی.'
      : state.detectivePreviewActive
        ? `کارآگاه خانه ${toFaNumber(state.detectiveTargetHouse)} را انتخاب کرده است؛ کمی بعد به سمت آن حرکت می‌کند.`
        : 'حرکت کارآگاه را تماشا کن؛ بعد از آن نوبت بعدی تو شروع می‌شود.';
    if (instruction) instruction.textContent = state.detectivePreviewActive ? 'مقصد کارآگاه پیش از حرکت روی نقشه مشخص شده است.' : 'در حال اجرای حرکت خودکار کارآگاه…';
  } else if (state.selectedCharacter) {
    activeStep = 2;
    title.textContent = '۲. خانه مقصد را انتخاب کن';
    description.textContent = `مهره ${state.selectedCharacter === 'T' ? 'دزد اصلی' : 'کمک‌دزد'} انتخاب شده؛ یکی از خانه‌های خالی را بزن.`;
    if (instruction) instruction.textContent = 'خانه‌های خالی با کادر روشن مشخص شده‌اند؛ یکی را انتخاب کن.';
  } else {
    title.textContent = '۱. مهره را انتخاب کن';
    description.textContent = 'یکی از دو مهره دزد را برای حرکت انتخاب کن. خانه‌های اشغال‌شده قابل انتخاب نیستند.';
    if (instruction) instruction.textContent = 'بعد از انتخاب مهره، یکی از خانه‌های خالی را برای حرکت بزن.';
  }

  steps.forEach(step => {
    const stepNumber = Number(step.dataset.turnStep);
    step.classList.toggle('is-current', stepNumber === activeStep);
    step.classList.toggle('is-complete', stepNumber < activeStep);
    if (stepNumber === activeStep) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
}

function renderCharacterControls() {
  const allowed = getAvailableCharacters();

  ['T', 't'].forEach(character => {
    const button = character === 'T' ? $('#selectT') : $('#selectt');
    if (!button) return;
    button.disabled = state.busy || !allowed.includes(character);
    button.setAttribute('aria-pressed', String(state.selectedCharacter === character));
    button.classList.toggle('selected', state.selectedCharacter === character);
    button.classList.toggle('is-unavailable', !allowed.includes(character));
  });

  const turnStatus = $('#turnStatus');
  if (turnStatus) {
    if (state.busy) turnStatus.textContent = state.detectivePreviewActive ? 'مقصد کارآگاه مشخص شد' : 'در حال اجرای نوبت';
    else if (!allowed.length) turnStatus.textContent = 'حرکت خودکار';
    else if (allowed.length === 1) turnStatus.textContent = `فقط مهره ${allowed[0]}`;
    else turnStatus.textContent = state.selectedCharacter ? 'انتخاب مقصد' : 'انتخاب مهره';
  }

  const skipButton = $('#skipTurnBtn');
  if (skipButton) skipButton.disabled = state.busy || allowed.length === 0;
  updateTurnGuide();
}

function houseName(id) {
  return `خانه ${toFaNumber(id)}`;
}

function isOccupied(id) {
  return Object.values(state.positions).includes(id);
}

function renderBoard() {
  const board = $('#boardGrid');
  if (!board) return;

  const html = Core.HOUSES.map(id => {
    const occupants = ['T', 't', 'D'].filter(piece => state.positions[piece] === id);
    const chanceIndex = state.detectiveOptions.indexOf(id);
    const chance = chanceIndex >= 0 ? state.detectiveProbabilities[chanceIndex] : null;
    const occupied = occupants.length > 0;
    const isDetectiveTarget = state.detectivePreviewActive && state.detectiveTargetHouse === id;
    const canInteract = state.screen === 'game' && !state.busy && !occupied;
    const canChoose = canInteract && Boolean(state.selectedCharacter);
    const needsCharacter = canInteract && !state.selectedCharacter;
    const occupantLabel = occupants.map(piece => piece === 'T' ? 'دزد اصلی' : piece === 't' ? 'کمک‌دزد' : 'کارآگاه').join(' و ');
    const actionLabel = occupied
      ? `اشغال‌شده توسط ${occupantLabel}`
      : state.selectedCharacter
        ? 'برای انتخاب به‌عنوان مقصد کلیک کن'
        : 'ابتدا یکی از مهره‌ها را انتخاب کن';

    const pieceHtml = occupants.map(piece => `
      <span class="piece piece-${piece}" title="${piece === 'T' ? 'دزد اصلی' : piece === 't' ? 'کمک‌دزد' : 'کارآگاه'}">${piece}</span>
    `).join('');

    return `
      <button type="button"
        class="house ${canChoose ? 'available' : ''} ${needsCharacter ? 'needs-character' : ''} ${occupied ? 'occupied' : ''} ${chance !== null ? 'chance-house' : ''} ${isDetectiveTarget ? 'detective-target' : ''}"
        data-house="${id}"
        ${canInteract ? '' : 'disabled'}
        aria-label="${houseName(id)}، ${actionLabel}${chance !== null ? `، احتمال حرکت کارآگاه ${chance} درصد` : ''}${isDetectiveTarget ? '، مقصد انتخاب‌شده کارآگاه' : ''}"
        aria-describedby="boardNote"
      >
        <span class="house-number">${toFaNumber(id)}</span>
        ${chance !== null ? `<span class="chance-badge">${toFaNumber(chance)}٪</span>` : ''}
        ${isDetectiveTarget ? '<span class="detective-target-badge"><i aria-hidden="true">⌖</i> مقصد کارآگاه</span>' : ''}
        <span class="pieces">${pieceHtml}</span>
        <span class="house-name">${houseName(id)}</span>
      </button>
    `;
  }).join('');

  const streetEye = state.eyeEnabled ? `
    <div class="street-eye-indicator parity-${state.eyeParity === 0 ? 'even' : 'odd'}" aria-hidden="true">
      <span class="street-eye-symbol"><svg viewBox="0 0 32 22" focusable="false"><path d="M2 11C5.5 5.6 10.2 2.8 16 2.8S26.5 5.6 30 11c-3.5 5.4-8.2 8.2-14 8.2S5.5 16.4 2 11Z"/><circle cx="16" cy="11" r="4.1"/><circle class="eye-pupil" cx="16" cy="11" r="1.8"/></svg></span>
      <span>چشم · ${state.eyeParity === 0 ? 'زوج' : 'فرد'}</span>
    </div>` : '';

  board.innerHTML = `${html}
    <div class="road-lane" aria-label="خیابان اصلی"><span>خیابان</span></div>
    ${streetEye}
    <div class="piece-overlay-layer" aria-hidden="true"></div>
  `;

  board.querySelectorAll('.house:not(:disabled)').forEach(button => {
    button.addEventListener('click', () => onHouseClick(Number(button.dataset.house)));
  });
}

function getHouseCenter(house, boardRect) {
  const rect = house.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 - boardRect.left,
    y: rect.top + rect.height / 2 - boardRect.top
  };
}

function getStreetPoint(targetHouse, boardRect) {
  const board = $('#boardGrid');
  const lane = board?.querySelector('.road-lane');
  const houseId = Number(targetHouse.dataset.house);
  const houseCenter = getHouseCenter(targetHouse, boardRect);

  if (!lane) {
    return { x: houseCenter.x, y: boardRect.height / 2 };
  }

  const laneRect = lane.getBoundingClientRect();
  if (laneRect.height < 1) {
    return { x: houseCenter.x, y: boardRect.height / 2 };
  }

  const sideOffset = laneRect.height * 0.22 * (houseId % 2 === 0 ? -1 : 1);
  return {
    x: houseCenter.x,
    y: laneRect.top + laneRect.height / 2 + sideOffset - boardRect.top
  };
}

async function animatePieceMove(character, fromHouse, toHouse) {
  if (!character || fromHouse === null || toHouse === null || fromHouse === toHouse) return;

  const board = $('#boardGrid');
  const overlay = board?.querySelector('.piece-overlay-layer');
  const sourceHouse = board?.querySelector(`[data-house="${fromHouse}"]`);
  const targetHouse = board?.querySelector(`[data-house="${toHouse}"]`);
  const sourcePiece = sourceHouse?.querySelector(`.piece-${character}`);
  const targetAnchor = targetHouse?.querySelector('.pieces');

  if (!board || !overlay || !sourcePiece || !targetHouse || !targetAnchor) {
    console.warn('Movement animation could not find its source or target.');
    return;
  }

  const boardRect = board.getBoundingClientRect();
  const sourceRect = sourcePiece.getBoundingClientRect();
  const tokenWidth = sourceRect.width || 29;
  const tokenHeight = sourceRect.height || 29;

  // A hidden placeholder reserves the exact final slot, including when D catches T
  // or the detective enters a house that already contains the helper thief.
  const placeholder = document.createElement('span');
  placeholder.className = 'piece-placeholder';
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.style.width = `${tokenWidth}px`;
  placeholder.style.height = `${tokenHeight}px`;
  targetAnchor.append(placeholder);

  const placeholderRect = placeholder.getBoundingClientRect();
  const start = {
    x: sourceRect.left + sourceRect.width / 2 - boardRect.left,
    y: sourceRect.top + sourceRect.height / 2 - boardRect.top
  };
  const destination = {
    x: placeholderRect.left + placeholderRect.width / 2 - boardRect.left,
    y: placeholderRect.top + placeholderRect.height / 2 - boardRect.top
  };
  const street = getStreetPoint(targetHouse, boardRect);

  // L-shaped route: vertical from source, horizontal along the street,
  // vertical into the destination. The route itself is never rendered.
  const points = [
    start,
    { x: start.x, y: street.y },
    { x: street.x, y: street.y },
    destination
  ];

  const compactPoints = points.filter((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    return Math.hypot(point.x - previous.x, point.y - previous.y) > 0.5;
  });

  if (compactPoints.length < 2) {
    placeholder.remove();
    return;
  }

  const token = document.createElement('span');
  token.className = `piece piece-${character} movement-token`;
  token.textContent = character;
  token.style.width = `${tokenWidth}px`;
  token.style.height = `${tokenHeight}px`;
  token.style.transform = `translate3d(${start.x - tokenWidth / 2}px, ${start.y - tokenHeight / 2}px, 0)`;
  overlay.append(token);
  sourcePiece.classList.add('piece-in-transit');

  const segmentLengths = [];
  let totalLength = 0;
  for (let index = 1; index < compactPoints.length; index += 1) {
    const previous = compactPoints[index - 1];
    const current = compactPoints[index];
    const length = Math.hypot(current.x - previous.x, current.y - previous.y);
    segmentLengths.push(length);
    totalLength += length;
  }

  let travelled = 0;
  const keyframes = compactPoints.map((point, index) => {
    if (index > 0) travelled += segmentLengths[index - 1];
    return {
      transform: `translate3d(${point.x - tokenWidth / 2}px, ${point.y - tokenHeight / 2}px, 0)`,
      offset: totalLength > 0 ? travelled / totalLength : index / (compactPoints.length - 1)
    };
  });

  const configuredDuration = ANIMATION_DURATIONS[state.animationSpeed] || ANIMATION_DURATIONS.normal;
  const duration = state.reduceMotion ? Math.min(350, configuredDuration) : configuredDuration;
  playTone(character === 'D' ? 350 : character === 'T' ? 620 : 500, 0.08);

  try {
    await nextFrame();
    if (typeof token.animate === 'function') {
      const animation = token.animate(keyframes, {
        duration,
        easing: 'linear',
        fill: 'forwards'
      });
      await animation.finished;
    } else {
      for (let index = 1; index < compactPoints.length; index += 1) {
        const segmentDuration = totalLength > 0
          ? duration * segmentLengths[index - 1] / totalLength
          : duration / (compactPoints.length - 1);
        const point = compactPoints[index];
        token.style.setProperty('transition', `transform ${segmentDuration}ms linear`, 'important');
        token.style.transform = `translate3d(${point.x - tokenWidth / 2}px, ${point.y - tokenHeight / 2}px, 0)`;
        await wait(segmentDuration);
      }
    }
  } catch (error) {
    // If the browser cancels an animation, the game can still safely complete the turn.
    console.warn('Movement animation was interrupted:', error);
  } finally {
    sourcePiece.classList.remove('piece-in-transit');
    placeholder.remove();
    token.remove();
  }
}

function createProbabilityRow(house) {
  const row = document.createElement('div');
  row.className = 'probability-item';
  row.dataset.house = String(house);
  row.innerHTML = `
    <span class="probability-house"></span>
    <div class="probability-bar" role="meter" aria-label="احتمال حرکت کارآگاه" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="probability-fill"></div></div>
    <strong class="probability-percent"></strong>
  `;
  return row;
}

function shouldReduceMotion() {
  return state.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animateProbabilityNumber(element, from, to, duration = 900) {
  if (element._probabilityFrame) {
    window.cancelAnimationFrame(element._probabilityFrame);
    element._probabilityFrame = 0;
  }

  if (shouldReduceMotion()) {
    element.textContent = `${toFaNumber(to)}٪`;
    return;
  }

  const startAt = performance.now();
  const frame = now => {
    const progress = Math.min(1, (now - startAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(from + (to - from) * eased);
    element.textContent = `${toFaNumber(value)}٪`;
    if (progress < 1) {
      element._probabilityFrame = window.requestAnimationFrame(frame);
    } else {
      element._probabilityFrame = 0;
      element.textContent = `${toFaNumber(to)}٪`;
    }
  };
  element._probabilityFrame = window.requestAnimationFrame(frame);
}

let probabilityBannerTimer = 0;
function showProbabilityUpdateBanner() {
  const banner = $('#probabilityUpdateBanner');
  if (!banner) return;

  banner.textContent = state.eyeEffect === 1
    ? 'چشم حرکت دزد را تشخیص داد؛ احتمال هدف کارآگاه به ۱۰۰٪ رسید.'
    : 'چشم مسیرها را بازبینی کرد؛ احتمال‌های جدید در حال اعمال هستند.';
  banner.hidden = false;
  banner.classList.remove('is-visible');
  if (!shouldReduceMotion()) void banner.offsetWidth;
  banner.classList.toggle('is-no-motion', shouldReduceMotion());
  banner.classList.add('is-visible');

  window.clearTimeout(probabilityBannerTimer);
  probabilityBannerTimer = window.setTimeout(() => {
    banner.classList.remove('is-visible');
    window.setTimeout(() => { banner.hidden = true; }, shouldReduceMotion() ? 0 : 260);
  }, 1900);
}

function renderProbabilities() {
  const container = $('#probabilityList');
  if (!container) return;

  const animateUpdate = state.probabilityAnimationPending;
  state.probabilityAnimationPending = false;

  if (state.detectiveOptions.length === 0) {
    container.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'muted-text';
    empty.textContent = 'در حال محاسبه احتمال‌ها…';
    container.appendChild(empty);
  } else {
    const activeHouses = new Set(state.detectiveOptions);
    const currentRows = new Map(
      [...container.querySelectorAll('.probability-item[data-house]')]
        .map(row => [Number(row.dataset.house), row])
    );

    state.detectiveOptions.forEach((house, index) => {
      let row = currentRows.get(house);
      const isNew = !row;
      if (!row) row = createProbabilityRow(house);

      if (row._removeTimer) {
        window.clearTimeout(row._removeTimer);
        row._removeTimer = 0;
      }
      row.classList.remove('is-removing');
      row.removeAttribute('aria-hidden');
      row.querySelector('.probability-removed-label')?.remove();

      const value = Number(state.detectiveProbabilities[index] ?? 0);
      const oldValue = row.dataset.value === undefined ? 0 : Number(row.dataset.value);
      const houseLabel = row.querySelector('.probability-house');
      const bar = row.querySelector('.probability-bar');
      const fill = row.querySelector('.probability-fill');
      const percent = row.querySelector('.probability-percent');

      houseLabel.textContent = `خانه ${toFaNumber(house)}`;
      row.setAttribute('aria-label', `خانه ${house}: احتمال ${value} درصد`);
      bar.setAttribute('aria-valuenow', String(value));
      row.dataset.value = String(value);

      if (isNew) {
        container.appendChild(row);
        if (animateUpdate && !shouldReduceMotion()) {
          row.classList.add('is-entering');
          fill.style.width = '0%';
          window.requestAnimationFrame(() => {
            fill.style.width = `${value}%`;
            row.classList.add('is-entered');
          });
          window.setTimeout(() => row.classList.remove('is-entering', 'is-entered'), 1050);
        } else {
          fill.style.width = `${value}%`;
        }
        percent.textContent = `${toFaNumber(value)}٪`;
      } else {
        if (animateUpdate && oldValue !== value && !shouldReduceMotion()) {
          row.classList.remove('is-updating');
          if (!state.reduceMotion) void row.offsetWidth;
          row.classList.add('is-updating');
          percent.dataset.delta = `${value > oldValue ? '+' : ''}${toFaNumber(value - oldValue)}٪`;
          animateProbabilityNumber(percent, oldValue, value);
          window.setTimeout(() => {
            row.classList.remove('is-updating');
            delete percent.dataset.delta;
          }, 1250);
        } else {
          percent.textContent = `${toFaNumber(value)}٪`;
        }
        fill.style.width = `${value}%`;
        container.appendChild(row);
      }
    });

    // Keep removed candidates visible briefly so the player can see which options the eye eliminated.
    currentRows.forEach((row, house) => {
      if (activeHouses.has(house)) return;
      if (!animateUpdate || shouldReduceMotion()) {
        if (row._probabilityFrame) window.cancelAnimationFrame(row._probabilityFrame);
        row.remove();
        return;
      }
      if (row.classList.contains('is-removing')) return;

      row.classList.add('is-removing');
      row.setAttribute('aria-hidden', 'true');
      row.querySelector('.probability-fill').style.width = '0%';
      row.querySelector('.probability-percent').textContent = '—';
      row.querySelector('.probability-bar').setAttribute('aria-valuenow', '0');
      row.setAttribute('aria-label', `خانه ${house} به‌وسیله چشم از گزینه‌ها حذف شد`);
      const changeRow = document.createElement('span');
      changeRow.className = 'probability-removed-label';
      changeRow.textContent = 'حذف‌شده';
      row.appendChild(changeRow);
      container.appendChild(row);
      row._removeTimer = window.setTimeout(() => {
        row.remove();
        row._removeTimer = 0;
      }, 900);
    });

    if (animateUpdate) showProbabilityUpdateBanner();
  }

  const context = $('#probabilityContext');
  if (context) {
    context.textContent = state.eyeEffectMessage || (
      state.eyeEnabled
        ? `چشم خانه‌های ${state.eyeParity === 0 ? 'زوج' : 'فرد'} را زیر نظر دارد. بعد از انتخاب مقصد، اثر آن روی احتمال‌های کارآگاه مشخص می‌شود.`
        : 'این‌ها احتمال‌های پایه کارآگاه هستند. چشم ممکن است در نوبت‌های بعد ظاهر شود و آن‌ها را تغییر دهد.'
    );
  }
}

function renderDetectivePreview() {
  const preview = $('#detectivePreview');
  if (!preview) return;

  if (!state.detectivePreviewActive || state.detectiveTargetHouse === null) {
    preview.classList.add('hidden');
    return;
  }

  preview.classList.remove('hidden');
  $('#detectivePreviewHouse').textContent = `خانه ${toFaNumber(state.detectiveTargetHouse)}`;
  $('#detectivePreviewProbability').textContent = `احتمال انتخاب این خانه: ${toFaNumber(state.detectiveTargetProbability ?? 100)}٪`;
  preview.classList.toggle('is-certain', state.detectiveTargetProbability === 100);
}

function renderEyeStatus() {
  const element = $('#eyeStatus');
  if (!element) return;

  if (state.eyeEnabled) {
    const parityText = state.eyeParity === 0 ? 'زوج' : 'فرد';
    element.classList.add('active');
    element.innerHTML = `
      <span class="eye-status-icon" aria-hidden="true">◉</span>
      <span class="eye-status-copy"><strong>چشم فعال است</strong><span>${state.eyeEffectMessage || `خانه‌های ${parityText} زیر نظر هستند. پس از انتخاب مقصد، احتمال‌های کارآگاه براساس حرکت تو اصلاح می‌شوند.`}</span></span>
      <span class="eye-active-pill">فعال</span>
    `;
    return;
  }

  element.classList.remove('active');
  const chance = Math.min(100, state.eyeProbability);
  element.innerHTML = `
    <span class="eye-status-icon" aria-hidden="true">◉</span>
    <span class="eye-status-copy"><strong>چشم فعلاً دیده نمی‌شود</strong><span>شانس ظاهرشدن در نوبت بعد: ${toFaNumber(chance)}٪</span><span class="eye-chance-track" role="meter" aria-label="شانس ظاهرشدن چشم در نوبت بعد" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${chance}"><i style="width:${chance}%"></i></span></span>
  `;
}

function renderGame() {
  document.documentElement.classList.toggle('reduce-motion-ui', state.reduceMotion);
  $('#scoreValue').textContent = toFaNumber(state.score);
  $('#detectiveHomeValue').textContent = state.positions.D === null ? '—' : toFaNumber(state.positions.D);
  renderCharacterControls();
  renderBoard();
  renderProbabilities();
  renderDetectivePreview();
  renderEyeStatus();
  setNavigationLocked(state.busy);
}

function generateInitialPositions() {
  const picks = Core.fisherYates(Core.HOUSES).slice(0, 3);
  state.positions.T = picks[0];
  state.positions.t = picks[1];
  state.positions.D = picks[2];
}

function generateCandidates() {
  const result = Core.generateCandidates(state.positions);
  state.candidates = result.candidates;
  state.optionCount = result.optionCount;
  state.candidateProbabilities = result.probabilities;
  state.detectiveOptions = [...result.candidates];
  state.detectiveProbabilities = [...result.probabilities];
  state.detectiveDecision = null;
  state.probabilityAnimationPending = false;
  state.eyeEffectMessage = '';
}

function updateEye() {
  const chanceForThisTurn = state.eyeProbability;
  const roll = Core.randomInt(100);
  const parityRoll = roll < chanceForThisTurn ? Core.randomInt(2) : 0;
  const result = Core.resolveEyeTurn(chanceForThisTurn, roll, parityRoll);

  state.eyeCheckedChance = chanceForThisTurn;
  state.eyeEnabled = result.enabled;
  state.eyeParity = result.parity ?? 0;
  state.eyeProbability = result.nextChance;
}

function prepareTurn() {
  generateCandidates();
  updateEye();
  // Each eye observation evaluates one player move only; never leak it to an automatic turn.
  state.eyeEffect = 0;
  state.eyeActionPending = false;
  state.selectedCharacter = null;
  renderGame();
  scrollToMobileTarget('.control-panel');

  if (state.eyeEnabled) {
    setValidation('چشم مراقب خیابان است؛ الگوی زوج/فرد را بررسی کن.', 'success');
  } else {
    setValidation('یک مهره مجاز را انتخاب کن و سپس خانه مقصد را بزن.');
  }

  $('#boardNote').textContent = state.eyeEnabled
    ? `چشم در خیابان ظاهر شده و خانه‌های ${state.eyeParity === 0 ? 'زوج' : 'فرد'} را رصد می‌کند. انتخاب تو می‌تواند احتمال‌های کارآگاه را تغییر دهد.`
    : `چشم فعلاً دیده نمی‌شود؛ شانس ظاهرشدن آن در نوبت بعد ${toFaNumber(state.eyeProbability)}٪ است. ابتدا مهره و مقصدت را انتخاب کن.`;
}

const onboardingSteps = [
  {
    title: 'هدف بازی چیست؟',
    description: 'دزد اصلی را از کارآگاه پنهان نگه دار. هرچه مدت بیشتری دوام بیاوری، امتیاز بیشتری می‌گیری.'
  },
  {
    title: 'چطور حرکت کنم؟',
    description: 'اول دزد اصلی یا کمک‌دزد را انتخاب کن؛ بعد یکی از خانه‌های خالی نقشه را بزن. خانه‌های اشغال‌شده قابل انتخاب نیستند.'
  },
  {
    title: 'چشم مراقب را فراموش نکن',
    description: 'بعد از حرکت تو، کارآگاه از روی احتمال‌ها تصمیم می‌گیرد. چشم خیابان گاهی خانه‌های زوج یا فرد را زیر نظر می‌گیرد و می‌تواند این احتمال‌ها را تغییر دهد؛ به نشان چشم و درصدهای به‌روزشده دقت کن.'
  }
];
let onboardingIndex = 0;
let infoReturnFocus = '#topHelpBtn';

function renderOnboardingStep() {
  const step = onboardingSteps[onboardingIndex];
  $('#onboardingCounter').textContent = `${toFaNumber(onboardingIndex + 1)} از ${toFaNumber(onboardingSteps.length)}`;
  $('#onboardingTitle').textContent = step.title;
  $('#onboardingDescription').textContent = step.description;
  $('#onboardingNextBtn').textContent = onboardingIndex === onboardingSteps.length - 1 ? 'شروع بازی' : 'بعدی';
  $$('.onboarding-progress span').forEach((dot, index) => {
    dot.classList.toggle('is-active', index === onboardingIndex);
    dot.classList.toggle('is-complete', index < onboardingIndex);
  });
}

function showOnboarding() {
  onboardingIndex = 0;
  renderOnboardingStep();
  $('#onboardingModal').classList.remove('hidden');
  window.setTimeout(() => $('#onboardingNextBtn')?.focus({ preventScroll: true }), 0);
}

function finishOnboarding() {
  writeStorage(STORAGE_KEYS.onboarding, 'true');
  $('#onboardingModal').classList.add('hidden');
  beginGameNow();
}

function beginGameNow() {
  state.score = 0;
  state.statusT = 0;
  state.statusSmallT = 0;
  state.eyeProbability = 0;
  state.eyeCheckedChance = 0;
  state.eyeEnabled = false;
  state.eyeEffect = 0;
  state.eyeEffectMessage = '';
  state.eyeActionPending = false;
  state.detectiveOptions = [];
  state.detectiveProbabilities = [];
  state.detectiveDecision = null;
  state.detectiveTargetHouse = null;
  state.detectiveTargetProbability = null;
  state.detectivePreviewActive = false;
  state.probabilityAnimationPending = false;
  state.busy = false;
  state.gameEnded = false;
  state.selectedCharacter = null;
  state.candidates = [];
  state.candidateProbabilities = [];

  generateInitialPositions();
  showScreen('game');
  prepareTurn();
  playTone(540, 0.07);
}

function startGame() {
  if (state.busy && !state.gameEnded) return;
  if (readStorage(STORAGE_KEYS.onboarding) !== 'true') {
    showOnboarding();
    return;
  }
  beginGameNow();
}

function onHouseClick(house) {
  if (state.busy || state.screen !== 'game') return;
  if (!state.selectedCharacter) {
    setValidation('برای ادامه، اول یکی از دو مهره دزد را انتخاب کن.', 'error');
    $('#boardNote').textContent = 'مرحله اول: دزد اصلی یا کمک‌دزد را از پنل انتخاب مهره انتخاب کن.';
    scrollToMobileTarget('.control-panel');
    return;
  }
  if (isOccupied(house)) {
    setValidation('این خانه اشغال شده است؛ یک خانه خالی انتخاب کن.', 'error');
    return;
  }
  makePlayerMove(state.selectedCharacter, house);
}

function calculatePlayerEyeEffect(destination) {
  // The C++ input value 10 means “skip movement”. It still participates
  // in the parity/eye condition, so the browser version keeps that behavior.
  const selectedValue = destination === null ? 10 : destination;
  return Core.calculateEyeEffect(
    selectedValue,
    state.positions.T,
    state.eyeEnabled,
    state.eyeParity
  );
}

function applyPlayerState(character) {
  const next = Core.advancePlayerStatus(
    state.statusT,
    state.statusSmallT,
    character
  );
  state.statusT = next.statusT;
  state.statusSmallT = next.statusSmallT;
}

function chooseDetectiveDestination() {
  const previousOptions = [...state.detectiveOptions];
  const previousProbabilities = [...state.detectiveProbabilities];
  const eyeWasAppliedToPlayerMove = state.eyeEnabled && state.eyeActionPending && state.eyeEffect > 0;
  const decision = Core.getDetectiveDecision({
    candidates: state.candidates,
    eyeEffect: state.eyeEffect,
    eyeParity: state.eyeParity,
    currentThiefHouse: state.positions.T
  });

  state.detectiveDecision = decision;
  state.detectiveOptions = [...decision.options];
  state.detectiveProbabilities = [...decision.probabilities];
  state.probabilityAnimationPending = eyeWasAppliedToPlayerMove && (
    previousOptions.length !== decision.options.length ||
    previousOptions.some((house, index) => house !== decision.options[index]) ||
    previousProbabilities.some((value, index) => value !== decision.probabilities[index])
  );

  if (state.eyeEnabled && state.eyeEffect === 1) {
    state.eyeEffectMessage = `چشم حرکت را تشخیص داد؛ کارآگاه مستقیماً خانه دزد اصلی (${toFaNumber(state.positions.T)}) را هدف می‌گیرد. احتمال این مقصد ۱۰۰٪ است.`;
  } else if (state.eyeEnabled && state.eyeEffect === 2) {
    const removedCount = Math.max(0, state.candidates.length - decision.options.length);
    state.eyeEffectMessage = `چشم جای قبلی دزد اصلی را تشخیص داد؛ ${toFaNumber(removedCount)} گزینه هم‌الگوی ${state.eyeParity === 0 ? 'زوج' : 'فرد'} کنار گذاشته شد و احتمال گزینه‌های باقی‌مانده دوباره محاسبه شد.`;
  } else if (state.eyeEnabled && !state.eyeActionPending) {
    state.eyeEffectMessage = 'چشم فعال است، اما این نوبت حرکت تازه‌ای از دزدها انجام نشده؛ کارآگاه از احتمال‌های پایه استفاده می‌کند.';
  } else if (state.eyeEnabled) {
    state.eyeEffectMessage = `چشم فعال بود، اما حرکت انتخابی با الگوی ${state.eyeParity === 0 ? 'زوج' : 'فرد'} آن تطبیق نداشت؛ احتمال‌های پایه حفظ شدند.`;
  } else {
    state.eyeEffectMessage = 'چشم فعال نیست؛ کارآگاه براساس احتمال‌های پایه و موقعیت مهره‌ها تصمیم می‌گیرد.';
  }

  state.eyeActionPending = false;
  return decision;
}

function playTone(frequency = 440, duration = 0.06) {
  if (!state.soundEnabled) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
    oscillator.onended = () => context.close();
  } catch (error) {
    // Audio is optional and must never interrupt a game turn.
    console.warn('Audio effect unavailable:', error);
  }
}

async function detectiveMove() {
  const origin = state.positions.D;
  const decision = chooseDetectiveDestination();
  const destination = decision.destination;
  const destinationIndex = decision.options.indexOf(destination);
  const destinationProbability = destinationIndex >= 0
    ? decision.probabilities[destinationIndex]
    : 100;

  // Reveal the RNG result before the detective token starts moving.
  state.detectiveTargetHouse = destination;
  state.detectiveTargetProbability = destinationProbability;
  state.detectivePreviewActive = true;
  renderGame();

  const eyePrefix = state.eyeEnabled && state.eyeEffectMessage
    ? `${state.eyeEffectMessage} `
    : '';
  $('#boardNote').textContent = `${eyePrefix}کارآگاه خانه ${toFaNumber(destination)} را انتخاب کرد؛ این مقصد پیش از شروع حرکت مشخص شده است.`;
  setValidation(`مقصد کارآگاه مشخص شد: خانه ${toFaNumber(destination)} با احتمال ${toFaNumber(destinationProbability)}٪.`, 'success');
  playTone(680, 0.09);

  const revealDelay = shouldReduceMotion()
    ? 280
    : (DETECTIVE_REVEAL_DELAYS[state.animationSpeed] ?? DETECTIVE_REVEAL_DELAYS.normal);
  await wait(revealDelay);

  $('#boardNote').textContent = `اکنون کارآگاه از خانه ${toFaNumber(origin)} به سمت مقصد مشخص‌شده، خانه ${toFaNumber(destination)}، حرکت می‌کند…`;
  setValidation(`حرکت کارآگاه به خانه ${toFaNumber(destination)} آغاز شد.`, 'normal');
  await animatePieceMove('D', origin, destination);

  state.positions.D = destination;
  state.score += 1;
  state.detectivePreviewActive = false;
  state.detectiveTargetHouse = null;
  state.detectiveTargetProbability = null;
  renderGame();
}

function endGame() {
  if (state.gameEnded) return;

  state.gameEnded = true;
  state.busy = true;
  renderGame();

  const previousRecords = getRecords();
  const newRecord = state.score > 0 && (
    previousRecords.length < 3 ||
    state.score > previousRecords[previousRecords.length - 1]
  );

  const recordResult = saveRecord(state.score);
  const statsPersisted = updateGameStats(state.score);

  const finalStats = getGameStats();
  $('#finalScoreValue').textContent = toFaNumber(state.score);
  $('#finalTurnsValue').textContent = toFaNumber(state.score);
  $('#finalBestScoreValue').textContent = toFaNumber(finalStats.bestScore);
  $('#finalGamesValue').textContent = toFaNumber(finalStats.gamesPlayed);
  $('#recordMessage').textContent = newRecord
    ? 'تبریک! این امتیاز وارد سه رکورد برتر شد.'
    : 'این بار رکورد جدیدی ثبت نشد؛ با یک راهبرد تازه دوباره تلاش کن.';

  const persistenceNote = !recordResult.persisted || !statsPersisted
    ? ' ذخیره‌سازی مرورگر در دسترس نبود؛ نتیجه فقط تا زمان باز بودن این صفحه نگه داشته می‌شود.'
    : '';
  $('#recordMessage').textContent += persistenceNote;

  $('#gameOverModal').classList.remove('hidden');
  window.setTimeout(() => $('#playAgainBtn')?.focus({ preventScroll: true }), 0);
  playTone(220, 0.32);
}

async function makePlayerMove(character, destination) {
  if (state.busy || state.gameEnded) return;

  state.busy = true;
  state.eyeEffect = calculatePlayerEyeEffect(destination);
  state.eyeActionPending = true;
  state.selectedCharacter = null;
  renderGame();

  try {
    if (character && destination !== null) {
      const origin = state.positions[character];
      $('#boardNote').textContent = `مهره ${character} از خانه ${origin} حرکت می‌کند و به خانه ${destination} می‌رود…`;
      setValidation(`حرکت مهره ${character} در حال انجام است…`, 'success');

      await animatePieceMove(character, origin, destination);
      state.positions[character] = destination;
      applyPlayerState(character);
    } else {
      $('#boardNote').textContent = 'حرکت شما رد شد؛ کارآگاه نوبت خود را انجام می‌دهد…';
      setValidation('حرکت رد شد؛ نوبت کارآگاه است.', 'normal');
    }

    state.latestMove = character && destination !== null ? `${character} → ${destination}` : 'skip';
    renderGame();

    await wait(180);
    await detectiveMove();

    if (Core.isGameOver(state.positions.T, state.positions.D)) {
      endGame();
      return;
    }

    // This is the next C++ loop's Neighbor()/eye() phase.
    prepareTurn();

    if (state.statusT !== 0 && state.statusSmallT !== 0) {
      await wait(TURN_PAUSES[state.animationSpeed] ?? TURN_PAUSES.normal);
      const next = Core.advanceAutomaticStatus(state.statusT, state.statusSmallT);
      state.statusT = next.statusT;
      state.statusSmallT = next.statusSmallT;
      renderGame();

      setValidation('نوبت خودکار: کارآگاه یک حرکت دیگر انجام می‌دهد.');
      $('#boardNote').textContent = 'کارآگاه یک حرکت دیگر انجام می‌دهد…';
      await detectiveMove();

      if (Core.isGameOver(state.positions.T, state.positions.D)) {
        endGame();
        return;
      }

      prepareTurn();
    }
  } catch (error) {
    console.error('A game turn failed:', error);
    setValidation('در اجرای این نوبت مشکلی پیش آمد. دوباره تلاش کن.', 'error');
    $('#boardNote').textContent = 'بازی از وضعیت فعلی ادامه پیدا می‌کند.';
  } finally {
    if (!state.gameEnded) {
      state.busy = false;
      renderGame();
    }
  }
}

function closeGameOver() {
  $('#gameOverModal').classList.add('hidden');
}

function goToMenu() {
  if (state.busy && !state.gameEnded) return;
  closeGameOver();
  state.busy = false;
  state.gameEnded = false;
  state.selectedCharacter = null;
  setNavigationLocked(false);
  showScreen('menu');
}

function openInfoModal(event) {
  infoReturnFocus = event?.currentTarget?.id ? `#${event.currentTarget.id}` : '#topHelpBtn';
  $('#infoModal').classList.remove('hidden');
  window.setTimeout(() => $('#gotItBtn')?.focus({ preventScroll: true }), 0);
}

function closeInfoModal() {
  $('#infoModal').classList.add('hidden');
  $(infoReturnFocus)?.focus({ preventScroll: true });
}

function openTips(returnTo = 'menu') {
  if (state.busy) return;
  state.returnScreen = returnTo;
  showScreen('tips');
}

function applySettingsToUI() {
  $('#soundToggle').checked = state.soundEnabled;
  $('#speedSelect').value = state.animationSpeed;
  $('#reduceMotionToggle').checked = state.reduceMotion;
}

function persistSettings() {
  const persisted = writeStorage(STORAGE_KEYS.settings, JSON.stringify({
    soundEnabled: state.soundEnabled,
    animationSpeed: state.animationSpeed,
    reduceMotion: state.reduceMotion
  }));

  const note = $('#settingsSaveStatus');
  if (note) {
    note.textContent = persisted
      ? 'تنظیمات به‌صورت خودکار ذخیره می‌شوند.'
      : 'مرورگر اجازه ذخیره تنظیمات را نداد؛ تا پایان این نشست اعمال می‌شوند.';
  }
}

function clearAllRecords() {
  state.records = [];
  state.stats = {
    gamesPlayed: 0,
    totalScore: 0,
    bestScore: 0,
    lastScore: null,
    lastPlayedAt: null
  };
  const recordsRemoved = removeStorage(STORAGE_KEYS.records);
  const statsRemoved = removeStorage(STORAGE_KEYS.stats);
  renderRecords();

  const summary = $('#recordsSummary');
  if (summary && (!recordsRemoved || !statsRemoved)) {
    const warning = document.createElement('p');
    warning.className = 'storage-warning';
    warning.textContent = 'بعضی داده‌ها از حافظه مرورگر پاک نشدند.';
    summary.append(warning);
  }
}

// Navigation and buttons
$('#startGameBtn').addEventListener('click', startGame);
$('#tipsBtn').addEventListener('click', () => openTips('menu'));
$('#gameTipsBtn').addEventListener('click', () => openTips('game'));
$('#recordsBtn').addEventListener('click', () => {
  renderRecords();
  showScreen('records');
});
$('#settingsBtn').addEventListener('click', () => showScreen('settings'));
$('#brandHome').addEventListener('click', event => {
  event.preventDefault();
  if (state.busy && !state.gameEnded) return;
  goToMenu();
});
$('#topHelpBtn').addEventListener('click', openInfoModal);
$('#gameQuickHelpBtn').addEventListener('click', openInfoModal);
$('#onboardingNextBtn').addEventListener('click', () => {
  if (onboardingIndex < onboardingSteps.length - 1) {
    onboardingIndex += 1;
    renderOnboardingStep();
  } else {
    finishOnboarding();
  }
});
$('#onboardingSkipBtn').addEventListener('click', finishOnboarding);
$('#closeInfoModal').addEventListener('click', closeInfoModal);
$('#gotItBtn').addEventListener('click', closeInfoModal);
$('#quitGameBtn').addEventListener('click', () => goToMenu());
$('#playAgainBtn').addEventListener('click', () => {
  closeGameOver();
  startGame();
});
$('#modalMenuBtn').addEventListener('click', goToMenu);

$$('[data-back]').forEach(button => {
  button.addEventListener('click', () => {
    const destination = state.screen === 'tips' ? state.returnScreen : 'menu';
    showScreen(destination || 'menu');
  });
});

$('#selectT').addEventListener('click', () => setSelectedCharacter('T'));
$('#selectt').addEventListener('click', () => setSelectedCharacter('t'));
$('#skipTurnBtn').addEventListener('click', () => {
  if (state.busy || getAvailableCharacters().length === 0) return;
  makePlayerMove(null, null);
});

$('#clearRecordsBtn').addEventListener('click', () => {
  if (window.confirm('همه رکوردها و آمار بازی پاک شوند؟')) clearAllRecords();
});

$('#soundToggle').addEventListener('change', event => {
  state.soundEnabled = event.target.checked;
  persistSettings();
});

$('#speedSelect').addEventListener('change', event => {
  const selected = event.target.value;
  state.animationSpeed = Object.prototype.hasOwnProperty.call(ANIMATION_DURATIONS, selected) ? selected : 'normal';
  persistSettings();
});

$('#reduceMotionToggle').addEventListener('change', event => {
  state.reduceMotion = event.target.checked;
  persistSettings();
});

document.addEventListener('keydown', event => {
  const activeModal = ['#onboardingModal', '#gameOverModal', '#infoModal']
    .map(selector => $(selector))
    .find(modal => modal && !modal.classList.contains('hidden'));

  if (event.key === 'Tab' && activeModal) {
    const focusable = [...activeModal.querySelectorAll(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.hidden);
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    return;
  }

  if (event.key !== 'Escape') return;
  if (!$('#onboardingModal').classList.contains('hidden')) finishOnboarding();
  else if (!$('#infoModal').classList.contains('hidden')) closeInfoModal();
  else if (!$('#gameOverModal').classList.contains('hidden')) goToMenu();
});

// Load the logo and font before dismissing the initial loading screen.
function waitForImage(image) {
  if (!image) return Promise.resolve();
  if (image.complete) return Promise.resolve();
  if (typeof image.decode === 'function') {
    return image.decode().catch(() => undefined);
  }
  return new Promise(resolve => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', resolve, { once: true });
  });
}

function waitForFonts() {
  if (!document.fonts?.ready) return Promise.resolve();
  return Promise.race([
    document.fonts.ready.catch(() => undefined),
    wait(1400)
  ]);
}

async function startInitialLoading() {
  const loader = $('#loadingScreen');
  const appShell = $('.app-shell');
  const progressBar = $('#loadingProgressBar');
  const percentLabel = $('#loadingPercent');
  const statusLabel = $('#loadingStatus');

  if (!loader || !appShell || !progressBar || !percentLabel || !statusLabel) {
    appShell?.classList.remove('app-shell-preload');
    document.body.classList.remove('is-loading');
    return;
  }

  const startedAt = performance.now();
  const logoImages = $$('.loading-logo, .brand-logo');
  const imageTask = Promise.all(logoImages.map(waitForImage));
  const fontsTask = waitForFonts();

  progressBar.style.width = '12%';
  percentLabel.textContent = '۱۲٪';
  statusLabel.textContent = 'در حال بارگذاری تصویر بازی...';

  await imageTask;
  progressBar.style.width = '58%';
  percentLabel.textContent = '۵۸٪';
  statusLabel.textContent = 'تصویر آماده شد؛ در حال آماده‌سازی نوشته‌ها...';

  await fontsTask;
  progressBar.style.width = '88%';
  percentLabel.textContent = '۸۸٪';
  statusLabel.textContent = 'در حال آماده‌سازی محیط بازی...';

  const remaining = Math.max(0, LOADING_MIN_DURATION - (performance.now() - startedAt));
  if (remaining > 0) await wait(remaining);

  progressBar.style.width = '100%';
  percentLabel.textContent = '۱۰۰٪';
  statusLabel.textContent = 'بازی آماده است';
  appShell.classList.remove('app-shell-preload');
  appShell.classList.add('app-shell-ready');
  loader.classList.add('is-leaving');
  document.body.classList.remove('is-loading');

  await wait(LOADING_FADE_DURATION);
  loader.remove();
}

// Initial setup
state.records = getRecords();
state.stats = getGameStats();
applySettingsToUI();
const probabilityDetails = $('#probabilityDetails');
if (probabilityDetails && window.matchMedia('(max-width: 640px)').matches) probabilityDetails.open = false;
showScreen('menu');
startInitialLoading();
