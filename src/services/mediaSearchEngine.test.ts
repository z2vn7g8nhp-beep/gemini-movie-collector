import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatEngineImageUrl,
  prepareUpstreamRequest,
} from './mediaSearchEngine';
import { resolveAssetOrImageUrl } from './apiClient';

test('prepareUpstreamRequest injects origin=* and strips User-Agent in browser mode', () => {
  const wikimediaUrls = [
    'https://zh.wikipedia.org/w/api.php?action=query&format=json&titles=花样年华',
    'https://en.wikipedia.org/w/api.php?action=query&format=json&titles=Inception',
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search',
    'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q165219&format=json',
  ];

  for (const raw of wikimediaUrls) {
    const browserReq = prepareUpstreamRequest(
      raw,
      { headers: { 'User-Agent': 'CineArchive/1.0' } },
      'browser'
    );
    const parsed = new URL(browserReq.url);
    assert.equal(parsed.searchParams.get('origin'), '*');
    assert.equal(browserReq.init.headers, undefined);

    const serverReq = prepareUpstreamRequest(
      raw,
      { headers: { 'User-Agent': 'CineArchive/1.0' } },
      'server'
    );
    assert.equal(serverReq.url, raw);
    assert.deepEqual(serverReq.init.headers, { 'User-Agent': 'CineArchive/1.0' });
  }

  const withAccept = prepareUpstreamRequest(
    'https://zh.wikipedia.org/w/api.php?action=query&format=json',
    { headers: { 'User-Agent': 'CineArchive/1.0', Accept: 'application/json' } },
    'browser'
  );
  assert.deepEqual(withAccept.init.headers, { Accept: 'application/json' });
});

test('formatEngineImageUrl returns direct URLs in browser mode and proxy URLs in server mode', () => {
  const remote = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Test.jpg';
  const proxied = `/api/img-proxy?url=${encodeURIComponent(remote)}`;

  assert.equal(formatEngineImageUrl(remote, 'browser'), remote);
  assert.equal(formatEngineImageUrl(proxied, 'browser'), remote);
  assert.equal(
    formatEngineImageUrl('//upload.wikimedia.org/a.jpg', 'browser'),
    'https://upload.wikimedia.org/a.jpg'
  );
  assert.equal(
    formatEngineImageUrl('/src/assets/images/test.jpg', 'browser'),
    '/src/assets/images/test.jpg'
  );

  assert.equal(formatEngineImageUrl(remote, 'server'), proxied);
  assert.equal(formatEngineImageUrl(proxied, 'server'), proxied);
  assert.equal(
    formatEngineImageUrl('/src/assets/images/test.jpg', 'server'),
    '/src/assets/images/test.jpg'
  );
  assert.equal(formatEngineImageUrl('', 'browser'), undefined);
});

test('resolveAssetOrImageUrl resolves sub-path local assets, unwraps legacy proxy URLs in static mode, and keeps data URLs intact', () => {
  assert.equal(
    resolveAssetOrImageUrl('/src/assets/images/x.jpg', {
      staticMode: true,
      baseUrl: '/gemini-movie-collector/',
    }),
    '/gemini-movie-collector/src/assets/images/x.jpg'
  );

  assert.equal(
    resolveAssetOrImageUrl('/src/assets/images/x.jpg', {
      staticMode: false,
      baseUrl: '/',
    }),
    '/src/assets/images/x.jpg'
  );

  const remote = 'https://lain.bgm.tv/pic/cover/l/test.jpg';
  const proxied = `/api/img-proxy?url=${encodeURIComponent(remote)}`;

  assert.equal(
    resolveAssetOrImageUrl(proxied, {
      staticMode: true,
      baseUrl: '/gemini-movie-collector/',
    }),
    remote
  );

  assert.equal(
    resolveAssetOrImageUrl(remote, {
      staticMode: false,
      baseUrl: '/',
    }),
    proxied
  );

  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(
    resolveAssetOrImageUrl(dataUrl, {
      staticMode: true,
      baseUrl: '/gemini-movie-collector/',
    }),
    dataUrl
  );
});
