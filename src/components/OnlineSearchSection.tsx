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

interface OnlineSearchSectionProps {
  existingItems: ArchiveItem[];
  preferredCategory: ArchiveCategory;
  focusTrigger: number;
  externalQuery?: string;
  onCollectResult: (result: OnlineSearchResult) => Promise<void>;
  onOpenManualCreate: (prefillTitle?: string, category?: ArchiveCategory) => void;
}

const SOURCE_OPTIONS: Array<{ id: SearchSourceOption; label: string }> = [
  { id: 'all', label: '全网直连聚合（豆瓣优先）' },
  { id: 'douban', label: '豆瓣影视' },
  { id: 'baike', label: '百度百科' },
  { id: 'iqiyi', label: '爱奇艺影视库' },
  { id: 'moegirl', label: '萌娘百科' },
  { id: 'bangumi', label: '番组计划 Bangumi' },
  { id: 'wiki', label: '中文维基百科' },
  { id: 'itunes', label: 'iTunes 影视库' },
  { id: 'tvmaze', label: 'TVMaze 剧集库' },
];

export function OnlineSearchSection({
  existingItems,
  preferredCategory,
  focusTrigger,
  externalQuery,
  onCollectResult,
  onOpenManualCreate,
}: OnlineSearchSectionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<ArchiveCategory>(preferredCategory);
  const [source, setSource] = useState<SearchSourceOption>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<OnlineSearchResult[]>([]);
  const [activeSources, setActiveSources] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [collectingId, setCollectingId] = useState<string | null>(null);

  useEffect(() => {
    setCategory(preferredCategory);
    if (
      preferredCategory === 'character' &&
      (source === 'itunes' || source === 'iqiyi')
    ) {
      setSource('all');
    }
  }, [preferredCategory]);

  useEffect(() => {
    if (focusTrigger > 0) {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusTrigger]);

  useEffect(() => {
    if (externalQuery && externalQuery.trim()) {
      setQuery(externalQuery.trim());
      void runSearch(externalQuery.trim(), category, source);
    }
  }, [externalQuery]);

  const runSearch = async (
    q: string,
    cat: ArchiveCategory = category,
    src: SearchSourceOption = source
  ) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setError('请输入要搜索的影视片名、影人姓名或角色名称');
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
      setError('网络连接中断，请稍后重试。');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

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

  const handleClearResults = () => {
    setResults([]);
    setHasSearched(false);
    setError('');
    setActiveSources([]);
  };

  return (
    <div className="mt-7 border border-[#DCD6CB] bg-white p-4 sm:p-5">
      {/* Top Row: Category Switcher + Source Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="联网搜索类别"
          className="flex items-center gap-1 rounded-md bg-[#EFECE5] p-1"
        >
          {(['film', 'person', 'character'] as ArchiveCategory[]).map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={category === cat}
              onClick={() => {
                setCategory(cat);
                if (cat === 'character' && source === 'itunes') {
                  setSource('all');
                }
              }}
              className={`min-h-[34px] rounded px-3.5 py-1 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                category === cat
                  ? 'bg-white text-[#1A1816] shadow-xs'
                  : 'text-[#625C54] hover:text-[#1A1816]'
              }`}
            >
              搜{CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="hero-online-source"
            className="text-xs text-[#625C54] whitespace-nowrap"
          >
            数据源
          </label>
          <select
            id="hero-online-source"
            value={source}
            onChange={(e) => setSource(e.target.value as SearchSourceOption)}
            className="h-9 rounded-md border border-[#DCD6CB] bg-[#FAF9F6] px-2.5 text-xs text-[#1A1816] cursor-pointer focus:border-[#1A1816] focus:outline-none"
          >
            {SOURCE_OPTIONS.filter(
              (opt) => !(category === 'character' && opt.id === 'itunes')
            ).map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Search Input Form */}
      <form
        onSubmit={handleSubmit}
        className="mt-3.5 flex flex-col gap-2.5 sm:flex-row"
      >
        <div className="relative flex-1">
          <label htmlFor="hero-online-search" className="sr-only">
            联网搜索影视、影人或角色
          </label>
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C857B]"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            id="hero-online-search"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (error) setError('');
            }}
            placeholder={
              category === 'film'
                ? '输入电影、剧集名称或直接粘贴豆瓣链接，回车直连豆瓣搜索并收录…'
                : category === 'person'
                  ? '输入导演、演员姓名或豆瓣影人链接，回车直连豆瓣搜索并收录…'
                  : '输入想收藏的影视或动画角色名，回车直连检索并收录…'
            }
            className="h-12 w-full rounded-md border border-[#D4CDC0] bg-[#FAF9F6] pl-10 pr-9 text-sm text-[#1A1816] placeholder:text-[#8C857B] transition-colors focus:border-[#1A1816] focus:bg-white focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                handleClearResults();
              }}
              aria-label="清空联网搜索词"
              className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-[#625C54] hover:text-[#1A1816] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-12 flex-1 sm:flex-initial items-center justify-center gap-2 rounded-md bg-[#B43B2B] px-6 text-sm font-medium text-white whitespace-nowrap cursor-pointer transition-colors hover:bg-[#932D20] disabled:opacity-60"
          >
            {loading && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            联网搜索
          </button>
          <button
            type="button"
            onClick={() => onOpenManualCreate(query.trim(), category)}
            className="inline-flex h-12 items-center justify-center rounded-md border border-[#D4CDC0] bg-white px-4 text-sm font-medium text-[#1A1816] whitespace-nowrap cursor-pointer transition-colors hover:border-[#1A1816]"
          >
            手动建档
          </button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="mt-3.5 flex items-center justify-between gap-4 border border-[#E5BFB9] bg-[#FDF4F2] px-4 py-2.5 text-xs text-[#932D20]"
        >
          <span>{error}</span>
          {query.trim() && (
            <button
              type="button"
              onClick={() => void runSearch(query, category, source)}
              className="font-medium underline underline-offset-2 whitespace-nowrap cursor-pointer"
            >
              重试
            </button>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="mt-5 space-y-3" aria-label="正在联网检索">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="flex gap-4 border border-[#E4DFD5] bg-[#FAF9F6] p-3.5"
            >
              <div className="h-24 w-18 shrink-0 bg-[#EAE4D9]" />
              <div className="flex-1 space-y-2.5 py-1">
                <div className="h-4 w-1/3 bg-[#EAE4D9]" />
                <div className="h-3 w-1/2 bg-[#EFECE5]" />
                <div className="h-3 w-4/5 bg-[#EFECE5]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Inline Online Search Results */}
      {!loading && hasSearched && results.length > 0 && (
        <div
          data-testid="online-search-results"
          className="mt-5 border-t border-[#E4DFD5] pt-4"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#625C54]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-[#1A1816] tabular-nums">
                共直连检索到 {results.length} 条结果
              </span>
              {activeSources.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>来源：{activeSources.join(' / ')}</span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={handleClearResults}
              className="text-xs text-[#625C54] underline underline-offset-4 hover:text-[#1A1816] cursor-pointer"
            >
              收起搜索结果
            </button>
          </div>

          <ul className="max-h-[460px] divide-y divide-[#E4DFD5] overflow-y-auto border border-[#E4DFD5] bg-[#FAF9F6]">
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
                  className="flex flex-col gap-3.5 p-3.5 sm:flex-row sm:items-start bg-white"
                >
                  <ArchivalImage
                    src={item.coverUrl}
                    alt={item.title}
                    title={item.title}
                    category={item.category}
                    compact
                    className="h-24 w-18 shrink-0 border border-[#EAE4D9]"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <h3 className="font-editorial text-base font-medium text-[#1A1816]">
                        {item.title}
                      </h3>
                      {item.originalTitle && (
                        <span className="text-xs text-[#7A7268]">
                          {item.originalTitle}
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-xs text-[#625C54]">
                      {[
                        CATEGORY_LABELS[item.category],
                        item.year,
                        item.subtitle,
                        item.sourceName,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>

                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[#4B453E]">
                      {item.summary}
                    </p>
                  </div>

                  <div className="shrink-0 sm:self-center">
                    {collected ? (
                      <span className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[#D4DFD7] bg-[#F2F7F4] px-3 py-1.5 text-xs font-medium text-[#2A6B46] whitespace-nowrap">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        已在藏馆
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={isCollecting}
                        onClick={() => void handleCollect(item)}
                        aria-label={`收录「${item.title}」到藏馆`}
                        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-[#1A1816] px-3.5 py-1.5 text-xs font-medium text-white whitespace-nowrap cursor-pointer transition-colors hover:bg-[#B43B2B] disabled:opacity-60"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
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
        <div className="mt-4 flex flex-col items-start justify-between gap-3 border-t border-[#E4DFD5] pt-4 sm:flex-row sm:items-center">
          <p className="text-xs text-[#625C54]">
            未检索到与「{query}」匹配的公开条目，可以换个关键词，或直接手动建档。
          </p>
          <button
            type="button"
            onClick={() => onOpenManualCreate(query.trim(), category)}
            className="min-h-[36px] rounded-md border border-[#1A1816] bg-white px-3.5 py-1.5 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer hover:bg-[#1A1816] hover:text-white transition-colors"
          >
            手动建档「{query.trim()}」
          </button>
        </div>
      )}
    </div>
  );
}
