import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_COLLECTION } from '../data/seedCollection';
import {
  buildCollectorRank,
  computeAlbumProgress,
  computeCheckInStreak,
  computeCollectorStamps,
  computeItemCompleteness,
  getRecentCalendarDays,
  pickDailySpotlightItem,
  pickRandomEncounterItem,
  recordCheckIn,
  resolveAlbumItems,
} from './collector';

test('recordCheckIn and computeCheckInStreak track consecutive days and deduplicate same-day check-ins', () => {
  const first = recordCheckIn(['2026-11-16', '2026-11-17'], '2026-11-18');
  assert.equal(first.added, true);
  assert.deepEqual(first.dates, ['2026-11-16', '2026-11-17', '2026-11-18']);

  const duplicate = recordCheckIn(first.dates, '2026-11-18');
  assert.equal(duplicate.added, false);

  const stats = computeCheckInStreak(first.dates, '2026-11-18');
  assert.equal(stats.checkedInToday, true);
  assert.equal(stats.currentStreak, 3);
  assert.equal(stats.longestStreak, 3);
  assert.equal(stats.totalDays, 3);

  // If user checked in yesterday but not today yet, streak stays alive at 2
  const yesterdayStats = computeCheckInStreak(
    ['2026-11-16', '2026-11-17'],
    '2026-11-18'
  );
  assert.equal(yesterdayStats.checkedInToday, false);
  assert.equal(yesterdayStats.currentStreak, 2);

  const cal = getRecentCalendarDays(first.dates, '2026-11-18', 7);
  assert.equal(cal.length, 7);
  assert.equal(cal[6].isToday, true);
  assert.equal(cal[6].checked, true);
  assert.equal(cal[0].checked, false);
});

test('computeItemCompleteness grades standard, curated, and masterpiece archival items accurately', () => {
  const fullItem = SEED_COLLECTION[0]; // has cover, rating 5, quote/notes, 4 tags, relatedIds
  const fullComp = computeItemCompleteness(fullItem);
  assert.equal(fullComp.score, 5);
  assert.equal(fullComp.tier, 'masterpiece');
  assert.equal(fullComp.tierLabel, '典藏');
  assert.equal(fullComp.missingLabels.length, 0);

  const bareStub = {
    ...fullItem,
    rating: 0,
    quote: undefined,
    notes: '',
    tags: ['电影'],
    relatedIds: [],
  };
  const stubComp = computeItemCompleteness(bareStub);
  assert.equal(stubComp.score, 1);
  assert.equal(stubComp.tier, 'standard');
  assert.equal(stubComp.tierLabel, '初录');
  assert.ok(stubComp.missingLabels.includes('星级评分'));
});

test('pickDailySpotlightItem is deterministic per date and shuffles cleanly with offset', () => {
  const a1 = pickDailySpotlightItem(SEED_COLLECTION, '2026-11-18', 0);
  const a2 = pickDailySpotlightItem(SEED_COLLECTION, '2026-11-18', 0);
  const b = pickDailySpotlightItem(SEED_COLLECTION, '2026-11-18', 1);
  assert.ok(a1 && b);
  assert.equal(a1.id, a2?.id);
  assert.notEqual(a1.id, b.id);
  assert.equal(pickDailySpotlightItem([], '2026-11-18', 0), null);
});

test('pickRandomEncounterItem picks randomly without repeating the excluded item', () => {
  assert.equal(pickRandomEncounterItem([], undefined, () => 0.5), null);

  const single = [SEED_COLLECTION[0]];
  assert.equal(
    pickRandomEncounterItem(single, single[0].id, () => 0.2)?.id,
    single[0].id
  );

  const pair = [SEED_COLLECTION[0], SEED_COLLECTION[1]];
  // Excluding item 0 must always return item 1 regardless of RNG value
  assert.equal(
    pickRandomEncounterItem(pair, pair[0].id, () => 0)?.id,
    pair[1].id
  );
  assert.equal(
    pickRandomEncounterItem(pair, pair[1].id, () => 0.99)?.id,
    pair[0].id
  );
});

test('resolveAlbumItems matches items by linked tag and explicit itemIds', () => {
  const album = {
    id: 'alb-1',
    name: '吉卜力专题',
    tag: '吉卜力',
    itemIds: [SEED_COLLECTION[0].id],
    targetCount: 5,
    createdAt: '2026-11-18T00:00:00.000Z',
  };
  const matched = resolveAlbumItems(album, SEED_COLLECTION);
  assert.ok(matched.some((i) => i.id === SEED_COLLECTION[0].id));
  assert.ok(matched.some((i) => i.tags.includes('吉卜力')));
});

