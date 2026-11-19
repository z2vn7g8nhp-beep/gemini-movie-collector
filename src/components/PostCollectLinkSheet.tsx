import { Check, Link2, Sparkles, X } from 'lucide-react';
import type { ArchiveItem } from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import {
  isExplicitlyLinked,
  type LinkRecommendation,
} from '../utils/smartLink';
import { ArchivalImage } from './ArchivalImage';

interface PostCollectLinkSheetProps {
  sourceItem: ArchiveItem | null;
  recommendations: LinkRecommendation[];
  allItems: ArchiveItem[];
  onLinkOne: (sourceId: string, targetId: string) => Promise<void>;
  onLinkAll: (sourceId: string, targetIds: string[]) => Promise<void>;
  onOpenDetail: (item: ArchiveItem) => void;
  onClose: () => void;
}

export function PostCollectLinkSheet({
  sourceItem,
  recommendations,
  allItems,
  onLinkOne,
  onLinkAll,
  onOpenDetail,
  onClose,
}: PostCollectLinkSheetProps) {
  if (!sourceItem || recommendations.length === 0) return null;

  // Resolve latest item state from allItems so linked badges update instantaneously
  const liveSource =
    allItems.find((i) => i.id === sourceItem.id) ?? sourceItem;

  const enriched = recommendations.map((rec) => {
    const liveTarget = allItems.find((i) => i.id === rec.item.id) ?? rec.item;
    return {
      ...rec,
      item: liveTarget,
      linked: isExplicitlyLinked(liveSource, liveTarget),
    };
  });

  const unlinkedIds = enriched.filter((r) => !r.linked).map((r) => r.item.id);
  const allDone = unlinkedIds.length === 0;

  return (
    <aside
      role="region"
      aria-label="智能关联推荐"
      data-testid="post-collect-link-sheet"
      className="fixed inset-x-3 bottom-[72px] z-40 mx-auto max-w-[460px] overflow-hidden rounded-2xl border border-[#3B352D] bg-[#1C1A17] text-[#F5F1E8] shadow-[0_18px_48px_rgba(20,18,15,0.34)] md:inset-x-auto md:right-6 md:bottom-6 md:w-[420px]"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-[#E4C37A]">
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              已收录「{liveSource.title}」· 发现 {enriched.length} 项馆内关联
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-[#B8AE9E]">
            根据作品名称与演员脉络自动匹配，轻点即可一键建立双向链接
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          data-testid="smart-link-close-btn"
          aria-label="关闭关联推荐"
          className="-mr-1 -mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#A59D90] transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Recommended Unlinked Library Items */}
      <ul className="max-h-[240px] divide-y divide-white/10 overflow-y-auto px-3 py-1">
        {enriched.map(({ item: target, reason, linked }) => (
          <li
            key={target.id}
            data-testid={`smart-link-row-${target.id}`}
            className="flex items-center justify-between gap-2.5 py-2.5"
          >
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenDetail(target);
              }}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer"
            >
              <ArchivalImage
                src={target.coverUrl}
                alt={target.title}
                title={target.title}
                category={target.category}
                compact
                className="h-12 w-9 shrink-0 rounded-lg border border-white/10"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-editorial text-sm font-medium text-[#FAF7F0]">
                  {target.title}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-[#B8AE9E]">
                  <span className="text-[#E4C37A]">
                    {CATEGORY_LABELS[target.category]}
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span>{reason}</span>
                </p>
              </div>
            </button>

            {linked ? (
              <span
                data-testid={`smart-link-done-${target.id}`}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl border border-[#C9A45C]/45 bg-[#C9A45C]/15 px-3 text-xs font-medium text-[#E4C37A] whitespace-nowrap"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>已关联</span>
              </span>
            ) : (
              <button
                type="button"
                data-testid={`smart-link-btn-${target.id}`}
                onClick={() => void onLinkOne(liveSource.id, target.id)}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl bg-[#B43B2B] px-3 text-xs font-medium text-white whitespace-nowrap cursor-pointer transition-colors hover:bg-[#932D20] active:scale-[0.97]"
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>一键关联</span>
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* Footer Batch Action */}
      <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-[#161411] px-4 py-2.5">
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenDetail(liveSource);
          }}
          className="min-h-[36px] text-xs text-[#C9C1B4] underline-offset-2 hover:text-white hover:underline cursor-pointer"
        >
          查看新档案详情
        </button>

        {allDone ? (
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] rounded-xl border border-white/15 bg-white/10 px-3.5 text-xs font-medium text-[#FAF7F0] whitespace-nowrap cursor-pointer"
          >
            完成
          </button>
        ) : (
          <button
            type="button"
            data-testid="smart-link-all-btn"
            onClick={() => void onLinkAll(liveSource.id, unlinkedIds)}
            className="min-h-[36px] rounded-xl bg-[#FAF7F0] px-3.5 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer transition-colors hover:bg-[#EFE9DC] active:scale-[0.97]"
          >
            全部一键关联（{unlinkedIds.length}）
          </button>
        )}
      </div>
    </aside>
  );
}
