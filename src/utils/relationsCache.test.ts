import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRelationsCacheKey,
  loadPersistedRuntimeMode,
  loadPersistedUiState,
  readCachedRelations,
  savePersistedRuntimeMode,
  savePersistedUiState,
  writeCachedRelations,
} from './relationsCache';

function installMockWindow() {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: storage,
    location: { origin: 'https://example.github.io' },
  };
}

test('relationsCache persists and retrieves online relations without refetching', () => {
  installMockWindow();
  const params = {
    category: 'film' as const,
    title: '钢铁侠',
    originalTitle: 'Iron Man',
    year: '2008',
  };
  assert.equal(buildRelationsCacheKey(params), 'film::钢铁侠::2008');

  writeCachedRelations(params, {
    films: [],
    people: [
      {
        externalId: 'p1',
        category: 'person',
        title: '小罗伯特·唐尼',
        originalTitle: 'Robert Downey Jr.',
        subtitle: '主演',
        coverUrl: 'https://bkimg.cdn.bcebos.com/pic/rdj.jpg',
        summary: '主演',
        sourceName: '百度百科',
        tags: ['主演'],
      },
    ],
    characters: [],
    sources: ['百度百科', 'IMDb'],
  });

  const hit = readCachedRelations(params);
  assert.ok(hit);
  assert.equal(hit.people.length, 1);
  assert.equal(hit.people[0].title, '小罗伯特·唐尼');
});

test('relationsCache persists and restores UI session state and origin-scoped runtime mode', () => {
  installMockWindow();
  savePersistedUiState({
    activeTab: 'library',
    activeCategory: 'film',
    statusFilter: 'watched',
    activeTag: '科幻',
    activeAlbumId: '',
    sortBy: 'rating',
    selectedItemId: 'item-42',
  });

  const ui = loadPersistedUiState();
  assert.equal(ui.activeTab, 'library');
  assert.equal(ui.activeCategory, 'film');
  assert.equal(ui.statusFilter, 'watched');
  assert.equal(ui.selectedItemId, 'item-42');

  savePersistedRuntimeMode('static');
  assert.equal(loadPersistedRuntimeMode(), 'static');
});
