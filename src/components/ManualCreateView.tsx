import { useEffect, useMemo, useState } from 'react';
import { Link2, Sparkles, Star } from 'lucide-react';
import type {
  ArchiveCategory,
  ArchiveDraftInput,
  ArchiveItem,
  CollectionStatus,
  ValidationErrors,
} from '../types/archive';
import {
  CATEGORY_LABELS,
  getStatusLabel,
  hasValidationErrors,
  parseTagsInput,
  validateArchiveInput,
} from '../utils/archive';
import { findDraftLinkRecommendations } from '../utils/smartLink';

interface ManualCreateViewProps {
  existingItems: ArchiveItem[];
  initialTitle?: string;
  initialCategory?: ArchiveCategory;
  initialRelatedIds?: string[];
  initialRelatedWorkTitle?: string;
  onConsumePrefill?: () => void;
  onCreateItem: (draft: ArchiveDraftInput) => Promise<void>;
}

const STATUS_LIST: CollectionStatus[] = [
  'favorite',
  'watched',
  'watching',
  'watchlist',
];

export function ManualCreateView({
  existingItems,
  initialTitle = '',
  initialCategory = 'film',
  initialRelatedIds = [],
  initialRelatedWorkTitle = '',
  onConsumePrefill,
  onCreateItem,
}: ManualCreateViewProps) {
  const [category, setCategory] = useState<ArchiveCategory>(initialCategory);
  const [title, setTitle] = useState(initialTitle);
  const [originalTitle, setOriginalTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [year, setYear] = useState('');
  const [region, setRegion] = useState('');
  const [relatedWorkTitle, setRelatedWorkTitle] = useState(initialRelatedWorkTitle);
  const [portrayedBy, setPortrayedBy] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [quote, setQuote] = useState('');
  const [summary, setSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [rating, setRating] = useState(5);
  const [status, setStatus] = useState<CollectionStatus>('favorite');
  const [selectedRelatedIds, setSelectedRelatedIds] =
    useState<string[]>(initialRelatedIds);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const prefillRelatedKey = initialRelatedIds.join(',');

  useEffect(() => {
    setCategory(initialCategory);
    let consumed = false;
    if (initialTitle) {
      setTitle(initialTitle);
      consumed = true;
    }
    if (initialRelatedWorkTitle) {
      setRelatedWorkTitle(initialRelatedWorkTitle);
      consumed = true;
    }
    if (initialRelatedIds.length > 0) {
      setSelectedRelatedIds(initialRelatedIds);
      consumed = true;
    }
    if (consumed) {
      onConsumePrefill?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTitle, initialCategory, initialRelatedWorkTitle, prefillRelatedKey]);

  const toggleRelated = (id: string) => {
    setSelectedRelatedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const liveRecommendations = useMemo(
    () =>
      findDraftLinkRecommendations(
        {
          title,
          originalTitle,
          subtitle,
          category,
          relatedWorkTitle,
          portrayedBy,
          relatedIds: selectedRelatedIds,
        },
        existingItems,
        5
      ),
    [
      title,
      originalTitle,
      subtitle,
      category,
      relatedWorkTitle,
      portrayedBy,
      selectedRelatedIds,
      existingItems,
    ]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const draft: ArchiveDraftInput = {
      category,
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

    const nextErrors = validateArchiveInput(draft);
    setErrors(nextErrors);
    if (hasValidationErrors(nextErrors)) {
      return;
    }

    setSubmitting(true);
    try {
      await onCreateItem(draft);
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
      setErrors({});
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-[760px] px-4 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-[420px]:px-5 md:px-8 md:pt-8 md:pb-16">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="space-y-5 rounded-2xl border border-[#E4DFD5] bg-white p-4 min-[420px]:p-5 sm:p-6"
      >
        <div>
          <span className="block text-[13px] font-medium text-[#625C54] md:text-xs">
            建档分类
          </span>
          <div
            role="group"
            aria-label="手动建档分类"
            className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-[#EFECE5] p-1"
          >
            {(['film', 'person', 'character'] as ArchiveCategory[]).map((cat) => (
              <button
                key={cat}
                type="button"
                aria-pressed={category === cat}
                onClick={() => setCategory(cat)}
                className={`min-h-[44px] rounded-lg text-[15px] font-medium cursor-pointer transition-colors md:min-h-[42px] md:text-sm ${
                  category === cat
                    ? 'bg-white text-[#1A1816] shadow-xs'
                    : 'text-[#625C54]'
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <div>
          <label
            htmlFor="create-title"
            className="block text-[13px] font-medium text-[#4B453E] md:text-xs"
          >
            名称 / 片名 <span className="text-[#B43B2B]">*</span>
          </label>
          <input
            id="create-title"
            type="text"
            required
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (errors.title) setErrors((p) => ({ ...p, title: undefined }));
            }}
            placeholder={
              category === 'film'
                ? '例如：花样年华'
                : category === 'person'
                  ? '例如：梁朝伟'
                  : '例如：周慕云'
            }
            className={`mt-1.5 h-12 w-full rounded-xl border bg-[#FAF9F6] px-3.5 text-[16px] text-[#1A1816] focus:bg-white focus:outline-none md:text-[15px] ${
              errors.title
                ? 'border-[#B43B2B]'
                : 'border-[#DCD6CB] focus:border-[#1A1816]'
            }`}
          />
          {errors.title && (
            <p role="alert" className="mt-1.5 text-[13px] text-[#B43B2B] md:text-xs">
              {errors.title}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="create-original-title"
              className="block text-[13px] font-medium text-[#4B453E] md:text-xs"
            >
              原名 / 外文名（选填）
            </label>
            <input
              id="create-original-title"
              type="text"
              value={originalTitle}
              onChange={(e) => setOriginalTitle(e.target.value)}
              placeholder="选填"
              className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
            />
          </div>

          <div>
            <label
              htmlFor="create-subtitle"
              className="block text-[13px] font-medium text-[#4B453E] md:text-xs"
            >
              {category === 'film'
                ? '导演 / 类型'
                : category === 'person'
                  ? '职业身份'
                  : '角色定位'}
            </label>
            <input
              id="create-subtitle"
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="选填"
              className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label
              htmlFor="create-year"
              className="block text-[13px] font-medium text-[#4B453E] md:text-xs"
            >
              年份（4位）
            </label>
            <input
              id="create-year"
              type="text"
              inputMode="numeric"
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                if (errors.year) setErrors((p) => ({ ...p, year: undefined }));
              }}
              placeholder="如 2000"
              className={`mt-1.5 h-12 w-full rounded-xl border bg-[#FAF9F6] px-3.5 font-mono text-[16px] text-[#1A1816] focus:bg-white focus:outline-none md:text-sm ${
                errors.year
                  ? 'border-[#B43B2B]'
                  : 'border-[#DCD6CB] focus:border-[#1A1816]'
              }`}
            />
            {errors.year && (
              <p role="alert" className="mt-1 text-[13px] text-[#B43B2B] md:text-xs">
                {errors.year}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="create-region"
              className="block text-[13px] font-medium text-[#4B453E] md:text-xs"
            >
              地区
            </label>
            <input
              id="create-region"
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="如 中国 / 日本"
              className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
            />
          </div>
        </div>

        {/* Work / Actor */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="create-work"
              className="block text-[13px] font-medium text-[#4B453E] md:text-xs"
            >
              {category === 'character'
                ? '出处影视作品'
                : category === 'person'
                  ? '代表作品'
                  : '主演 / 主创'}
            </label>
            <input
              id="create-work"
              type="text"
              value={relatedWorkTitle}
              onChange={(e) => setRelatedWorkTitle(e.target.value)}
              placeholder="选填"
              className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
            />
          </div>

          {category === 'character' && (
            <div>
              <label
                htmlFor="create-actor"
                className="block text-[13px] font-medium text-[#4B453E] md:text-xs"
              >
                饰演演员 / 声优
              </label>
              <input
                id="create-actor"
                type="text"
                value={portrayedBy}
                onChange={(e) => setPortrayedBy(e.target.value)}
                placeholder="选填"
                className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
              />
            </div>
          )}
        </div>

        {/* Status */}
        <div>
          <span className="block text-[13px] font-medium text-[#4B453E] md:text-xs">
            收藏状态
          </span>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {STATUS_LIST.map((st) => {
              const active = status === st;
              return (
                <button
                  key={st}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatus(st)}
                  className={`min-h-[44px] rounded-xl text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[42px] md:text-xs ${
                    active
                      ? 'bg-[#1A1816] text-white'
                      : 'border border-[#DCD6CB] bg-[#FAF9F6] text-[#4B453E]'
                  }`}
                >
                  {getStatusLabel(st, category)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rating Stars (44px touch targets) */}
        <div>
          <span className="block text-[13px] font-medium text-[#4B453E] md:text-xs">
            个人评分
          </span>
          <div className="mt-2 flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((starVal) => (
              <button
                key={starVal}
                type="button"
                aria-label={`评为 ${starVal} 星`}
                aria-pressed={rating >= starVal}
                onClick={() => setRating(rating === starVal ? 0 : starVal)}
                className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-[#F3EFE8] cursor-pointer"
              >
                <Star
                  className={`h-6 w-6 ${
                    starVal <= rating
                      ? 'fill-[#B43B2B] text-[#B43B2B]'
                      : 'text-[#CFC8BC]'
                  }`}
                />
              </button>
            ))}
            <span className="ml-2 font-mono text-[13px] tabular-nums text-[#625C54] md:text-xs">
              {rating > 0 ? `${rating}.0` : '未评'}
            </span>
          </div>
        </div>

        {/* Cover URL */}
        <div>
          <label
            htmlFor="create-cover"
            className="block text-[13px] font-medium text-[#4B453E] md:text-xs"
          >
            封面 / 剧照链接（选填，自动服务端直连代理）
          </label>
          <input
            id="create-cover"
            type="url"
            value={coverUrl}
            onChange={(e) => {
              setCoverUrl(e.target.value);
              if (errors.coverUrl) {
                setErrors((p) => ({ ...p, coverUrl: undefined }));
              }
            }}
            placeholder="https://..."
            className={`mt-1.5 h-12 w-full rounded-xl border bg-[#FAF9F6] px-3.5 font-mono text-[16px] text-[#1A1816] focus:bg-white focus:outline-none md:text-xs ${
              errors.coverUrl
                ? 'border-[#B43B2B]'
                : 'border-[#DCD6CB] focus:border-[#1A1816]'
            }`}
          />
          {errors.coverUrl && (
            <p role="alert" className="mt-1 text-[13px] text-[#B43B2B] md:text-xs">
              {errors.coverUrl}
            </p>
          )}
        </div>

        {/* Quote & Notes */}
        <div>
          <label
            htmlFor="create-quote"
            className="block text-[13px] font-medium text-[#4B453E] md:text-xs"
          >
            经典台词 / 语录（选填）
          </label>
          <input
            id="create-quote"
            type="text"
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            placeholder="摘录一句最打动你的台词…"
            className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="create-notes"
            className="block text-[13px] font-medium text-[#4B453E] md:text-xs"
          >
            观影手记 / 简介（选填）
          </label>
          <textarea
            id="create-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="记录你的想法、剧情备忘或喜欢这个角色的原因…"
            className="mt-1.5 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 py-3 text-[16px] leading-relaxed text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="create-tags"
            className="block text-[13px] font-medium text-[#4B453E] md:text-xs"
          >
            标签（顿号或逗号分隔）
          </label>
          <input
            id="create-tags"
            type="text"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="例如：年度挚爱、反复重刷"
            className="mt-1.5 h-12 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm"
          />
        </div>

        {existingItems.length > 0 && (
          <div className="space-y-3">
            {liveRecommendations.length > 0 && (
              <div
                data-testid="create-live-recommendations"
                className="rounded-xl border border-[#E5D5BE] bg-[#FFFDF8] p-3.5"
              >
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-[#8E6523] md:text-xs">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    根据作品 / 演员名称为你推荐 {liveRecommendations.length} 项未关联藏品
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {liveRecommendations.map(({ item: rec, reason }) => (
                    <button
                      key={`draft-rec-${rec.id}`}
                      type="button"
                      onClick={() => toggleRelated(rec.id)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#EACDC6] bg-[#FDF2EF] px-2.5 py-1.5 text-left text-[13px] font-medium text-[#B43B2B] cursor-pointer transition-colors hover:bg-[#FBE6E1] md:min-h-[38px] md:text-xs"
                    >
                      <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        {rec.title}
                        <span className="ml-1 font-normal text-[#7A6A5F]">
                          （{reason}）
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <span className="block text-[13px] font-medium text-[#4B453E] md:text-xs">
                关联馆内已有藏品（选填）
              </span>
              <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-xl border border-[#E4DFD5] bg-[#FAF9F6] p-3">
                {existingItems.map((ex) => {
                  const checked = selectedRelatedIds.includes(ex.id);
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggleRelated(ex.id)}
                      className={`min-h-[40px] rounded-lg px-3 py-1.5 text-[13px] font-medium cursor-pointer transition-colors md:min-h-[38px] md:text-xs ${
                        checked
                          ? 'bg-[#B43B2B] text-white'
                          : 'border border-[#DCD6CB] bg-white text-[#2E2A26]'
                      }`}
                    >
                      {CATEGORY_LABELS[ex.category]} · {ex.title}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="h-12 w-full rounded-xl bg-[#B43B2B] text-[16px] font-medium text-white cursor-pointer active:scale-[0.98] transition-transform hover:bg-[#932D20] disabled:opacity-60 md:text-sm"
        >
          {submitting ? '建档中…' : '确认收录到藏馆'}
        </button>
      </form>
    </section>
  );
}
