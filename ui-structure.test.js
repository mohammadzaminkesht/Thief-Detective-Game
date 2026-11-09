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
