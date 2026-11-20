import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import type {
  ArchiveCategory,
  ArchiveItem,
  OnlineSearchResult,
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
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<OnlineSearchResult[]>([]);
  const [activeSources, setActiveSources] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [collectingId, setCollectingId] = useState<string | null>(null);

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

    setLoading(true);
    setError('');
    setHasSearched(true);
    try {
      const data = await searchOnline(trimmed, cat, 'imdb');
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

  return (
    <section className="mx-auto max-w-[920px] px-4 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-[420px]:px-5 md:px-8 md:pt-8 md:pb-16">
      {/* Search Card */}
      <div className="rounded-2xl border border-[#E4DFD5] bg-white p-4 shadow-xs min-[420px]:p-5">
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
                onClick={() => setCategory(cat)}
                className={`min-h-[44px] rounded-lg text-[15px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[40px] md:text-sm ${
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
        <form
          onSubmit={handleSubmit}
          className="mt-3.5 flex flex-col gap-2.5 sm:flex-row sm:items-center"
        >
          <div className="relative min-w-0 flex-1">
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
                  ? '搜索中英文片名、剧集，或粘贴 IMDb（tt...）/ 豆瓣链接…'
                  : category === 'person'
                    ? '搜索导演、演员，或粘贴 IMDb（nm...）/ 豆瓣影人链接…'
                    : '搜索影视角色名（如：甄嬛、苏丽珍、小丑）…'
              }
              className="h-12 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] pl-10 pr-10 text-[16px] text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-[15px] [&::-webkit-search-cancel-button]:hidden"
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

        <p className="mt-3 text-[13px] leading-relaxed text-[#7A7268] md:text-[12px]">
          直连 IMDb 资料库（评分 · 奖项 · 高清海报与主创）并自动融合豆瓣中文片名、评分与简介，支持直接粘贴 IMDb / 豆瓣链接建档。
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-[#E5BFB9] bg-[#FDF4F2] px-4 py-3 text-[13px] text-[#932D20] md:text-xs"
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
          <div className="mb-3 flex items-center justify-between px-1 text-[13px] text-[#625C54] md:text-xs">
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
                  className="rounded-2xl border border-[#E4DFD5] bg-white p-3.5 min-[420px]:p-4"
                >
                  <div className="flex gap-3.5">
                    <ArchivalImage
                      src={item.coverUrl}
                      alt={item.title}
                      title={item.title}
                      category={item.category}
                      compact
                      className="h-[112px] w-[84px] shrink-0 rounded-xl border border-[#EAE4D9] md:h-[104px] md:w-[78px]"
                    />

                    <div className="flex min-w-0 flex-1 flex-col">
                      <h3 className="font-editorial text-[17px] font-medium leading-snug text-[#1A1816] md:text-base">
                        {item.title}
                      </h3>
                      {item.originalTitle && (
                        <p className="mt-0.5 truncate text-[13px] text-[#7A7268] md:text-xs">
                          {item.originalTitle}
                        </p>
                      )}
                      <p className="mt-1 truncate text-[13px] text-[#625C54] md:text-xs">
                        {[
                          CATEGORY_LABELS[item.category],
                          item.year,
                          item.subtitle,
                          item.sourceName,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className="mt-1.5 line-clamp-2 text-[14px] leading-relaxed text-[#4B453E] md:text-xs">
                        {item.summary}
                      </p>
                    </div>
                  </div>

                  {/* Full-width thumb-friendly collect action */}
                  <div className="mt-3 flex items-center justify-end border-t border-[#F0ECE4] pt-3">
                    {collected ? (
                      <span className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-[#F2F7F4] px-4 text-[14px] font-medium text-[#2A6B46] md:min-h-[40px] md:text-xs">
                        <Check className="h-4 w-4" aria-hidden="true" />
                        已在藏馆
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={isCollecting}
                        onClick={() => void handleCollect(item)}
                        aria-label={`收录「${item.title}」到藏馆`}
                        className="inline-flex min-h-[46px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-[#1A1816] px-5 text-[15px] font-medium text-white cursor-pointer active:scale-[0.98] transition-transform hover:bg-[#B43B2B] disabled:opacity-60 md:min-h-[44px] md:text-sm"
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
          <p className="font-editorial text-[20px] text-[#1A1816] md:text-lg">
            未检索到「{query}」
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-[#625C54] md:text-xs">
            可尝试切换上方的影视/影人/角色分类或换个关键词，也可以直接手动建档。
          </p>
          <button
            type="button"
            onClick={() => onJumpToManual(query.trim(), category)}
            className="mt-4 inline-flex min-h-[46px] items-center justify-center rounded-xl bg-[#1A1816] px-5 text-[15px] font-medium text-white cursor-pointer active:scale-[0.98] md:min-h-[44px] md:text-sm"
          >
            手动建档「{query.trim()}」
          </button>
        </div>
      )}
    </section>
  );
}
