import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem } from '../types/archive';
import {
  buildAccessionMetadataRows,
  buildDossierSectionTabs,
  computeActiveDossierSection,
  computeReadingProgress,
} from './dossierLayout';

const SAMPLE_FILM: ArchiveItem = {
  id: 'arc-1',
  accessionNo: 'CA-001',
  category: 'film',
  title: '花样年华',
  year: '2000',
  region: '中国香港',
  summary: '1962年的香港。',
  notes: '克制而深情。',
  rating: 5,
  status: 'favorite',
  tags: ['港片美学', '2000s'],
  relatedIds: ['arc-2'],
  relatedWorkTitle: '王家卫',
  sourceName: 'IMDb',
  sourceUrl: 'https://www.imdb.com/title/tt0118694/',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

test('buildDossierSectionTabs reflects network counts and unsaved indicator', () => {
  const clean = buildDossierSectionTabs({
    relatedCount: 2,
    tagCount: 3,
    hasUnsavedChanges: false,
  });
  assert.equal(clean.length, 4);
  assert.equal(clean[1].count, 5);
  assert.equal(clean[2].label, '手记与编辑');

  const dirty = buildDossierSectionTabs({
    relatedCount: 0,
    tagCount: 0,
    hasUnsavedChanges: true,
  });
  assert.equal(dirty[1].count, undefined);
  assert.equal(dirty[2].label, '手记 · 未保存');
});

test('computeActiveDossierSection tracks scroll offsets and bottom edge', () => {
  const offsets = {
    overview: 0,
    relations: 480,
    notes: 1120,
    graph: 1700,
  };

  assert.equal(computeActiveDossierSection(0, offsets, 1800), 'overview');
  assert.equal(computeActiveDossierSection(420, offsets, 1800), 'relations');
  assert.equal(computeActiveDossierSection(1080, offsets, 1800), 'notes');
  assert.equal(computeActiveDossierSection(1790, offsets, 1800), 'graph');
});

test('computeReadingProgress clamps safely between 0 and 100', () => {
  assert.equal(computeReadingProgress(0, 1200, 600), 0);
  assert.equal(computeReadingProgress(300, 1200, 600), 50);
  assert.equal(computeReadingProgress(600, 1200, 600), 100);
  assert.equal(computeReadingProgress(900, 1200, 600), 100);
  assert.equal(computeReadingProgress(100, 500, 600), 0);
});

test('buildAccessionMetadataRows produces clean film ledger entries', () => {
  const rows = buildAccessionMetadataRows(SAMPLE_FILM, 2);
  assert.deepEqual(
    rows.map((r) => r.key),
    ['accession', 'origin', 'director', 'watches', 'source']
  );
  assert.equal(rows[0].value, 'CA-001');
  assert.equal(rows[1].value, '2000 · 中国香港');
  assert.equal(rows[2].value, '王家卫');
  assert.equal(rows[3].value, '已看 2 次');
  assert.equal(rows[4].href, 'https://www.imdb.com/title/tt0118694/');
});
