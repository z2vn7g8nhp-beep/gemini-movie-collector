import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import type {
  ArchiveCategory,
  ArchiveItem,
  OnlineSearchResult,
  SearchSourceOption,
} from '../types/archive';
import { searchOnline } from '../services/archiveApi';
import { CATEGORY_LABELS, isAlreadyCollected } from '../utils/archive';
import { ArchivalImage } from './ArchivalImage';

interface SearchTabViewProps {
  existingItems: ArchiveItem[];
  initialQuery?: string;
  initialCategory?: ArchiveCategory;
  onConsumeInitialQuery?: () => void;
  onCollectResult: (result: OnlineSearchResult) => Promise<void>;
  onJumpToManual: (prefillTitle: string, category: ArchiveCategory) => void;
}

const SOURCE_OPTIONS: Array<{ id: SearchSourceOption; label: string }> = [
  { id: 'all', label: '全网直连聚合' },
  { id: 'baike', label: '百度百科' },
  { id: 'iqiyi', label: '爱奇艺影视库' },
  { id: 'moegirl', label: '萌娘百科' },
  { id: 'bangumi', label: '番组计划 Bangumi' },
  { id: 'wiki', label: '中文维基百科' },
  { id: 'itunes', label: 'iTunes 影视库' },
  { id: 'tvmaze', label: 'TVMaze 剧集库' },
];

