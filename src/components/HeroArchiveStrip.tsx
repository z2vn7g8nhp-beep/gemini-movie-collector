import { Download } from 'lucide-react';
import type {
  ArchiveCategory,
  ArchiveItem,
  ArchiveStats,
  OnlineSearchResult,
} from '../types/archive';
import { OnlineSearchSection } from './OnlineSearchSection';

interface HeroArchiveStripProps {
  stats: ArchiveStats;
  existingItems: ArchiveItem[];
  preferredCategory: ArchiveCategory;
  searchFocusTrigger: number;
  externalSearchQuery?: string;
  onCollectOnlineResult: (result: OnlineSearchResult) => Promise<void>;
  onOpenManualCreate: (prefillTitle?: string, category?: ArchiveCategory) => void;
  onOpenBackup: () => void;
}

export function HeroArchiveStrip({
  stats,
  existingItems,
  preferredCategory,
  searchFocusTrigger,
  externalSearchQuery,
  onCollectOnlineResult,
  onOpenManualCreate,
  onOpenBackup,
}: HeroArchiveStripProps) {
  return (
    <section className="border-b border-[#E4DFD5] bg-[#F7F5F0]">
      <div className="mx-auto max-w-[1280px] px-5 py-8 sm:px-8 sm:py-10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs tracking-[0.16em] text-[#625C54]">
              私人影像馆藏 · 服务端直连联网检索
            </p>
            <h1 className="mt-2 font-editorial text-[26px] leading-[1.3] font-medium tracking-normal text-[#1A1816] sm:text-4xl">
              收藏动人影视、影人与鲜活角色
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-[#625C54]">
              直接搜索即可直连公开影视与角色资料库并代理封面图，无需梯子，一键收入你的个人藏馆。
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onOpenBackup}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-[#D7D0C4] bg-white px-4 py-2 text-xs font-medium text-[#1A1816] whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150 hover:border-[#1A1816] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B43B2B]"
            >
              <Download className="h-3.5 w-3.5 stroke-[1.75]" aria-hidden="true" />
              备份与管理
            </button>
          </div>
        </div>

        {/* Prominent Inline Direct Online Search Bar */}
        <OnlineSearchSection
          existingItems={existingItems}
          preferredCategory={preferredCategory}
          focusTrigger={searchFocusTrigger}
          externalQuery={externalSearchQuery}
          onCollectResult={onCollectOnlineResult}
          onOpenManualCreate={onOpenManualCreate}
        />

        {/* Editorial Index Metrics Row */}
        <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[#E4DFD5] pt-5 sm:grid-cols-5">
          <div>
            <dt className="text-xs text-[#625C54]">总馆藏</dt>
            <dd
              data-testid="stat-total"
              className="mt-1 font-mono text-2xl font-medium tabular-nums text-[#1A1816]"
            >
              {stats.total}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#625C54]">影视作品</dt>
            <dd
              data-testid="stat-film"
              className="mt-1 font-mono text-2xl font-medium tabular-nums text-[#1A1816]"
            >
              {stats.film}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#625C54]">影人档案</dt>
            <dd
              data-testid="stat-person"
              className="mt-1 font-mono text-2xl font-medium tabular-nums text-[#1A1816]"
            >
              {stats.person}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#625C54]">经典角色</dt>
            <dd
              data-testid="stat-character"
              className="mt-1 font-mono text-2xl font-medium tabular-nums text-[#1A1816]"
            >
              {stats.character}
            </dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-xs text-[#625C54]">挚爱精选</dt>
            <dd
              data-testid="stat-favorites"
              className="mt-1 font-mono text-2xl font-medium tabular-nums text-[#B43B2B]"
            >
              {stats.favorites}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
