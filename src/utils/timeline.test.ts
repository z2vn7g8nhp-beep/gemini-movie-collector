import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArchiveItem } from '../types/archive';
import { buildTimelineGroups } from './timeline';

function makeItem(overrides: Partial<ArchiveItem>): ArchiveItem {
  return {
    id: overrides.id ?? 'id-1',
    accessionNo: overrides.accessionNo ?? 'CA-001',
    category: overrides.category ?? 'film',
    title: overrides.title ?? '测试条目',
    summary: overrides.summary ?? '',
    notes: overrides.notes ?? '',
    rating: overrides.rating ?? 0,
    status: overrides.status ?? 'watched',
    tags: overrides.tags ?? [],
    relatedIds: overrides.relatedIds ?? [],
    createdAt: overrides.createdAt ?? '2026-11-10T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

test('buildTimelineGroups handles empty collections safely', () => {
  const res = buildTimelineGroups([]);
  assert.equal(res.summary.totalItems, 0);
  assert.equal(res.summary.totalMonths, 0);
  assert.equal(res.summary.firstCollectedDate, null);
  assert.equal(res.allMonths.length, 0);
  assert.equal(res.visibleMonths.length, 0);
});

test('buildTimelineGroups groups multi-month entries in desc and asc chronological order', () => {
  const items = [
    makeItem({
      id: 'oct-1',
      accessionNo: 'CA-001',
      category: 'film',
      title: '沙丘2',
      tags: ['电影', '科幻', '2024'],
      createdAt: '2026-10-05T08:30:00.000Z',
    }),
    makeItem({
      id: 'nov-1',
      accessionNo: 'CA-002',
      category: 'character',
      title: '末日博士',
      tags: ['角色', '漫威'],
      createdAt: '2026-11-12T09:00:00.000Z',
    }),
    makeItem({
      id: 'nov-2',
      accessionNo: 'CA-003',
      category: 'person',
      title: '小罗伯特·唐尼',
      tags: ['演员', '漫威'],
      createdAt: '2026-11-19T14:20:00.000Z',
    }),
  ];

  const descRes = buildTimelineGroups(items, { order: 'desc' });
  assert.equal(descRes.summary.totalItems, 3);
  assert.equal(descRes.summary.totalMonths, 2);
  assert.ok(descRes.summary.journeySpanDays >= 45);
  assert.deepEqual(
    descRes.allMonths.map((m) => m.monthKey),
    ['2026-11', '2026-10']
  );
  assert.deepEqual(
    descRes.visibleMonths[0].items.map((i) => i.id),
    ['nov-2', 'nov-1']
  );
  assert.equal(descRes.visibleMonths[0].personCount, 1);
  assert.equal(descRes.visibleMonths[0].characterCount, 1);
  assert.deepEqual(descRes.visibleMonths[0].topTags, ['漫威']);

  const ascRes = buildTimelineGroups(items, { order: 'asc' });
  assert.deepEqual(
    ascRes.allMonths.map((m) => m.monthKey),
    ['2026-10', '2026-11']
  );
  assert.deepEqual(
    ascRes.visibleMonths[1].items.map((i) => i.id),
    ['nov-1', 'nov-2']
  );
});

test('buildTimelineGroups filters by selected month and category while keeping allMonths intact', () => {
  const items = [
    makeItem({
      id: 'oct-film',
      category: 'film',
      createdAt: '2026-10-05T08:30:00.000Z',
    }),
    makeItem({
      id: 'nov-film',
      category: 'film',
      createdAt: '2026-11-12T09:00:00.000Z',
    }),
    makeItem({
      id: 'nov-person',
      category: 'person',
      createdAt: '2026-11-19T14:20:00.000Z',
    }),
  ];

  const monthOnly = buildTimelineGroups(items, { monthKey: '2026-11' });
  assert.equal(monthOnly.allMonths.length, 2);
  assert.equal(monthOnly.visibleMonths.length, 1);
  assert.equal(monthOnly.visibleMonths[0].monthKey, '2026-11');
  assert.equal(monthOnly.visibleMonths[0].totalCount, 2);

  const monthAndCat = buildTimelineGroups(items, {
    monthKey: '2026-11',
    category: 'film',
  });
  assert.equal(monthAndCat.visibleMonths.length, 1);
  assert.deepEqual(
    monthAndCat.visibleMonths[0].items.map((i) => i.id),
    ['nov-film']
  );
});
