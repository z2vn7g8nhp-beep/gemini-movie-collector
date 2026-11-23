import { localizeFilm } from '../utils/filmIndex';
import { SummarySource } from './SummarySource';
import { useEffect, useRef, useState } from 'react';
import { Check, Clock, Loader2, Plus, Search, Sparkles, X } from 'lucide-react';
import type {
  ArchiveCategory,
  ArchiveItem,
  OnlineSearchResult,
} from '../types/archive';
import { searchOnline } from '../services/archiveApi';
import { CATEGORY_LABELS, isAlreadyCollected } from '../utils/archive';
import {
  clearRecentSearches,
  CURATED_SEARCH_SUGGESTIONS,
  getVisibleRecentSearches,
  loadRecentSearches,
  pushRecentSearchQuery,
  removeRecentSearchQuery,
  saveRecentSearches,
} from '../utils/uiHelpers';
import { ArchivalImage } from './ArchivalImage';

interface SearchTabViewProps {
  existingItems: ArchiveItem[];
  initialQuery?: string;
  initialCategory?: ArchiveCategory;
  onConsumeInitialQuery?: () => void;
  onCollectResult: (result: OnlineSearchResult) => Promise<void>;
  onJumpToManual: (prefillTitle: string, category: ArchiveCategory) => void;
}

const SEARCH_SESSION_KEY = 'cinearchive.searchSession.v4';

interface CachedSearchSession {
  category: ArchiveCategory;
  query: string;
  results: OnlineSearchResult[];
  activeSources: string[];
  hasSearched: boolean;
}

function loadSearchSession(): CachedSearchSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SEARCH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedSearchSession>;
    if (!parsed || typeof parsed.query !== 'string') return null;
    return {
      category:
        parsed.category === 'person' || parsed.category === 'character'
          ? parsed.category
          : 'film',
      query: parsed.query,
      results: Array.isArray(parsed.results)
        ? parsed.results.filter(row => row && typeof row.externalId === 'string' && typeof row.title === 'string') : [],
      activeSources: Array.isArray(parsed.activeSources)
        ? parsed.activeSources
        : [],
      hasSearched: Boolean(parsed.hasSearched),
    };
  } catch {
    return null;
  }
}

function saveSearchSession(session: CachedSearchSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore sessionStorage errors
  }
}

