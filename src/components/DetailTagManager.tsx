import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Filter, Plus, Tag, X } from 'lucide-react';
import type { ArchiveItem } from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import {
  addTagToList,
  collectTagRegistry,
  getItemsByTag,
  getTagAutocompleteSuggestions,
  MAX_TAGS_PER_ITEM,
  normalizeTagName,
  removeTagFromList,
  tagKey,
} from '../utils/tags';
import { ArchivalImage } from './ArchivalImage';

interface DetailTagManagerProps {
  item: ArchiveItem;
  allItems: ArchiveItem[];
  onUpdateTags: (nextTags: string[]) => Promise<void>;
  onFilterByTag: (tag: string, focusItemId?: string) => void;
  onSelectRelated: (target: ArchiveItem) => void;
}

function HighlightedTagLabel({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const cleanQuery = normalizeTagName(query);
  if (!cleanQuery) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(cleanQuery.toLowerCase());
  if (idx < 0) return <>{text}</>;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + cleanQuery.length);
  const after = text.slice(idx + cleanQuery.length);
  return (
    <>
      {before}
      <mark className="bg-transparent font-semibold text-[#B43B2B] dark:text-[#F28C7B]">
        {match}
      </mark>
      {after}
    </>
  );
}

export function DetailTagManager({
  item,
  allItems,
  onUpdateTags,
  onFilterByTag,
  onSelectRelated,
}: DetailTagManagerProps) {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const [inspectingTag, setInspectingTag] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);

  // Reset transient UI state when switching to another archive item
  useEffect(() => {
    setInputValue('');
    setIsFocused(false);
    setHighlightedIdx(-1);
    setInspectingTag(null);
    setFeedback('');
  }, [item.id]);

  // Auto-clear brief status feedback
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 2400);
    return () => clearTimeout(timer);
  }, [feedback]);

  // Close suggestion panel when tapping outside
  useEffect(() => {
    if (!isFocused) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsFocused(false);
        setHighlightedIdx(-1);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isFocused]);

  const registry = useMemo(() => collectTagRegistry(allItems), [allItems]);

  const tagCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of registry) {
      map.set(tagKey(entry.name), entry.count);
    }
    return map;
  }, [registry]);

  const suggestions = useMemo(
    () => getTagAutocompleteSuggestions(inputValue, item.tags, registry, 6),
    [inputValue, item.tags, registry]
  );

  const quickPickTags = useMemo(
    () => getTagAutocompleteSuggestions('', item.tags, registry, 6),
    [item.tags, registry]
  );

  const normalizedInput = normalizeTagName(inputValue);
  const isAlreadyOnItem =
    normalizedInput.length > 0 &&
    item.tags.some((t) => tagKey(t) === normalizedInput.toLowerCase());
  const hasExactSuggestion =
    normalizedInput.length > 0 &&
    suggestions.some(
      (s) => s.name.toLowerCase() === normalizedInput.toLowerCase()
    );
  const canCreateNew =
    normalizedInput.length > 0 &&
    !isAlreadyOnItem &&
    !hasExactSuggestion &&
    !inputValue.includes('、') &&
    !inputValue.includes(',') &&
    !inputValue.includes('，') &&
    item.tags.length < MAX_TAGS_PER_ITEM;

  const showSuggestions =
    isFocused &&
    (suggestions.length > 0 || canCreateNew || isAlreadyOnItem);

  const activeInspectTag =
    inspectingTag &&
    item.tags.some((t) => tagKey(t) === tagKey(inspectingTag))
      ? inspectingTag
      : null;

  const sameTagItems = useMemo(() => {
    if (!activeInspectTag) return [];
    return getItemsByTag(allItems, activeInspectTag);
  }, [allItems, activeInspectTag]);

  const commitAddTag = async (rawValue: string) => {
    if (busy) return;
    const result = addTagToList(item.tags, rawValue, MAX_TAGS_PER_ITEM);
    if (result.added.length === 0) {
      if (result.duplicate) {
        setFeedback(`标签「${result.duplicate}」已存在`);
      } else if (result.limitReached) {
        setFeedback(`最多可添加 ${MAX_TAGS_PER_ITEM} 个标签`);
      }
      return;
    }

    setBusy(true);
    try {
      await onUpdateTags(result.tags);
      setInputValue('');
      setIsFocused(false);
      setHighlightedIdx(-1);
      setFeedback(
        result.added.length === 1
          ? `已添加标签「${result.added[0]}」`
          : `已添加 ${result.added.length} 个标签`
      );
    } finally {
      setBusy(false);
    }
  };

  const commitRemoveTag = async (tag: string) => {
    if (busy) return;
    const nextTags = removeTagFromList(item.tags, tag);
    if (activeInspectTag && tagKey(activeInspectTag) === tagKey(tag)) {
      setInspectingTag(null);
    }
    setBusy(true);
    try {
      await onUpdateTags(nextTags);
      setFeedback(`已移除标签「${tag}」`);
    } finally {
      setBusy(false);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const totalOptions = suggestions.length + (canCreateNew ? 1 : 0);

    if (e.key === 'ArrowDown') {
      if (totalOptions === 0) return;
      e.preventDefault();
      setIsFocused(true);
      setHighlightedIdx((prev) => (prev + 1) % totalOptions);
      return;
    }

    if (e.key === 'ArrowUp') {
      if (totalOptions === 0) return;
      e.preventDefault();
      setIsFocused(true);
      setHighlightedIdx((prev) =>
        prev <= 0 ? totalOptions - 1 : prev - 1
      );
      return;
    }

    if (e.key === 'Escape' && isFocused) {
      e.preventDefault();
      e.stopPropagation();
      setIsFocused(false);
      setHighlightedIdx(-1);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIdx >= 0 && highlightedIdx < suggestions.length) {
        void commitAddTag(suggestions[highlightedIdx].name);
      } else if (
        canCreateNew &&
        highlightedIdx === suggestions.length
      ) {
        void commitAddTag(normalizedInput);
      } else if (normalizedInput) {
        void commitAddTag(inputValue);
      }
    }
  };

  return (
    <section
      ref={containerRef}
      aria-label="档案标签管理"
      data-testid="detail-tag-manager"
      className="mt-6 rounded-2xl border border-[#E4DFD5] bg-white p-3.5 sm:p-4 dark:border-[#322D27] dark:bg-[#1D1A17]"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-[#7A7268] md:h-3.5 md:w-3.5 dark:text-[#A59D90]" aria-hidden="true" />
          <h3 className="text-[14px] font-medium tracking-[0.04em] text-[#1A1816] md:text-xs md:tracking-[0.06em] dark:text-[#F3EFE6]">
            标签管理
          </h3>
          <span className="font-mono text-[12px] tabular-nums text-[#8C857B] md:text-[11px] dark:text-[#9A9184]">
            {item.tags.length} / {MAX_TAGS_PER_ITEM}
          </span>
        </div>
        {feedback && (
          <span
            role="status"
            aria-live="polite"
            className="text-[12px] font-medium text-[#2A6B46] md:text-[11px] dark:text-[#6CC492]"
          >
            {feedback}
          </span>
        )}
      </div>

      {/* Attached Tags */}
      {item.tags.length > 0 ? (
        <>
          <div
            className="mt-3 flex flex-wrap gap-2"
            data-testid="detail-attached-tags"
          >
            {item.tags.map((tag) => {
              const count = tagCountMap.get(tagKey(tag)) ?? 1;
              const isInspecting =
                activeInspectTag !== null &&
                tagKey(activeInspectTag) === tagKey(tag);

              return (
                <div
                  key={tag}
                  className={`inline-flex items-stretch overflow-hidden rounded-xl border transition-colors ${
                    isInspecting
                      ? 'border-[#1A1816] bg-[#1A1816] text-white dark:border-[#F3EFE6] dark:bg-[#F3EFE6] dark:text-[#141210]'
                      : 'border-[#DCD6CB] bg-[#FAF9F6] text-[#1A1816] dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6]'
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={isInspecting}
                    aria-label={`查看标签「${tag}」下的 ${count} 项馆藏`}
                    onClick={() => {
                      setIsFocused(false);
                      setHighlightedIdx(-1);
                      setInspectingTag(isInspecting ? null : tag);
                    }}
                    className={`inline-flex min-h-[42px] items-center gap-1.5 px-3 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[40px] md:text-xs ${
                      isInspecting
                        ? 'text-white dark:text-[#141210]'
                        : 'text-[#1A1816] hover:bg-[#F0EBE1] dark:text-[#F3EFE6] dark:hover:bg-[#2E2923]'
                    }`}
                  >
                    <span>{tag}</span>
                    <span
                      className={`font-mono text-[12px] tabular-nums md:text-[11px] ${
                        isInspecting
                          ? 'text-white/75 dark:text-[#141210]/70'
                          : 'text-[#7A7268] dark:text-[#9E9588]'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`移除标签「${tag}」`}
                    onClick={() => void commitRemoveTag(tag)}
                    className={`flex min-h-[42px] min-w-[38px] items-center justify-center border-l cursor-pointer transition-colors disabled:opacity-40 md:min-h-[40px] md:min-w-[36px] ${
                      isInspecting
                        ? 'border-white/20 text-white/80 hover:bg-white/10 hover:text-white dark:border-[#141210]/15 dark:text-[#141210]/70 dark:hover:bg-[#141210]/10 dark:hover:text-[#141210]'
                        : 'border-[#E4DFD5] text-[#8C857B] hover:bg-[#EFE9DF] hover:text-[#B43B2B] dark:border-[#3A342D] dark:text-[#9A9184] dark:hover:bg-[#312B25] dark:hover:text-[#F28C7B]'
                    }`}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
          {!activeInspectTag && (
            <p className="mt-2 text-[12px] text-[#8C857B] md:text-[11px] dark:text-[#9A9184]">
              点击任意标签可查看或一键筛选同标签下的全部馆藏
            </p>
          )}
        </>
      ) : (
        <p className="mt-2.5 text-[13px] leading-relaxed text-[#7A7268] md:text-xs dark:text-[#A59D90]">
          暂无标签。在下方输入关键词可自动补全馆内已有标签，或直接创建新标签。
        </p>
      )}

      {/* Inline Same-Tag Collection Explorer */}
      {activeInspectTag && (
        <div
          data-testid="same-tag-panel"
          className="mt-3.5 border-t border-[#EFECE5] pt-3.5 dark:border-[#2E2924]"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-medium text-[#1A1816] dark:text-[#F3EFE6]">
              同标签「{activeInspectTag}」
              <span className="ml-1 font-mono text-[11px] tabular-nums text-[#7A7268] dark:text-[#A59D90]">
                共 {sameTagItems.length} 项
              </span>
            </p>
            <button
              type="button"
              onClick={() => onFilterByTag(activeInspectTag, item.id)}
              aria-label={`跳转到标签「${activeInspectTag}」图鉴列表并选中「${item.title}」`}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl bg-[#B43B2B] px-3 text-xs font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.97] transition-transform hover:bg-[#932D20]"
            >
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              <span>跳转并选中</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <ul className="mt-2.5 divide-y divide-[#F0EBE2] dark:divide-[#2E2924]">
            {sameTagItems.slice(0, 6).map((match) => {
              const isCurrent = match.id === item.id;
              return (
                <li key={match.id} className="py-1.5 first:pt-0 last:pb-0">
                  {isCurrent ? (
                    <div className="flex items-center gap-2.5 py-1 opacity-75">
                      <ArchivalImage
                        src={match.coverUrl}
                        alt={match.title}
                        title={match.title}
                        category={match.category}
                        compact
                        className="h-11 w-9 shrink-0 rounded-lg"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-editorial text-sm font-medium text-[#1A1816] dark:text-[#F3EFE6]">
                          {match.title}
                        </p>
                        <p className="text-[11px] text-[#7A7268] dark:text-[#A59D90]">
                          {CATEGORY_LABELS[match.category]}
                          {match.year ? ` · ${match.year}` : ''} · 当前档案
                        </p>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectRelated(match)}
                      aria-label={`跳转查看同标签${CATEGORY_LABELS[match.category]}「${match.title}」`}
                      className="flex min-h-[48px] w-full items-center gap-2.5 rounded-xl px-1.5 py-1 text-left transition-colors hover:bg-[#FAF9F6] cursor-pointer dark:hover:bg-[#26221D]"
                    >
                      <ArchivalImage
                        src={match.coverUrl}
                        alt={match.title}
                        title={match.title}
                        category={match.category}
                        compact
                        className="h-11 w-9 shrink-0 rounded-lg"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-editorial text-sm font-medium text-[#1A1816] dark:text-[#F3EFE6]">
                          {match.title}
                        </p>
                        <p className="truncate text-[11px] text-[#7A7268] dark:text-[#A59D90]">
                          {CATEGORY_LABELS[match.category]}
                          {match.year ? ` · ${match.year}` : ''}
                          {match.subtitle &&
                          match.subtitle !== CATEGORY_LABELS[match.category]
                            ? ` · ${match.subtitle}`
                            : ''}
                        </p>
                      </div>
                      <ArrowRight
                        className="h-3.5 w-3.5 shrink-0 text-[#8C857B] dark:text-[#9A9184]"
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {sameTagItems.length > 6 && (
            <button
              type="button"
              onClick={() => onFilterByTag(activeInspectTag, item.id)}
              className="mt-2 min-h-[40px] w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] text-xs font-medium text-[#3D3832] cursor-pointer dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#E5DED2]"
            >
              查看全部 {sameTagItems.length} 项同标签藏品
            </button>
          )}
        </div>
      )}

      {/* Add Tag Input + Live Autocomplete */}
      <div className="mt-3.5 border-t border-[#EFECE5] pt-3.5 dark:border-[#2E2924]">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="detail-tag-input" className="sr-only">
              添加或自动补全标签
            </label>
            <input
              id="detail-tag-input"
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSuggestions}
              aria-controls="detail-tag-suggestions"
              disabled={busy || item.tags.length >= MAX_TAGS_PER_ITEM}
              value={inputValue}
              onFocus={() => setIsFocused(true)}
              onChange={(e) => {
                setInputValue(e.target.value);
                setIsFocused(true);
                setHighlightedIdx(-1);
              }}
              onKeyDown={handleInputKeyDown}
              placeholder={
                item.tags.length >= MAX_TAGS_PER_ITEM
                  ? `已达 ${MAX_TAGS_PER_ITEM} 个标签上限`
                  : '输入或选择已有标签…'
              }
              className="h-12 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 text-[16px] text-[#1A1816] placeholder:text-[#8C857B] focus:border-[#1A1816] focus:bg-white focus:outline-none disabled:opacity-50 md:h-11 md:text-sm dark:border-[#3A342D] dark:bg-[#181512] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A] dark:focus:bg-[#1D1A17]"
            />
          </div>
          <button
            type="button"
            disabled={
              busy ||
              !normalizedInput ||
              item.tags.length >= MAX_TAGS_PER_ITEM
            }
            onClick={() => void commitAddTag(inputValue)}
            className="inline-flex h-12 shrink-0 items-center gap-1 rounded-xl bg-[#1A1816] px-4 text-[14px] font-medium text-white whitespace-nowrap cursor-pointer active:scale-[0.97] transition-transform hover:bg-[#B43B2B] disabled:opacity-40 md:h-11 md:px-3.5 md:text-xs dark:bg-[#F3EFE6] dark:text-[#141210] dark:hover:bg-[#E4C37A]"
          >
            <Plus className="h-4 w-4 md:h-3.5 md:w-3.5" aria-hidden="true" />
            <span>添加</span>
          </button>
        </div>

        {/* In-flow Autocomplete List (never clipped by mobile keyboard or bottom sheet scroll) */}
        {showSuggestions && (
          <div
            id="detail-tag-suggestions"
            role="listbox"
            aria-label="已有标签补全建议"
            data-testid="tag-autocomplete-list"
            className="mt-2 overflow-hidden rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] dark:border-[#3A342D] dark:bg-[#231F1B]"
          >
            <div className="flex items-center justify-between border-b border-[#EAE4D9] px-3 py-2 text-[12px] text-[#7A7268] md:py-1.5 md:text-[11px] dark:border-[#322D27] dark:text-[#A59D90]">
              <span>
                {normalizedInput ? '匹配的已有标签' : '馆内已有标签（点击补全）'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsFocused(false);
                  setHighlightedIdx(-1);
                }}
                className="text-[12px] text-[#625C54] hover:text-[#1A1816] cursor-pointer md:text-[11px] dark:text-[#B8AFA2] dark:hover:text-[#F3EFE6]"
              >
                收起
              </button>
            </div>

            <div className="divide-y divide-[#ECE7DD] dark:divide-[#2E2924]">
              {suggestions.map((sug, idx) => {
                const isHighlighted = idx === highlightedIdx;
                return (
                  <button
                    key={sug.name}
                    type="button"
                    role="option"
                    aria-selected={isHighlighted}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void commitAddTag(sug.name)}
                    className={`flex min-h-[46px] w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-[14px] transition-colors cursor-pointer md:min-h-[44px] md:text-xs ${
                      isHighlighted
                        ? 'bg-[#EFE9DF] text-[#1A1816] dark:bg-[#312B24] dark:text-[#FAF7F0]'
                        : 'hover:bg-[#F3EFE8] text-[#1A1816] dark:text-[#F3EFE6] dark:hover:bg-[#2A2520]'
                    }`}
                  >
                    <span className="truncate font-medium">
                      <HighlightedTagLabel
                        text={sug.name}
                        query={inputValue}
                      />
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[12px] tabular-nums text-[#7A7268] md:text-[11px] dark:text-[#A59D90]">
                      <span>已有 {sug.count} 项</span>
                      <Plus
                        className="h-3.5 w-3.5 text-[#625C54] dark:text-[#B8AFA2]"
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                );
              })}

              {canCreateNew && (
                <button
                  type="button"
                  role="option"
                  aria-selected={highlightedIdx === suggestions.length}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void commitAddTag(normalizedInput)}
                  className={`flex min-h-[46px] w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-[14px] transition-colors cursor-pointer md:min-h-[44px] md:text-xs ${
                    highlightedIdx === suggestions.length
                      ? 'bg-[#EFE9DF] text-[#1A1816] dark:bg-[#312B24] dark:text-[#FAF7F0]'
                      : 'hover:bg-[#F3EFE8] text-[#1A1816] dark:text-[#F3EFE6] dark:hover:bg-[#2A2520]'
                  }`}
                >
                  <span className="truncate font-medium">
                    新建标签「{normalizedInput}」
                  </span>
                  <span className="shrink-0 text-[12px] font-medium text-[#B43B2B] md:text-[11px] dark:text-[#F28C7B]">
                    立即创建
                  </span>
                </button>
              )}

              {isAlreadyOnItem && suggestions.length === 0 && (
                <p className="px-3.5 py-2.5 text-[13px] text-[#7A7268] md:text-xs dark:text-[#A59D90]">
                  此档案已包含标签「{normalizedInput}」
                </p>
              )}
            </div>
          </div>
        )}

        {/* Quick-Pick Existing Collection Tags (One-tap on mobile without opening keyboard) */}
        {!showSuggestions &&
          quickPickTags.length > 0 &&
          item.tags.length < MAX_TAGS_PER_ITEM && (
            <div className="mt-2.5">
              <p className="text-[12px] text-[#8C857B] md:text-[11px] dark:text-[#9A9184]">
                快速添加馆内已有标签：
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {quickPickTags.map((sug) => (
                  <button
                    key={sug.name}
                    type="button"
                    disabled={busy}
                    onClick={() => void commitAddTag(sug.name)}
                    aria-label={`快速添加已有标签「${sug.name}」`}
                    className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-dashed border-[#D3CCC0] bg-[#FAF9F6] px-2.5 text-[13px] text-[#4B453E] whitespace-nowrap cursor-pointer transition-colors hover:border-[#1A1816] hover:bg-white hover:text-[#1A1816] disabled:opacity-40 md:min-h-[36px] md:text-xs dark:border-[#433C34] dark:bg-[#24201C] dark:text-[#C4BCB0] dark:hover:border-[#D4AF6A] dark:hover:bg-[#2C2721] dark:hover:text-[#F3EFE6]"
                  >
                    <Plus className="h-3 w-3 text-[#8C857B] dark:text-[#9A9184]" aria-hidden="true" />
                    <span>{sug.name}</span>
                    <span className="font-mono text-[11px] tabular-nums text-[#8C857B] md:text-[10px] dark:text-[#9A9184]">
                      {sug.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
      </div>
    </section>
  );
}
