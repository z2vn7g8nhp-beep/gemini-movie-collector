import { useEffect, useState } from 'react';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import type {
  ArchiveCategory,
  ArchiveDraftInput,
  ArchiveItem,
  CollectionStatus,
  OnlineSearchResult,
  SearchSourceOption,
  ValidationErrors,
} from '../types/archive';
import { searchOnline } from '../services/archiveApi';
import {
  CATEGORY_LABELS,
  getStatusLabel,
  hasValidationErrors,
  isAlreadyCollected,
  parseTagsInput,
  validateArchiveInput,
} from '../utils/archive';
import { ArchivalImage } from './ArchivalImage';

interface OnlineSearchModalProps {
  open: boolean;
  initialTab?: 'online' | 'manual';
  initialQuery?: string;
  initialCategory?: ArchiveCategory;
  existingItems: ArchiveItem[];
  onClose: () => void;
  onCollectOnlineResult: (result: OnlineSearchResult) => Promise<void>;
  onCreateManualItem: (draft: ArchiveDraftInput) => Promise<void>;
}

const PRESETS: Record<ArchiveCategory, string[]> = {
  film: ['重庆森林', '盗梦空间', '霸王别姬', '幽灵公主', '星际穿越'],
  person: ['宫崎骏', '张曼玉', '克里斯托弗·诺兰', '是枝裕和', '周星驰'],
  character: ['绫波丽', '甄嬛', '小丑', '夏洛克·福尔摩斯', '孙悟空'],
};

const SOURCE_OPTIONS: Array<{ id: SearchSourceOption; label: string }> = [
  { id: 'douban', label: '豆瓣影视' },
  { id: 'all', label: '全网直连聚合（豆瓣优先）' },
  { id: 'bangumi', label: '番组计划 Bangumi' },
  { id: 'wiki', label: '中文维基百科' },
  { id: 'itunes', label: 'iTunes 影视库' },
  { id: 'tvmaze', label: 'TVMaze 剧集库' },
  { id: 'baike', label: '百度百科' },
  { id: 'iqiyi', label: '爱奇艺影视库' },
  { id: 'moegirl', label: '萌娘百科' },
];

