import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCoverResizeDimensions,
  deduplicateCoverCandidates,
  rankAndFilterCoverCandidates,
  splitSealCharacters,
  unwrapProxyImageUrl,
  validateCustomCoverUrl,
} from './coverPicker';

test('unwrapProxyImageUrl extracts underlying remote URL from proxy route', () => {
  const proxied =
    '/api/img-proxy?url=https%3A%2F%2Flain.bgm.tv%2Fpic%2Fcover%2Fl%2F12%2F34.jpg';
  assert.equal(
    unwrapProxyImageUrl(proxied),
    'https://lain.bgm.tv/pic/cover/l/12/34.jpg'
  );
  assert.equal(
    unwrapProxyImageUrl('https://example.com/a.jpg'),
    'https://example.com/a.jpg'
  );
});

test('deduplicateCoverCandidates removes proxied & protocol duplicates while keeping order', () => {
  const list = deduplicateCoverCandidates([
    {
      id: '1',
      url: '/api/img-proxy?url=https%3A%2F%2Flain.bgm.tv%2Fposter.jpg',
      source: '番组计划',
      caption: '主海报',
    },
    {
      id: '2',
      url: 'http://lain.bgm.tv/poster.jpg/',
      source: '维基百科',
      caption: '重复海报',
    },
    {
      id: '3',
      url: '   ',
      source: '无效',
    },
    {
      id: '4',
      url: '/api/img-proxy?url=https%3A%2F%2Fupload.wikimedia.org%2Fdoom.jpg',
      source: '维基媒体',
      caption: '剧照',
    },
  ]);

  assert.equal(list.length, 2);
  assert.equal(list[0].id, '1');
  assert.equal(list[1].id, '4');
});

test('computeCoverResizeDimensions preserves aspect ratio and never upscales', () => {
  assert.deepEqual(computeCoverResizeDimensions(500, 700, 720, 1080), {
    width: 500,
    height: 700,
  });
  assert.deepEqual(computeCoverResizeDimensions(1440, 2160, 720, 1080), {
    width: 720,
    height: 1080,
  });
  assert.deepEqual(computeCoverResizeDimensions(2000, 1000, 720, 1080), {
    width: 720,
    height: 360,
  });
});

test('validateCustomCoverUrl accepts https, protocol-relative, proxy, and data URLs', () => {
  assert.equal(validateCustomCoverUrl('').ok, false);
  assert.equal(validateCustomCoverUrl('ftp://bad.example/a.jpg').ok, false);
  assert.equal(validateCustomCoverUrl('not a url').ok, false);

  const httpsRes = validateCustomCoverUrl('https://example.com/cover.jpg');
  assert.equal(httpsRes.ok, true);

  const relRes = validateCustomCoverUrl('//example.com/cover.jpg');
  assert.equal(relRes.ok, true);
  if (relRes.ok) {
    assert.equal(relRes.url, 'https://example.com/cover.jpg');
  }

  const dataRes = validateCustomCoverUrl('data:image/jpeg;base64,/9j/4AAQ');
  assert.equal(dataRes.ok, true);
});

test('splitSealCharacters formats 4-char and shorter titles into right-to-left vertical seal layout', () => {
  assert.deepEqual(splitSealCharacters('首件入藏'), {
    rightCol: ['首', '件'],
    leftCol: ['入', '藏'],
  });
  assert.deepEqual(splitSealCharacters('影痴'), {
    rightCol: ['影', '痴'],
    leftCol: ['之', '印'],
  });
  assert.deepEqual(splitSealCharacters('金影印'), {
    rightCol: ['金', '影'],
    leftCol: ['印', '印'],
  });
});

test('rankAndFilterCoverCandidates keeps on-target photos and drops unrelated fuzzy hits', () => {
  const ranked = rankAndFilterCoverCandidates(
    [
      { id: 'fuzzy1', url: 'https://example.com/seiyuu.jpg', source: '番组计划', caption: '小山力也' },
      { id: 'exact1', url: 'https://example.com/rdj1.jpg', source: '维基媒体', caption: 'Robert Downey Jr 2014 Comic Con' },
      { id: 'fuzzy2', url: 'https://example.com/deniro.jpg', source: '番组计划', caption: '罗伯特·德尼罗' },
      { id: 'exact2', url: 'https://example.com/rdj2.jpg', source: '番组计划', caption: '小罗伯特·唐尼' },
    ],
    '小罗伯特·唐尼',
    'Robert Downey Jr.'
  );

  assert.equal(ranked.length, 2);
  assert.deepEqual(
    ranked.map((r) => r.id),
    ['exact1', 'exact2']
  );
});