export function SearchTabView({
  existingItems,
  initialQuery = '',
  initialCategory = 'film',
  onConsumeInitialQuery,
  onCollectResult,
  onJumpToManual,
}: SearchTabViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<ArchiveCategory>(initialCategory);
  const [source, setSource] = useState<SearchSourceOption>('all');
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<OnlineSearchResult[]>([]);
  const [activeSources, setActiveSources] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [collectingId, setCollectingId] = useState<string | null>(null);

  const runSearch = async (
    q: string,
    cat: ArchiveCategory = category,
    src: SearchSourceOption = source
  ) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setError('请输入片名、导演/演员姓名或角色名');
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError('');
    setHasSearched(true);
    try {
      const data = await searchOnline(trimmed, cat, src);
      if (data.error) {
        setError(data.error);
        setResults([]);
        return;
      }
      setResults(data.results);
      setActiveSources(data.activeSources);
    } catch {
      setError('网络连接中断，请检查网络后重试。');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCategory(initialCategory);
    if (initialQuery && initialQuery.trim()) {
      setQuery(initialQuery.trim());
      void runSearch(initialQuery.trim(), initialCategory, source);
      onConsumeInitialQuery?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, initialCategory]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query, category, source);
  };

  const handleCollect = async (item: OnlineSearchResult) => {
    setCollectingId(item.externalId);
    try {
      await onCollectResult(item);
    } finally {
      setCollectingId(null);
    }
  };

  return (
    <section className="mx-auto max-w-[920px] px-4 pt-4 pb-24 md:px-8 md:pt-8 md:pb-16">
      {/* Search Card */}
      <div className="rounded-2xl border border-[#E4DFD5] bg-white p-4 shadow-xs sm:p-5">
        {/* Big touch-friendly Category Segmented Control */}
        <div
          role="group"
          aria-label="选择搜索类型"
          className="grid grid-cols-3 gap-1 rounded-xl bg-[#EFECE5] p-1"
        >
          {(['film', 'person', 'character'] as ArchiveCategory[]).map((cat) => {
            const active = category === cat;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCategory(cat);
                  if (
                    cat === 'character' &&
                    (source === 'itunes' || source === 'iqiyi')
                  ) {
                    setSource('all');
                  }
                }}
                className={`min-h-[40px] rounded-lg text-sm font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  active
                    ? 'bg-white text-[#1A1816] shadow-xs'
                    : 'text-[#625C54]'
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            );
          })}
        </div>

        {/* Search Form */}
        <form onSubmit={handleSubmit} className="mt-3.5 space-y-3">
          <div className="relative">
            <label htmlFor="mobile-online-search-input" className="sr-only">
              直连联网搜索影视、影人或角色
            </label>
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C857B]"
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
                  ? '搜索电影、剧集或动画名称…'
                  : category === 'person'
                    ? '搜索导演、演员或声优姓名…'
                    : '搜索影视或动画角色名…'
              }
              className="h-12 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] pl-10 pr-10 text-[15px] text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1A1816] focus:bg-white focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                  setHasSearched(false);
                  setError('');
                  inputRef.current?.focus();
                }}
                aria-label="清空搜索内容"
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-[#625C54] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <div className="flex-1">
              <label htmlFor="mobile-source-select" className="sr-only">
                选择数据源
              </label>
              <select
                id="mobile-source-select"
                value={source}
                onChange={(e) => setSource(e.target.value as SearchSourceOption)}
                className="h-11 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3 text-xs font-medium text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
              >
                {SOURCE_OPTIONS.filter(
                  (opt) =>
                    !(
                      category === 'character' &&
                      (opt.id === 'itunes' || opt.id === 'iqiyi')
                    )
                ).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    来源：{opt.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 min-w-[112px] items-center justify-center gap-1.5 rounded-xl bg-[#B43B2B] px-5 text-sm font-medium text-white whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.98] transition-transform hover:bg-[#932D20] disabled:opacity-60"
            >
              {loading && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              直连搜索
            </button>
          </div>
        </form>

        <p className="mt-3 text-[12px] text-[#7A7268]">
          已内置国内免梯直连（百度百科 · 爱奇艺 · 萌娘百科）与全网聚合，检索后可一键收录建档。
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-[#E5BFB9] bg-[#FDF4F2] px-4 py-3 text-xs text-[#932D20]"
        >
          <span>{error}</span>
          {query.trim() && (
            <button
              type="button"
              onClick={() => void runSearch(query, category, source)}
              className="min-h-[36px] px-2 font-medium underline underline-offset-2 whitespace-nowrap cursor-pointer"
            >
              重试
            </button>
          )}
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div className="mt-4 space-y-3" aria-label="正在联网检索">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="flex gap-3.5 rounded-2xl border border-[#E4DFD5] bg-white p-3.5"
            >
              <div className="h-24 w-18 shrink-0 rounded-xl bg-[#EAE4D9]" />
              <div className="flex-1 space-y-2.5 py-1">
                <div className="h-4 w-2/5 rounded bg-[#EAE4D9]" />
                <div className="h-3 w-3/5 rounded bg-[#EFECE5]" />
                <div className="h-3 w-full rounded bg-[#EFECE5]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Results List */}
      {!loading && hasSearched && results.length > 0 && (
        <div data-testid="online-search-results" className="mt-5">
          <div className="mb-3 flex items-center justify-between px-1 text-xs text-[#625C54]">
            <span className="tabular-nums font-medium text-[#1A1816]">
              检索到 {results.length} 条结果
            </span>
            {activeSources.length > 0 && (
              <span className="truncate max-w-[60%] text-right">
                {activeSources.join(' · ')}
              </span>
            )}
          </div>

          <ul className="space-y-3">
            {results.map((item) => {
              const collected = isAlreadyCollected(
                existingItems,
                item.category,
                item.title
              );
              const isCollecting = collectingId === item.externalId;

              return (
                <li
                  key={item.externalId}
                  className="rounded-2xl border border-[#E4DFD5] bg-white p-3.5"
                >
                  <div className="flex gap-3.5">
                    <ArchivalImage
                      src={item.coverUrl}
                      alt={item.title}
                      title={item.title}
                      category={item.category}
                      compact
                      className="h-[104px] w-[78px] shrink-0 rounded-xl border border-[#EAE4D9]"
                    />

                    <div className="flex min-w-0 flex-1 flex-col">
                      <h3 className="font-editorial text-base font-medium leading-snug text-[#1A1816]">
                        {item.title}
                      </h3>
                      {item.originalTitle && (
                        <p className="mt-0.5 truncate text-xs text-[#7A7268]">
                          {item.originalTitle}
                        </p>
                      )}
                      <p className="mt-1 truncate text-xs text-[#625C54]">
                        {[
                          CATEGORY_LABELS[item.category],
                          item.year,
                          item.sourceName,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[#4B453E]">
                        {item.summary}
                      </p>
                    </div>
                  </div>

                  {/* Full-width thumb-friendly collect action */}
                  <div className="mt-3 flex items-center justify-end border-t border-[#F0ECE4] pt-3">
                    {collected ? (
                      <span className="inline-flex min-h-[40px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-[#F2F7F4] px-4 text-xs font-medium text-[#2A6B46]">
                        <Check className="h-4 w-4" aria-hidden="true" />
                        已在藏馆
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={isCollecting}
                        onClick={() => void handleCollect(item)}
                        aria-label={`收录「${item.title}」到藏馆`}
                        className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-[#1A1816] px-5 text-sm font-medium text-white cursor-pointer active:scale-[0.98] transition-transform hover:bg-[#B43B2B] disabled:opacity-60"
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
        <div className="mt-5 rounded-2xl border border-[#E4DFD5] bg-white px-5 py-9 text-center">
          <p className="font-editorial text-lg text-[#1A1816]">
            未检索到「{query}」
          </p>
          <p className="mt-2 text-xs leading-relaxed text-[#625C54]">
            可尝试切换上方的影视/影人/角色分类或换个关键词，也可以直接手动建档。
          </p>
          <button
            type="button"
            onClick={() => onJumpToManual(query.trim(), category)}
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#1A1816] px-5 text-sm font-medium text-white cursor-pointer active:scale-[0.98]"
          >
            手动建档「{query.trim()}」
          </button>
        </div>
      )}
    </section>
  );
}
