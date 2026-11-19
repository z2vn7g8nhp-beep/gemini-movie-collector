import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildScallopedSealPath,
  buildTicketStampPath,
  generateFilmSprocketNotches,
  HOT_FOIL_PALETTES,
} from './visualAssets';

test('generateFilmSprocketNotches returns evenly distributed radial coordinates around center', () => {
  const notches = generateFilmSprocketNotches(16, 40, 50, 50);
  assert.equal(notches.length, 16);
  // First notch at top (12 o'clock)
  assert.equal(notches[0].x, 50);
  assert.equal(notches[0].y, 10);
  // Opposite notch at bottom (6 o'clock)
  assert.equal(notches[8].x, 50);
  assert.equal(notches[8].y, 90);
});

test('buildScallopedSealPath generates a closed smooth quadratic SVG path', () => {
  const path = buildScallopedSealPath(50, 50, 45, 41, 16);
  assert.ok(path.startsWith('M '));
  assert.ok(path.includes(' Q '));
  assert.ok(path.endsWith('Z'));
});

test('buildTicketStampPath generates a closed ticket silhouette with rounded corners and side arcs', () => {
  const path = buildTicketStampPath(6, 6, 88, 88, 12, 5);
  assert.ok(path.startsWith('M '));
  assert.ok(path.includes(' Q '));
  assert.ok(path.includes(' A 5.00 5.00 '));
  assert.ok(path.endsWith('Z'));
});

test('HOT_FOIL_PALETTES defines complete 5-stop metallic foil ramps for every medal tier', () => {
  for (const tier of ['locked', 'bronze', 'silver', 'gold', 'crimson'] as const) {
    const p = HOT_FOIL_PALETTES[tier];
    assert.equal(p.foilStops.length, 5);
    assert.ok(p.paperTop.startsWith('#'));
    assert.ok(p.foilBright.startsWith('#'));
  }
});
