'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

test('HTML contains unique element IDs', () => {
  assert.equal(new Set(ids).size, ids.length, 'duplicate IDs make UI selectors ambiguous');
});

test('every literal ID selector used by game.js exists in index.html', () => {
  const selectors = [...game.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(match => match[1]);
  const missing = [...new Set(selectors)].filter(id => !ids.includes(id));
  assert.deepEqual(missing, []);
});

test('first-run onboarding and turn guidance have accessible labels and live feedback', () => {
  assert.match(html, /id="onboardingModal"[^>]*role="dialog"/);
  assert.match(html, /id="onboardingTitle"/);
  assert.match(html, /id="turnGuideTitle"/);
  assert.match(html, /id="boardNote"[^>]*aria-live="polite"/);
  assert.match(html, /id="validationMessage"[^>]*aria-live="polite"/);
});

test('probability explanation is available and focus indicators are defined', () => {
  assert.match(html, /id="probabilityTitle">پیش‌بینی حرکت کارآگاه/);
  assert.match(html, /class="probability-explainer"/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion/);
});


test('eye surveillance is visible in the street and its effects are explained', () => {
  assert.match(html, /چشم مراقب خیابان/);
  assert.match(html, /id="eyeStatus"/);
  assert.match(html, /id="probabilityContext"/);
  assert.match(game, /street-eye-indicator/);
  assert.match(game, /چشم حرکت را تشخیص داد/);
  assert.match(styles, /\.street-eye-indicator/);
  assert.match(styles, /eye-chance-track/);
});


test('probability updates keep rows alive for animated recalculation', () => {
  assert.match(html, /id="probabilityUpdateBanner"/);
  assert.match(game, /function animateProbabilityNumber/);
  assert.match(game, /is-removing/);
  assert.match(styles, /probability-row-focus/);
  assert.match(styles, /probability-banner-arrive/);
});

test('detective target is revealed on the board before movement', () => {
  assert.match(html, /id="detectivePreview"/);
  assert.match(html, /id="detectivePreviewHouse"/);
  assert.match(game, /detectivePreviewActive = true/);
  assert.match(game, /await wait\(revealDelay\)/);
  assert.match(game, /detective-target-badge/);
  assert.match(styles, /\.house\.detective-target/);
});


test('probability and detective reveal effects respect reduced-motion settings', () => {
  assert.match(game, /function shouldReduceMotion/);
  assert.match(game, /const revealDelay = shouldReduceMotion/);
  assert.match(styles, /html\.reduce-motion-ui/);
});


test('mobile game no longer asks the player to rotate; it uses a landscape canvas fallback', () => {
  assert.doesNotMatch(html, /orientationPrompt|orientationRetryBtn|گوشی را افقی کن/);
  assert.match(game, /classList\.toggle\('is-mobile-game', mobileGame\)/);
  assert.match(styles, /transform:\s*rotate\(90deg\)/);
  assert.match(styles, /transform-origin:\s*top left/);
});

test('mobile layout does not keep the previous portrait blocker or on-map probability badges', () => {
  assert.doesNotMatch(styles, /body\.is-playing \.app-shell\s*\{\s*pointer-events:\s*none/);
  assert.match(styles, /body\.is-mobile-game \.chance-badge\s*\{\s*display:\s*none !important/);
  assert.match(styles, /body\.is-mobile-game \.probability-update-banner\s*\{\s*display:\s*none !important/);
});

test('mobile landscape mode begins on the first play tap, before first-run onboarding', () => {
  const start = game.indexOf('function startGame()');
  const onboarding = game.indexOf("readStorage(STORAGE_KEYS.onboarding)", start);
  const orientation = game.indexOf('requestLandscapeOrientation()', start);
  assert.ok(orientation >= 0 && orientation < onboarding);
  assert.match(styles, /body\.is-mobile-game #onboardingModal/);
});

test('mobile game requests fullscreen and native landscape orientation when supported', () => {
  assert.match(game, /requestFullscreen/);
  assert.match(game, /orientation\.lock\('landscape'\)/);
  assert.match(game, /releaseLandscapeMode/);
  assert.match(html, /manifest\.webmanifest/);
});

test('mobile layout uses the exact requested 10 percent status and 85/15 map/control split', () => {
  assert.match(styles, /flex:\s*0 0 10%/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*85fr\)\s+minmax\(0,\s*15fr\)/);
  assert.match(styles, /grid-template-areas:\s*"map controls"/);
  assert.match(styles, /overflow:\s*hidden/);
});

test('mobile controls use letter-only pieces and text-only probability values', () => {
  assert.match(styles, /character-option > span:nth-child\(2\)[\s\S]*?display:\s*none/);
  assert.match(styles, /probability-bar[\s\S]*?display:\s*none/);
  assert.match(styles, /probability-item[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(styles, /eye-chance-track[\s\S]*?display:\s*none/);
  assert.match(game, /eye-mobile-summary/);
});

test('mobile app manifest requests landscape launch orientation', () => {
  const manifest = JSON.parse(require('node:fs').readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.orientation, 'landscape');
  assert.equal(manifest.display, 'fullscreen');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
});

test('probability list reopens when a phone rotates into landscape', () => {
  assert.match(game, /orientationchange/);
  assert.match(game, /syncProbabilityDetailsForViewport/);
  assert.match(game, /landscapeViewportQuery/);
});
