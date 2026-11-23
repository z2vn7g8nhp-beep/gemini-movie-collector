import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DARK_THEME_COLOR,
  LIGHT_THEME_COLOR,
  THEME_STORAGE_KEY,
  normalizeThemeMode,
  resolveInitialTheme,
  toggleThemeMode,
} from './theme';

test('normalizeThemeMode accepts only valid light/dark values', () => {
  assert.equal(normalizeThemeMode('light'), 'light');
  assert.equal(normalizeThemeMode('dark'), 'dark');
  assert.equal(normalizeThemeMode('system'), null);
  assert.equal(normalizeThemeMode(''), null);
  assert.equal(normalizeThemeMode(null), null);
  assert.equal(normalizeThemeMode(undefined), null);
  assert.equal(normalizeThemeMode(42), null);
});

test('resolveInitialTheme prioritizes saved preference over system media query', () => {
  assert.equal(resolveInitialTheme('dark', false), 'dark');
  assert.equal(resolveInitialTheme('light', true), 'light');
  assert.equal(resolveInitialTheme(null, true), 'dark');
  assert.equal(resolveInitialTheme(null, false), 'light');
  assert.equal(resolveInitialTheme('invalid', true), 'dark');
  assert.equal(resolveInitialTheme(undefined, false), 'light');
});

test('toggleThemeMode flips cleanly between light and dark', () => {
  assert.equal(toggleThemeMode('light'), 'dark');
  assert.equal(toggleThemeMode('dark'), 'light');
});

test('theme constants remain stable for storage and browser chrome', () => {
  assert.equal(THEME_STORAGE_KEY, 'cinearchive.theme.v1');
  assert.equal(LIGHT_THEME_COLOR, '#F7F5F0');
  assert.equal(DARK_THEME_COLOR, '#141210');
});