export function OnlineSearchModal({
  open,
  initialTab = 'online',
  initialQuery = '',
  initialCategory = 'film',
  existingItems,
  onClose,
  onCollectOnlineResult,
  onCreateManualItem,
}: OnlineSearchModalProps) {
  const [activeTab, setActiveTab] = useState<'online' | 'manual'>(initialTab);

  // Online search state
  const [category, setCategory] = useState<ArchiveCategory>(initialCategory);
  const [source, setSource] = useState<SearchSourceOption>('douban');
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<OnlineSearchResult[]>([]);
  const [activeSources, setActiveSources] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [collectingId, setCollectingId] = useState<string | null>(null);

  // Manual entry state
  const [manualCategory, setManualCategory] = useState<ArchiveCategory>(initialCategory);
  const [title, setTitle] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [year, setYear] = useState('');
  const [region, setRegion] = useState('');
  const [relatedWorkTitle, setRelatedWorkTitle] = useState('');
  const [portrayedBy, setPortrayedBy] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [quote, setQuote] = useState('');
  const [summary, setSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [rating, setRating] = useState(5);
  const [status, setStatus] = useState<CollectionStatus>('favorite');
  const [selectedRelatedIds, setSelectedRelatedIds] = useState<string[]>([]);
  const [formErrors, setFormErrors] = useState<ValidationErrors>({});
  const [submittingManual, setSubmittingManual] = useState(false);

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab);
    setCategory(initialCategory);
    setManualCategory(initialCategory);
    if (initialTab === 'manual' && initialQuery) {
      setTitle(initialQuery);
    } else if (initialQuery) {
      setSearchQuery(initialQuery);
    }
  }, [open, initialTab, initialQuery, initialCategory]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const executeOnlineSearch = async (
    q: string,
    cat: ArchiveCategory = category,
    src: SearchSourceOption = source
  ) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setSearchError('请输入要检索的影视片名、影人姓名或角色名称');
      return;
    }

    setLoading(true);
    setSearchError('');
    setHasSearched(true);
    try {
      const data = await searchOnline(trimmed, cat, src);
      if (data.error) {
        setSearchError(data.error);
        setResults([]);
        return;
      }
      setResults(data.results);
      setActiveSources(data.activeSources);
    } catch {
      setSearchError('网络连接中断，请稍后重试。');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeOnlineSearch(searchQuery, category, source);
  };

  const handleCollect = async (result: OnlineSearchResult) => {
    setCollectingId(result.externalId);
    try {
      await onCollectOnlineResult(result);
    } finally {
      setCollectingId(null);
    }
  };

  const toggleManualRelated = (id: string) => {
    setSelectedRelatedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const resetManualForm = () => {
    setTitle('');
    setOriginalTitle('');
    setSubtitle('');
    setYear('');
    setRegion('');
    setRelatedWorkTitle('');
    setPortrayedBy('');
    setCoverUrl('');
    setQuote('');
    setSummary('');
    setNotes('');
    setTagsText('');
    setRating(5);
    setStatus('favorite');
    setSelectedRelatedIds([]);
    setFormErrors({});
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const draft: ArchiveDraftInput = {
      category: manualCategory,
      title,
      originalTitle,
      subtitle,
      year,
      region,
      relatedWorkTitle,
      portrayedBy,
      coverUrl,
      quote,
      summary,
      notes,
      rating,
      status,
      tags: parseTagsInput(tagsText),
      relatedIds: selectedRelatedIds,
      sourceName: '手动建档',
    };

    const errors = validateArchiveInput(draft);
    setFormErrors(errors);
    if (hasValidationErrors(errors)) {
      return;
    }

    setSubmittingManual(true);
    try {
      await onCreateManualItem(draft);
      resetManualForm();
      onClose();
    } finally {
      setSubmittingManual(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="collect-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1816]/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden border border-[#DCD6CB] bg-[#F7F5F0] shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#E4DFD5] bg-white px-6 py-4">
          <div>
            <h2
              id="collect-modal-title"
              className="font-editorial text-xl font-semibold text-[#1A1816]"
            >
              收录新藏品
            </h2>
            <p className="mt-0.5 text-xs text-[#625C54]">
              直连豆瓣影视资料库（评分、简介、演职员表与高清海报）及全网公开库，支持粘贴豆瓣链接快速建档
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭收录窗口"
            className="flex h-10 w-10 items-center justify-center rounded-md text-[#625C54] hover:bg-[#F3EFE8] hover:text-[#1A1816] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div
          role="tablist"
          aria-label="收录方式切换"
          className="flex border-b border-[#E4DFD5] bg-white px-6"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'online'}
            onClick={() => setActiveTab('online')}
            className={`relative mr-6 py-3 text-sm font-medium whitespace-nowrap cursor-pointer transition-colors ${
              activeTab === 'online'
                ? 'text-[#1A1816]'
                : 'text-[#7A7268] hover:text-[#1A1816]'
            }`}
          >
            全网直连检索
            {activeTab === 'online' && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-[2px] bg-[#B43B2B]"
              />
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'manual'}
            onClick={() => setActiveTab('manual')}
            className={`relative py-3 text-sm font-medium whitespace-nowrap cursor-pointer transition-colors ${
              activeTab === 'manual'
                ? 'text-[#1A1816]'
                : 'text-[#7A7268] hover:text-[#1A1816]'
            }`}
          >
            手动建档
            {activeTab === 'manual' && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-[2px] bg-[#B43B2B]"
              />
            )}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {activeTab === 'online' ? (
            <div>
              {/* Category + Source controls */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div
                  role="group"
                  aria-label="检索类别"
                  className="flex items-center gap-1 rounded-md bg-[#ECE8DF] p-1"
                >
                  {(['film', 'person', 'character'] as ArchiveCategory[]).map(
                    (cat) => (
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
                        {CATEGORY_LABELS[cat]}
                      </button>
                    )
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="online-source-select"
                    className="text-xs text-[#625C54] whitespace-nowrap"
                  >
                    数据源
                  </label>
                  <select
                    id="online-source-select"
                    value={source}
                    onChange={(e) =>
                      setSource(e.target.value as SearchSourceOption)
                    }
                    className="h-9 rounded-md border border-[#DCD6CB] bg-white px-3 text-xs text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  >
                    {SOURCE_OPTIONS.filter(
                      (opt) =>
                        !(category === 'character' && opt.id === 'itunes')
                    ).map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Search Input Form */}
              <form
                onSubmit={handleSearchSubmit}
                className="mt-4 flex flex-col gap-2.5 sm:flex-row"
              >
                <div className="relative flex-1">
                  <label htmlFor="online-search-input" className="sr-only">
                    联网检索关键词
                  </label>
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C857B]"
                    aria-hidden="true"
                  />
                  <input
                    id="online-search-input"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (searchError) setSearchError('');
                    }}
                    placeholder={
                      category === 'film'
                        ? '输入电影、剧集或动画名称，例如：重庆森林、盗梦空间…'
                        : category === 'person'
                          ? '输入导演、演员或声优姓名，例如：宫崎骏、张曼玉…'
                          : '输入影视或动画角色名，例如：甄嬛、绫波丽、小丑…'
                    }
                    className="h-11 w-full rounded-md border border-[#DCD6CB] bg-white pl-10 pr-4 text-sm text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1A1816] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#B43B2B] px-5 text-sm font-medium text-white whitespace-nowrap shrink-0 cursor-pointer transition-colors hover:bg-[#932D20] disabled:opacity-60"
                >
                  {loading && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  直连搜索
                </button>
              </form>

              {/* Quick Suggestions */}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[#7A7268]">
                <span>试试搜索：</span>
                {PRESETS[category].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setSearchQuery(preset);
                      void executeOnlineSearch(preset, category, source);
                    }}
                    className="underline decoration-[#D2C9BA] underline-offset-4 hover:text-[#B43B2B] hover:decoration-[#B43B2B] cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>

              {/* Error State */}
              {searchError && (
                <div
                  role="alert"
                  className="mt-4 flex items-center justify-between gap-4 border border-[#E5BFB9] bg-[#FDF4F2] px-4 py-3 text-xs text-[#932D20]"
                >
                  <span>{searchError}</span>
                  {searchQuery.trim() && (
                    <button
                      type="button"
                      onClick={() =>
                        void executeOnlineSearch(searchQuery, category, source)
                      }
                      className="font-medium underline underline-offset-2 whitespace-nowrap cursor-pointer"
                    >
                      重试
                    </button>
                  )}
                </div>
              )}

              {/* Loading Skeleton */}
              {loading && (
                <div className="mt-6 space-y-4" aria-label="正在联网检索">
                  {[0, 1, 2].map((idx) => (
                    <div
                      key={idx}
                      className="flex gap-4 border border-[#E4DFD5] bg-white p-4 animate-pulse"
                    >
                      <div className="h-24 w-18 shrink-0 bg-[#EAE4D9]" />
                      <div className="flex-1 space-y-2.5 py-1">
                        <div className="h-4 w-1/3 bg-[#EAE4D9]" />
                        <div className="h-3 w-1/2 bg-[#F1ECE3]" />
                        <div className="h-3 w-5/6 bg-[#F1ECE3]" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Results List */}
              {!loading && hasSearched && results.length > 0 && (
                <div className="mt-6">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#625C54]">
                    <span className="tabular-nums">
                      共直连检索到 {results.length} 条公开档案
                    </span>
                    {activeSources.length > 0 && (
                      <span>来源：{activeSources.join(' · ')}</span>
                    )}
                  </div>

                  <ul className="divide-y divide-[#E4DFD5] border border-[#E4DFD5] bg-white">
                    {results.map((resItem) => {
                      const collected = isAlreadyCollected(
                        existingItems,
                        resItem.category,
                        resItem.title
                      );
                      const isCollecting = collectingId === resItem.externalId;

                      return (
                        <li
                          key={resItem.externalId}
                          className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start"
                        >
                          <ArchivalImage
                            src={resItem.coverUrl}
                            alt={resItem.title}
                            title={resItem.title}
                            category={resItem.category}
                            compact
                            className="h-28 w-21 shrink-0 border border-[#EAE4D9]"
                          />

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <h3 className="font-editorial text-lg font-semibold text-[#1A1816]">
                                {resItem.title}
                              </h3>
                              {resItem.originalTitle && (
                                <span className="text-xs text-[#7A7268]">
                                  {resItem.originalTitle}
                                </span>
                              )}
                            </div>

                            <p className="mt-1 text-xs text-[#625C54]">
                              {[
                                CATEGORY_LABELS[resItem.category],
                                resItem.year,
                                resItem.subtitle,
                                resItem.sourceName,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>

                            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#4B453E]">
                              {resItem.summary}
                            </p>
                          </div>

                          <div className="shrink-0 sm:self-center">
                            {collected ? (
                              <span className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-[#D4DFD7] bg-[#F2F7F4] px-3.5 py-2 text-xs font-medium text-[#2A6B46] whitespace-nowrap">
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                已在藏馆
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={isCollecting}
                                onClick={() => handleCollect(resItem)}
                                aria-label={`收录「${resItem.title}」到藏馆`}
                                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-[#1A1816] px-4 py-2 text-xs font-medium text-white whitespace-nowrap cursor-pointer transition-colors hover:bg-[#B43B2B] disabled:opacity-60"
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

              {/* Empty Search Results */}
              {!loading && hasSearched && results.length === 0 && !searchError && (
                <div className="mt-6 border border-[#E4DFD5] bg-white px-6 py-10 text-center">
                  <p className="font-editorial text-lg text-[#1A1816]">
                    未检索到与「{searchQuery}」匹配的公开条目
                  </p>
                  <p className="mt-2 text-xs text-[#625C54]">
                    可以尝试更换中英文关键词、切换检索类别，或直接转为手动建档。
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setTitle(searchQuery.trim());
                      setManualCategory(category);
                      setActiveTab('manual');
                    }}
                    className="mt-4 min-h-[38px] rounded-md border border-[#1A1816] bg-white px-4 py-1.5 text-xs font-medium text-[#1A1816] cursor-pointer hover:bg-[#1A1816] hover:text-white transition-colors"
                  >
                    以「{searchQuery.trim()}」手动建档
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Manual Creation Form */
            <form onSubmit={handleManualSubmit} noValidate className="space-y-4">
              <div>
                <span className="block text-xs font-medium text-[#4B453E]">
                  建档分类
                </span>
                <div className="mt-1.5 flex gap-1.5">
                  {(['film', 'person', 'character'] as ArchiveCategory[]).map(
                    (cat) => (
                      <button
                        key={cat}
                        type="button"
                        aria-pressed={manualCategory === cat}
                        onClick={() => setManualCategory(cat)}
                        className={`min-h-[36px] rounded px-4 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                          manualCategory === cat
                            ? 'bg-[#1A1816] text-white'
                            : 'border border-[#DCD6CB] bg-white text-[#4B453E] hover:border-[#1A1816]'
                        }`}
                      >
                        {CATEGORY_LABELS[cat]}
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="manual-title"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    名称 / 片名 <span className="text-[#B43B2B]">*</span>
                  </label>
                  <input
                    id="manual-title"
                    type="text"
                    required
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      if (formErrors.title) {
                        setFormErrors((prev) => ({ ...prev, title: undefined }));
                      }
                    }}
                    placeholder={
                      manualCategory === 'film'
                        ? '例如：重庆森林'
                        : manualCategory === 'person'
                          ? '例如：张国荣'
                          : '例如：甄嬛'
                    }
                    className={`mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm text-[#1A1816] focus:outline-none ${
                      formErrors.title
                        ? 'border-[#B43B2B]'
                        : 'border-[#DCD6CB] focus:border-[#1A1816]'
                    }`}
                  />
                  {formErrors.title && (
                    <p role="alert" className="mt-1 text-xs text-[#B43B2B]">
                      {formErrors.title}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="manual-original-title"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    原名 / 外文名（选填）
                  </label>
                  <input
                    id="manual-original-title"
                    type="text"
                    value={originalTitle}
                    onChange={(e) => setOriginalTitle(e.target.value)}
                    placeholder="例如：Chungking Express"
                    className="mt-1.5 h-10 w-full rounded-md border border-[#DCD6CB] bg-white px-3 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="manual-subtitle"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    {manualCategory === 'film'
                      ? '导演 / 类型'
                      : manualCategory === 'person'
                        ? '职业身份'
                        : '角色身份'}
                  </label>
                  <input
                    id="manual-subtitle"
                    type="text"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    placeholder={
                      manualCategory === 'film'
                        ? '王家卫 · 剧情 / 爱情'
                        : manualCategory === 'person'
                          ? '演员 · 歌手'
                          : '女主角 · 后宫传奇'
                    }
                    className="mt-1.5 h-10 w-full rounded-md border border-[#DCD6CB] bg-white px-3 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="manual-year"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    年份（4位数字）
                  </label>
                  <input
                    id="manual-year"
                    type="text"
                    value={year}
                    onChange={(e) => {
                      setYear(e.target.value);
                      if (formErrors.year) {
                        setFormErrors((prev) => ({ ...prev, year: undefined }));
                      }
                    }}
                    placeholder="例如：2011"
                    className={`mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-sm font-mono text-[#1A1816] focus:outline-none ${
                      formErrors.year
                        ? 'border-[#B43B2B]'
                        : 'border-[#DCD6CB] focus:border-[#1A1816]'
                    }`}
                  />
                  {formErrors.year && (
                    <p role="alert" className="mt-1 text-xs text-[#B43B2B]">
                      {formErrors.year}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="manual-region"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    国家 / 地区
                  </label>
                  <input
                    id="manual-region"
                    type="text"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="例如：中国大陆"
                    className="mt-1.5 h-10 w-full rounded-md border border-[#DCD6CB] bg-white px-3 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="manual-work"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    {manualCategory === 'character'
                      ? '出处影视作品'
                      : manualCategory === 'person'
                        ? '代表作品'
                        : '主演 / 主创'}
                  </label>
                  <input
                    id="manual-work"
                    type="text"
                    value={relatedWorkTitle}
                    onChange={(e) => setRelatedWorkTitle(e.target.value)}
                    placeholder={
                      manualCategory === 'character' ? '例如：甄嬛传' : '选填'
                    }
                    className="mt-1.5 h-10 w-full rounded-md border border-[#DCD6CB] bg-white px-3 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  />
                </div>

                {manualCategory === 'character' ? (
                  <div>
                    <label
                      htmlFor="manual-actor"
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      饰演演员 / 声优
                    </label>
                    <input
                      id="manual-actor"
                      type="text"
                      value={portrayedBy}
                      onChange={(e) => setPortrayedBy(e.target.value)}
                      placeholder="例如：孙俪"
                      className="mt-1.5 h-10 w-full rounded-md border border-[#DCD6CB] bg-white px-3 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                    />
                  </div>
                ) : (
                  <div>
                    <label
                      htmlFor="manual-tags"
                      className="block text-xs font-medium text-[#4B453E]"
                    >
                      标签（顿号或逗号分隔）
                    </label>
                    <input
                      id="manual-tags"
                      type="text"
                      value={tagsText}
                      onChange={(e) => setTagsText(e.target.value)}
                      placeholder="例如：经典、重刷、心头好"
                      className="mt-1.5 h-10 w-full rounded-md border border-[#DCD6CB] bg-white px-3 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {manualCategory === 'character' && (
                <div>
                  <label
                    htmlFor="manual-tags-char"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    角色标签（顿号或逗号分隔）
                  </label>
                  <input
                    id="manual-tags-char"
                    type="text"
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="例如：清醒独立、大女主、古装经典"
                    className="mt-1.5 h-10 w-full rounded-md border border-[#DCD6CB] bg-white px-3 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label
                  htmlFor="manual-cover"
                  className="block text-xs font-medium text-[#4B453E]"
                >
                  海报 / 剧照链接（选填，留空将生成典藏字标封面）
                </label>
                <input
                  id="manual-cover"
                  type="text"
                  value={coverUrl}
                  onChange={(e) => {
                    setCoverUrl(e.target.value);
                    if (formErrors.coverUrl) {
                      setFormErrors((prev) => ({
                        ...prev,
                        coverUrl: undefined,
                      }));
                    }
                  }}
                  placeholder="https://..."
                  className={`mt-1.5 h-10 w-full rounded-md border bg-white px-3 text-xs font-mono text-[#1A1816] focus:outline-none ${
                    formErrors.coverUrl
                      ? 'border-[#B43B2B]'
                      : 'border-[#DCD6CB] focus:border-[#1A1816]'
                  }`}
                />
                {formErrors.coverUrl && (
                  <p role="alert" className="mt-1 text-xs text-[#B43B2B]">
                    {formErrors.coverUrl}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="manual-status"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    收藏状态
                  </label>
                  <select
                    id="manual-status"
                    value={status}
                    onChange={(e) =>
                      setStatus(e.target.value as CollectionStatus)
                    }
                    className="mt-1.5 h-10 w-full rounded-md border border-[#DCD6CB] bg-white px-3 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  >
                    {(['favorite', 'watched', 'watching', 'watchlist'] as CollectionStatus[]).map(
                      (st) => (
                        <option key={st} value={st}>
                          {getStatusLabel(st, manualCategory)}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="manual-rating"
                    className="block text-xs font-medium text-[#4B453E]"
                  >
                    个人评分（0–5 星）
                  </label>
                  <select
                    id="manual-rating"
                    value={rating}
                    onChange={(e) => setRating(Number(e.target.value))}
                    className="mt-1.5 h-10 w-full rounded-md border border-[#DCD6CB] bg-white px-3 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                  >
                    <option value={5}>5 星 · 强烈推荐</option>
                    <option value={4}>4 星 · 非常喜欢</option>
                    <option value={3}>3 星 · 值得一看</option>
                    <option value={2}>2 星 · 一般</option>
                    <option value={1}>1 星 · 较差</option>
                    <option value={0}>暂不评分</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="manual-quote"
                  className="block text-xs font-medium text-[#4B453E]"
                >
                  经典台词 / 语录（选填）
                </label>
                <input
                  id="manual-quote"
                  type="text"
                  value={quote}
                  onChange={(e) => setQuote(e.target.value)}
                  placeholder="例如：逆风如解意，容易莫摧残。"
                  className="mt-1.5 h-10 w-full rounded-md border border-[#DCD6CB] bg-white px-3 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="manual-summary"
                  className="block text-xs font-medium text-[#4B453E]"
                >
                  档案简介（选填）
                </label>
                <textarea
                  id="manual-summary"
                  rows={2}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="简要介绍剧情、履历或角色背景…"
                  className="mt-1.5 w-full rounded-md border border-[#DCD6CB] bg-white px-3 py-2 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="manual-notes"
                  className="block text-xs font-medium text-[#4B453E]"
                >
                  个人手记（选填）
                </label>
                <textarea
                  id="manual-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="写下你的私藏评价或感动瞬间…"
                  className="mt-1.5 w-full rounded-md border border-[#DCD6CB] bg-white px-3 py-2 text-sm text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
                />
              </div>

              {existingItems.length > 0 && (
                <div>
                  <span className="block text-xs font-medium text-[#4B453E]">
                    关联已有藏品（选填，可多选）
                  </span>
                  <div className="mt-1.5 flex max-h-28 flex-wrap gap-x-4 gap-y-2 overflow-y-auto border border-[#E4DFD5] bg-white p-3">
                    {existingItems.map((ex) => (
                      <label
                        key={ex.id}
                        className="inline-flex items-center gap-1.5 text-xs text-[#2E2A26] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedRelatedIds.includes(ex.id)}
                          onChange={() => toggleManualRelated(ex.id)}
                          className="accent-[#B43B2B]"
                        />
                        <span>
                          [{CATEGORY_LABELS[ex.category]}] {ex.title}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-[#E4DFD5] pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[40px] rounded-md border border-[#DCD6CB] bg-white px-4 py-2 text-sm text-[#4B453E] cursor-pointer hover:border-[#1A1816]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submittingManual}
                  className="min-h-[40px] rounded-md bg-[#B43B2B] px-5 py-2 text-sm font-medium text-white cursor-pointer transition-colors hover:bg-[#932D20] disabled:opacity-50"
                >
                  {submittingManual ? '建档中…' : '确认建档'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
