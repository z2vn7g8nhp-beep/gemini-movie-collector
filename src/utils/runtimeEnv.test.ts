import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectInitialStaticHint,
  formatCoverUrlForMode,
  getDirectImageFallbackUrl,
  resolveBaseAssetUrl,
  resolveDisplayImageUrl,
} from './runtimeEnv';

test('detectInitialStaticHint detects GitHub Pages host, env flag, and ?static=1 query', () => {
  assert.equal(detectInitialStaticHint({ staticEnvFlag: 'true' }), true);
  assert.equal(detectInitialStaticHint({ staticEnvFlag: true }), true);
  assert.equal(detectInitialStaticHint({ hostname: 'alice.github.io' }), true);
  assert.equal(detectInitialStaticHint({ search: '?static=1' }), true);
  assert.equal(detectInitialStaticHint({ search: '?foo=bar&static=true' }), true);

  assert.equal(detectInitialStaticHint({ hostname: 'localhost', search: '' }), false);
  assert.equal(detectInitialStaticHint({ hostname: '127.0.0.1', staticEnvFlag: 'false' }), false);
});

test('resolveBaseAssetUrl resolves internal assets cleanly under relative and subpath bases', () => {
  assert.equal(
    resolveBaseAssetUrl('/src/assets/images/film.jpg', './'),
    './src/assets/images/film.jpg'
  );
  assert.equal(
    resolveBaseAssetUrl('/src/assets/images/film.jpg', '/cine-archive/'),
    '/cine-archive/src/assets/images/film.jpg'
  );
  assert.equal(
    resolveBaseAssetUrl('./src/assets/images/film.jpg', '/'),
    '/src/assets/images/film.jpg'
  );
  assert.equal(
    resolveBaseAssetUrl('https://example.com/poster.jpg', '/cine-archive/'),
    'https://example.com/poster.jpg'
  );
});

test('resolveDisplayImageUrl unwraps /api/img-proxy in static mode and preserves in server mode', () => {
  const proxied =
    '/api/img-proxy?url=https%3A%2F%2Fupload.wikimedia.org%2Fwikipedia%2Fcommons%2Fa.jpg';

  assert.equal(
    resolveDisplayImageUrl(proxied, 'static', './'),
    'https://upload.wikimedia.org/wikipedia/commons/a.jpg'
  );
  assert.equal(resolveDisplayImageUrl(proxied, 'server', './'), proxied);
  assert.equal(
    resolveDisplayImageUrl('/src/assets/images/test.jpg', 'static', '/my-repo/'),
    '/my-repo/src/assets/images/test.jpg'
  );
  assert.equal(
    resolveDisplayImageUrl('data:image/jpeg;base64,abc', 'static', './'),
    'data:image/jpeg;base64,abc'
  );
});

test('getDirectImageFallbackUrl extracts HTTPS target from proxy routes only', () => {
  assert.equal(
    getDirectImageFallbackUrl(
      '/api/img-proxy?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover.jpg'
    ),
    'https://lain.bgm.tv/pic/cover.jpg'
  );
  assert.equal(getDirectImageFallbackUrl('https://lain.bgm.tv/pic/cover.jpg'), null);
  assert.equal(getDirectImageFallbackUrl('/src/assets/images/test.jpg'), null);
});

test('formatCoverUrlForMode avoids /api/img-proxy when running in static GitHub Pages mode', () => {
  const remote = 'https://lain.bgm.tv/pic/cover.jpg';
  assert.equal(formatCoverUrlForMode(remote, 'static'), remote);
  assert.equal(
    formatCoverUrlForMode(remote, 'server'),
    `/api/img-proxy?url=${encodeURIComponent(remote)}`
  );
  assert.equal(
    formatCoverUrlForMode(
      `/api/img-proxy?url=${encodeURIComponent(remote)}`,
      'static'
    ),
    remote
  );
});