test('computeAlbumProgress computes accurate percentage, remaining count, and completion state', () => {
  // 0% progress when no items match
  const emptyProgress = computeAlbumProgress(
    {
      id: 'alb-empty',
      name: '空图鉴',
      tag: '不存在的标签',
      targetCount: 5,
      createdAt: '2026-11-18T00:00:00.000Z',
    },
    SEED_COLLECTION
  );
  assert.equal(emptyProgress.filledCount, 0);
  assert.equal(emptyProgress.targetCount, 5);
  assert.equal(emptyProgress.remainingCount, 5);
  assert.equal(emptyProgress.percent, 0);
  assert.equal(emptyProgress.isComplete, false);

  // Partial progress (2 / 5 = 40%)
  const partialProgress = computeAlbumProgress(
    {
      id: 'alb-partial',
      name: '局部收藏',
      itemIds: [SEED_COLLECTION[0].id, SEED_COLLECTION[1].id],
      targetCount: 5,
      createdAt: '2026-11-18T00:00:00.000Z',
    },
    SEED_COLLECTION
  );
  assert.equal(partialProgress.filledCount, 2);
  assert.equal(partialProgress.remainingCount, 3);
  assert.equal(partialProgress.percent, 40);
  assert.equal(partialProgress.isComplete, false);

  // Rounded percentage (1 / 3 = 33%)
  const thirdProgress = computeAlbumProgress(
    {
      id: 'alb-third',
      name: '三分之一',
      itemIds: [SEED_COLLECTION[0].id],
      targetCount: 3,
      createdAt: '2026-11-18T00:00:00.000Z',
    },
    SEED_COLLECTION
  );
  assert.equal(thirdProgress.percent, 33);
  assert.equal(thirdProgress.remainingCount, 2);
  assert.equal(thirdProgress.isComplete, false);

  // Over-target count clamps percentage at 100% and remainingCount at 0
  const overflowProgress = computeAlbumProgress(
    {
      id: 'alb-overflow',
      name: '已超额集齐',
      itemIds: SEED_COLLECTION.slice(0, 4).map((i) => i.id),
      targetCount: 3,
      createdAt: '2026-11-18T00:00:00.000Z',
    },
    SEED_COLLECTION
  );
  assert.equal(overflowProgress.filledCount, 4);
  assert.equal(overflowProgress.targetCount, 3);
  assert.equal(overflowProgress.remainingCount, 0);
  assert.equal(overflowProgress.percent, 100);
  assert.equal(overflowProgress.isComplete, true);

  // Non-positive targetCount safely normalizes to 1
  const safeTargetProgress = computeAlbumProgress(
    {
      id: 'alb-zero-target',
      name: '异常目标值',
      itemIds: [SEED_COLLECTION[0].id],
      targetCount: 0,
      createdAt: '2026-11-18T00:00:00.000Z',
    },
    SEED_COLLECTION
  );
  assert.equal(safeTargetProgress.targetCount, 1);
  assert.equal(safeTargetProgress.percent, 100);
  assert.equal(safeTargetProgress.isComplete, true);
});

test('buildCollectorRank and computeCollectorStamps derive real rank and unlock states from collection', () => {
  const state = {
    checkInDates: ['2026-11-16', '2026-11-17', '2026-11-18'],
    albums: [
      {
        id: 'alb-1',
        name: '王家卫图鉴',
        tag: '港片美学',
        targetCount: 5,
        createdAt: '2026-11-18T00:00:00.000Z',
      },
    ],
  };

  const rank = buildCollectorRank(SEED_COLLECTION, state);
  assert.ok(rank.level >= 2);
  assert.ok(rank.points > 120);
  assert.equal(rank.masterpieceCount, 6);

  const stamps = computeCollectorStamps(SEED_COLLECTION, state, '2026-11-18');
  assert.equal(stamps.length, 12);
  const byId = new Map(stamps.map((s) => [s.id, s]));
  assert.equal(byId.get('first-entry')?.unlocked, true);
  assert.equal(byId.get('trinity')?.unlocked, true);
  assert.equal(byId.get('masterpiece')?.unlocked, true);
  assert.equal(byId.get('album-maker')?.unlocked, true);
  assert.equal(byId.get('streak-3')?.unlocked, true);
  assert.equal(byId.get('ten-items')?.unlocked, false);
});