export function SearchTabView({
  existingItems,
  initialQuery = '',
  initialCategory = 'film',
  onConsumeInitialQuery,
  onCollectResult,
  onJumpToManual,
}: SearchTabViewProps) {
  const cachedSession = useRef(loadSearchSession()).current;
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<ArchiveCategory>(() =>
    initialQuery.trim()
      ? initialCategory
      : cachedSession?.category ?? initialCategory
  );
  const [query, setQuery] = useState(() =>
    initialQuery.trim() ? initialQuery.trim() : cachedSession?.query ?? ''
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<OnlineSearchResult[]>(
    () => (initialQuery.trim() ? [] : cachedSession?.results.map(localizeFilm) ?? [])
  );
  const [activeSources, setActiveSources] = useState<string[]>(
    () => (initialQuery.trim() ? [] : cachedSession?.activeSources ?? [])
  );
  const [hasSearched, setHasSearched] = useState(
    () => (initialQuery.trim() ? false : cachedSession?.hasSearched ?? false)
  );
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    loadRecentSearches()
  );

  const searchVersion = useRef(0);
  const clearSearch = () => {
    searchVersion.current++;
    setLoading(false);
    setResults([]);
    setActiveSources([]);
    setHasSearched(false);
    setError('');
    saveSearchSession({ category, query: '', results: [], activeSources: [], hasSearched: false });
  };

  const runSearch = async (
    q: string,
    cat: ArchiveCategory = category
  ) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setError('请输入片名、导演/演员姓名或角色名');
      inputRef.current?.focus();
      return;
    }

    const version = ++searchVersion.current;
    setLoading(true);
    setError('');
    setHasSearched(true);
    setRecentSearches((prev) => {
      const next = pushRecentSearchQuery(prev, trimmed);
      saveRecentSearches(next);
      return next;
    });
    try {
      const data = await searchOnline(trimmed, cat, 'imdb');
      if (version !== searchVersion.current) return;
      if (data.error) {
        setError(data.error);
        setResults([]);
        return;
      }
      setResults(data.results);
      setActiveSources(data.activeSources);
      saveSearchSession({
        category: cat,
        query: trimmed,
        results: data.results,
        activeSources: data.activeSources,
        hasSearched: true,
      });
    } catch {
      if (version !== searchVersion.current) return;
      setError('网络连接中断，请检查网络后重试。');
      setResults([]);
    } finally {
      if (version === searchVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      setCategory(initialCategory);
      setQuery(initialQuery.trim());
      void runSearch(initialQuery.trim(), initialCategory);
      onConsumeInitialQuery?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, initialCategory]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query, category);
  };

  const handleCollect = async (item: OnlineSearchResult) => {
    setCollectingId(item.externalId);
    try {
      await onCollectResult(item);
    } finally {
      setCollectingId(null);
    }
  };

  const handleQuickPick = (pickedQuery: string) => {
    setQuery(pickedQuery);
    void runSearch(pickedQuery, category);
  };

  const handleRemoveRecent = (target: string) => {
    setRecentSearches((prev) => {
      const next = removeRecentSearchQuery(prev, target);
      saveRecentSearches(next);
      return next;
    });
  };

  const handleClearRecent = () => {
    setRecentSearches([]);
    clearRecentSearches();
  };

  const suggestions = CURATED_SEARCH_SUGGESTIONS[category];
  const visibleRecentSearches = getVisibleRecentSearches(recentSearches);

  return (
    <section className="mx-auto max-w-[1100px] px-4 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-[420px]:px-5 md:px-8 md:pt-7 md:pb-16">
      {/* Search Card */}
      <div className="gallery-card border border-[#E4DFD5] p-4 min-[420px]:p-5 md:p-6 dark:border-[#322D27]">
        {/* Big touch-friendly Category Segmented Control */}
        <div
          role="group"
          aria-label="选择搜索类型"
          className="grid grid-cols-3 gap-1 rounded-xl bg-[#EFECE5] p-1 dark:bg-[#231F1B]"
        >
          {(['film', 'person', 'character'] as ArchiveCategory[]).map((cat) => {
            const active = category === cat;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (!active) { clearSearch(); setCategory(cat); }
                }}
                className={`min-h-[44px] rounded-lg text-[15px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[40px] md:text-sm ${
                  active
                    ? 'bg-white text-[#1A1816] shadow-xs dark:bg-[#353029] dark:text-[#F5F1E8]'
                    : 'text-[#625C54] dark:text-[#A59D90] dark:hover:text-[#F3EFE6]'
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            );
          })}
        </div>

        {/* Search Form */}
        <form
          onSubmit={handleSubmit}
          className="mt-3.5 flex flex-col gap-2.5 sm:flex-row sm:items-center"
        >
          <div className="relative min-w-0 flex-1">
            <label htmlFor="mobile-online-search-input" className="sr-only">
              直连联网搜索影视、影人或角色
            </label>
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C857B] dark:text-[#8E8578]"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              id="mobile-online-search-input"
              type="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (error) setError('');
              }}
              placeholder={
                category === 'film'
                  ? '搜索中英文片名、剧集，或粘贴 IMDb（tt...）/ 豆瓣链接…'
                  : category === 'person'
                    ? '搜索导演、演员，或粘贴 IMDb（nm...）/ 豆瓣影人链接…'
                    : '搜索影视角色名（如：甄嬛、苏丽珍、小丑）…'
              }
              className="h-12 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] pl-10 pr-10 text-[16px] text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-[15px] [&::-webkit-search-cancel-button]:hidden dark:border-[#3A342D] dark:bg-[#141210] dark:text-[#F3EFE6] dark:placeholder:text-[#787066] dark:focus:border-[#D4AF6A] dark:focus:bg-[#141210]"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  clearSearch();
                  inputRef.current?.focus();
                }}
                aria-label="清空搜索内容"
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-[#625C54] hover:text-[#1A1816] cursor-pointer dark:text-[#A59D90] dark:hover:text-[#F3EFE6]"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-12 w-full sm:w-auto sm:min-w-[120px] items-center justify-center gap-1.5 rounded-xl bg-[#B43B2B] px-5 text-[15px] font-medium text-white whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.98] transition-transform hover:bg-[#932D20] disabled:opacity-60 md:text-sm"
          >
            {loading && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            直连搜索
          </button>
        </form>

        {/* Persistent Search History (Recent 3 Keywords, Always Accessible Below Search Box) */}
        {visibleRecentSearches.length > 0 && (
          <div
            aria-label="搜索历史记录"
            data-testid="search-history-list"
            className="mt-3 flex flex-wrap items-center gap-2"
          >
            <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-[#7A7268] dark:text-[#A59D90]">
              <Clock className="h-3.5 w-3.5 text-[#8C857B] dark:text-[#8E8578]" aria-hidden="true" />
              <span>历史记录</span>
            </span>
            {visibleRecentSearches.map((item) => {
              const isCurrent =
                hasSearched && query.trim().toLowerCase() === item.toLowerCase();
              return (
                <span
                  key={`recent-${item}`}
                  data-testid="search-history-item"
                  className={`inline-flex min-h-[34px] max-w-full items-center rounded-lg border pl-2.5 pr-1 text-[13px] transition-colors md:text-xs ${
                    isCurrent
                      ? 'border-[#C9A45C] bg-[#FDFBF5] text-[#1A1816] dark:border-[#C9A45C]/70 dark:bg-[#241E16] dark:text-[#F5F1E8]'
                      : 'border-[#E6E0D4] bg-[#FAF9F6] text-[#4B453E] hover:border-[#CFC5B4] hover:bg-white dark:border-[#322D27] dark:bg-[#24201C] dark:text-[#D4CCC0] dark:hover:border-[#4A4239] dark:hover:bg-[#2B2621]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleQuickPick(item)}
                    aria-label={`再次检索「${item}」`}
                    className="max-w-[180px] truncate pr-1 text-left font-medium hover:text-[#B43B2B] cursor-pointer dark:hover:text-[#EB7865]"
                  >
                    {item}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveRecent(item)}
                    aria-label={`移除历史记录「${item}」`}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#9C9488] transition-colors hover:bg-[#EFECE5] hover:text-[#1A1816] cursor-pointer dark:text-[#8E8578] dark:hover:bg-[#353029] dark:hover:text-[#F3EFE6]"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              data-testid="clear-search-history-btn"
              onClick={handleClearRecent}
              className="ml-auto inline-flex min-h-[32px] items-center rounded-lg px-2 text-[12px] text-[#8C857B] whitespace-nowrap cursor-pointer transition-colors hover:bg-[#F3EFE8] hover:text-[#1A1816] dark:text-[#9A9184] dark:hover:bg-[#2A2520] dark:hover:text-[#F3EFE6]"
            >
              清空
            </button>
          </div>
        )}

        <p className="mt-3 text-[13px] leading-relaxed text-[#7A7268] md:text-[12px] dark:text-[#A59D90]">
          支持中英文片名和 IMDb / 豆瓣链接。常见影片可用内置中文片名索引查询，评分、海报与简介按联网结果显示。
        </p>

        {/* Curated Quick-Picks */}
        {!loading && !hasSearched && (
          <div className="mt-4 border-t border-[#F0ECE4] pt-4 dark:border-[#2E2924]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#7A7268] dark:text-[#A59D90]">
                <Sparkles className="h-3.5 w-3.5 text-[#A67C37] dark:text-[#E4C37A]" aria-hidden="true" />
                推荐检索
              </span>
              {suggestions.map((suggestion) => (
                <button
                  key={`${category}-${suggestion}`}
                  type="button"
                  onClick={() => handleQuickPick(suggestion)}
                  className="inline-flex min-h-[34px] items-center rounded-lg border border-[#E4DFD5] bg-[#FAF9F6] px-2.5 text-[13px] text-[#2E2A26] transition-colors hover:border-[#1A1816] hover:bg-white cursor-pointer md:text-xs dark:border-[#322D27] dark:bg-[#24201C] dark:text-[#E2DBD0] dark:hover:border-[#D4AF6A] dark:hover:bg-[#2B2621]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-[#E5BFB9] bg-[#FDF4F2] px-4 py-3 text-[13px] text-[#932D20] md:text-xs dark:border-[#6B3229] dark:bg-[#351B17] dark:text-[#F28C7B]"
        >
          <span className="min-w-0 flex-1 break-words">{error}</span>
          {query.trim() && (
            <button
              type="button"
              onClick={() => void runSearch(query, category)}
              className="min-h-[38px] px-2 font-medium underline underline-offset-2 whitespace-nowrap cursor-pointer"
            >
              重试
            </button>
          )}
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div
          className="mt-5 grid grid-cols-1 gap-3.5 md:grid-cols-2"
          aria-label="正在联网检索"
        >
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="flex animate-pulse gap-3.5 rounded-2xl border border-[#E4DFD5] bg-white p-4 dark:border-[#322D27] dark:bg-[#1D1A17]"
            >
              <div className="h-[104px] w-[78px] shrink-0 rounded-xl bg-[#EAE4D9] dark:bg-[#2A2520]" />
              <div className="flex-1 space-y-2.5 py-1">
                <div className="h-4 w-2/5 rounded bg-[#EAE4D9] dark:bg-[#2A2520]" />
                <div className="h-3 w-3/5 rounded bg-[#EFECE5] dark:bg-[#24201C]" />
                <div className="h-3 w-full rounded bg-[#EFECE5] dark:bg-[#24201C]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Results List */}
      {!loading && hasSearched && results.length > 0 && (
        <div data-testid="online-search-results" className="mt-5">
          <div className="mb-3 flex items-center justify-between px-1 text-[13px] text-[#625C54] md:text-xs dark:text-[#A59D90]">
            <span className="tabular-nums font-medium text-[#1A1816] dark:text-[#F3EFE6]">
              检索到 {results.length} 条结果
            </span>
            {activeSources.length > 0 && (
              <span className="truncate max-w-[60%] text-right">
                {activeSources.join(' · ')}
              </span>
            )}
          </div>

          <ul className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            {results.map((item) => {
              const collected = isAlreadyCollected(
                existingItems,
                item.category,
                item.title,
                {
                  originalTitle: item.originalTitle,
                  sourceUrl: item.sourceUrl,
                  year: item.year,
                }
              );
              const isCollecting = collectingId === item.externalId;

              return (
                <li
                  key={item.externalId}
                  className="gallery-card flex flex-col justify-between border border-[#E4DFD5] p-3.5 transition-colors hover:border-[#CFC7B9] min-[420px]:p-4 dark:border-[#322D27] dark:hover:border-[#4B4339]"
                >
                  <div className="flex gap-3.5">
                    <ArchivalImage
                      src={item.coverUrl}
                      alt={item.title}
                      title={item.title}
                      category={item.category}
                      compact
                      className="h-[112px] w-[84px] shrink-0 rounded-xl border border-[#EAE4D9] md:h-[104px] md:w-[78px] dark:border-[#322D27]"
                    />

                    <div className="flex min-w-0 flex-1 flex-col">
                      <h3 className="font-editorial text-[17px] font-medium leading-snug text-[#1A1816] md:text-base dark:text-[#F5F1E8]">
                        {item.title}
                      </h3>
                      {item.originalTitle && (
                        <p className="mt-0.5 truncate text-[13px] text-[#7A7268] md:text-xs dark:text-[#A59D90]">
                          {item.originalTitle}
                        </p>
                      )}
                      <p className="mt-1 truncate text-[13px] text-[#625C54] md:text-xs dark:text-[#B8AFA2]">
                        {[
                          CATEGORY_LABELS[item.category],
                          item.year,
                          item.subtitle,
                          item.sourceName,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className="mt-1.5 line-clamp-2 text-[14px] leading-relaxed text-[#4B453E] md:text-xs dark:text-[#C8C0B4]">
                        {item.summary}
                      </p>
                      <SummarySource revision={item.summaryRevision} />
                    </div>
                  </div>

                  {/* Full-width thumb-friendly collect action */}
                  <div className="mt-3 flex items-center justify-end border-t border-[#F0ECE4] pt-3 dark:border-[#2E2924]">
                    {collected ? (
                      <span className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-[#F2F7F4] px-4 text-[14px] font-medium text-[#2A6B46] md:min-h-[40px] md:text-xs dark:border dark:border-[#2B523B] dark:bg-[#172B20] dark:text-[#6CC492]">
                        <Check className="h-4 w-4" aria-hidden="true" />
                        已在藏馆
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={isCollecting}
                        onClick={() => void handleCollect(item)}
                        aria-label={`收录「${item.title}」到藏馆`}
                        className="inline-flex min-h-[46px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-[#1A1816] px-5 text-[15px] font-medium text-white cursor-pointer active:scale-[0.98] transition-transform hover:bg-[#B43B2B] disabled:opacity-60 md:min-h-[44px] md:text-sm dark:bg-[#F3EFE6] dark:text-[#141210] dark:hover:bg-[#E4C37A]"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        {isCollecting ? '收录中…' : '收录到藏馆'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Empty Search Result */}
      {!loading && hasSearched && results.length === 0 && !error && (
        <div className="mt-5 rounded-2xl border border-[#E4DFD5] bg-white px-5 py-9 text-center dark:border-[#322D27] dark:bg-[#1D1A17]">
          <p className="font-editorial text-[20px] text-[#1A1816] md:text-lg dark:text-[#F3EFE6]">
            未检索到「{query}」
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-[#625C54] md:text-xs dark:text-[#A59D90]">
            可尝试切换上方的影视/影人/角色分类或换个关键词，也可以直接手动建档。
          </p>
          <button
            type="button"
            onClick={() => onJumpToManual(query.trim(), category)}
            className="mt-4 inline-flex min-h-[46px] items-center justify-center rounded-xl bg-[#1A1816] px-5 text-[15px] font-medium text-white cursor-pointer active:scale-[0.98] hover:bg-[#B43B2B] md:min-h-[44px] md:text-sm dark:bg-[#F3EFE6] dark:text-[#141210] dark:hover:bg-[#E4C37A]"
          >
            手动建档「{query.trim()}」
          </button>
        </div>
      )}
    </section>
  );
}
