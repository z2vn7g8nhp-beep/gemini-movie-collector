import { useMemo, useState } from 'react';
import {
  Award,
  CalendarCheck2,
  Check,
  Copy,
  Download,
  Link2,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  ArchiveItem,
  ArchiveStats,
  CollectorState,
} from '../types/archive';
import { mergeImportedItems, parseImportPayload } from '../utils/archive';
import {
  buildCollectorRank,
  computeCheckInStreak,
  computeCollectorStamps,
  formatLocalDateKey,
  getRecentCalendarDays,
} from '../utils/collector';
import {
  computeCinemaMedals,
  MEDAL_TIER_RANK,
  type CinemaMedal,
  type MedalCategory,
} from '../utils/medals';
import type { RuntimeMode } from '../utils/runtimeEnv';
import {
  CLOUDFLARE_WORKER_SNIPPET,
  getConfiguredDoubanRelayUrl,
  saveDoubanRelayUrl,
} from '../utils/doubanRelay';
import { ArchivalSealStamp } from './ArchivalSealStamp';
import { CinemaMedalSvg } from './CinemaMedalSvg';
import { MedalInspectModal } from './MedalInspectModal';
import { PWAInstallButton } from './PWAInstallButton';

interface ProfileBackupViewProps {
  items: ArchiveItem[];
  stats: ArchiveStats;
  collector: CollectorState;
  runtimeMode?: RuntimeMode;
  onCheckInToday: () => Promise<void>;
  onReplaceAll: (items: ArchiveItem[]) => Promise<void>;
  onFilterByTag?: (tag: string) => void;
}

export function ProfileBackupView({
  items,
  stats,
  collector,
  runtimeMode = 'static',
  onCheckInToday,
  onReplaceAll,
  onFilterByTag,
}: ProfileBackupViewProps) {
  const [jsonInput, setJsonInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [medalFilter, setMedalFilter] = useState<'all' | MedalCategory>('all');
  const [inspectingMedal, setInspectingMedal] = useState<CinemaMedal | null>(
    null
  );
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [relayInput, setRelayInput] = useState(() =>
    getConfiguredDoubanRelayUrl()
  );
  const [relayExpanded, setRelayExpanded] = useState(
    () => runtimeMode === 'static'
  );
  const [workerCopied, setWorkerCopied] = useState(false);
  const [relayStatus, setRelayStatus] = useState<string>('');

  const todayKey = useMemo(() => formatLocalDateKey(), []);
  const rank = useMemo(
    () => buildCollectorRank(items, collector),
    [items, collector]
  );
  const streak = useMemo(
    () => computeCheckInStreak(collector.checkInDates, todayKey),
    [collector.checkInDates, todayKey]
  );
  const calendarDays = useMemo(
    () => getRecentCalendarDays(collector.checkInDates, todayKey, 14),
    [collector.checkInDates, todayKey]
  );
  const stamps = useMemo(
    () => computeCollectorStamps(items, collector, todayKey),
    [items, collector, todayKey]
  );
  const unlockedCount = stamps.filter((s) => s.unlocked).length;

  const medals = useMemo(() => computeCinemaMedals(items), [items]);
  const unlockedMedals = useMemo(
    () =>
      medals
        .filter((m) => m.unlocked)
        .sort((a, b) => MEDAL_TIER_RANK[b.tier] - MEDAL_TIER_RANK[a.tier]),
    [medals]
  );
  const visibleMedals = useMemo(() => {
    const list =
      medalFilter === 'all'
        ? medals
        : medals.filter((m) => m.category === medalFilter);
    return [...list].sort((a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      return MEDAL_TIER_RANK[b.tier] - MEDAL_TIER_RANK[a.tier];
    });
  }, [medals, medalFilter]);

  const handleDownloadJson = () => {
    const payload = {
      app: '光影志 CinéArchive',
      version: 1,
      exportedAt: new Date().toISOString(),
      items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cinearchive-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFeedback({
      type: 'success',
      message: `已导出全部 ${items.length} 件藏品到本地 JSON 文件。`,
    });
  };

  const runImport = async (rawText: string) => {
    if (!rawText.trim()) {
      setFeedback({ type: 'error', message: '请先选择 JSON 文件或粘贴备份内容。' });
      return;
    }
    const parsed = parseImportPayload(rawText);
    if (parsed.error) {
      setFeedback({ type: 'error', message: parsed.error });
      return;
    }
    setImporting(true);
    try {
      const { merged, addedCount, skippedCount } = mergeImportedItems(
        items,
        parsed.items
      );
      await onReplaceAll(merged);
      setJsonInput('');
      setFeedback({
        type: 'success',
        message: `导入成功：新增 ${addedCount} 件，跳过 ${skippedCount} 件重复条目。`,
      });
    } finally {
      setImporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      void runImport(text);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  return (
    <section className="mx-auto max-w-[1180px] space-y-5 px-4 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] min-[420px]:px-5 md:px-8 md:pt-7 md:pb-16">
      {/* Top 12-Column Exhibition Layout: Left Passport & Rhythm (5 cols) | Right Medals & Stamps (7 cols) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        <div className="space-y-4 lg:col-span-5">
      {/* 1. Curator Rank & Passport Card */}
      <div
        data-testid="curator-rank-card"
        className="gallery-card-dark border border-[#342F28] p-5 text-[#F5F1E8]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[12px] tracking-[0.12em] text-[#A59D90] tabular-nums md:text-[11px]">
              馆主铭牌 · LV.{rank.level}
            </p>
            <h2 className="mt-1 flex items-center gap-2 font-editorial text-[24px] font-medium text-[#FAF7F0] min-[420px]:text-[25px] md:text-2xl">
              <Award className="h-5 w-5 shrink-0 text-[#D4AF6A]" aria-hidden="true" />
              <span className="truncate">{rank.title}</span>
            </h2>
          </div>

          <button
            type="button"
            onClick={() => void onCheckInToday()}
            className={`inline-flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[40px] md:text-xs ${
              streak.checkedInToday
                ? 'border border-[#C9A45C]/60 bg-[#C9A45C]/15 text-[#E4C37A]'
                : 'bg-[#B43B2B] text-white active:scale-[0.97]'
            }`}
          >
            {streak.checkedInToday ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>今日已巡馆</span>
              </>
            ) : (
              <>
                <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>今日打卡</span>
              </>
            )}
          </button>
        </div>

        {/* Rank Progress */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-[13px] text-[#C9C1B4] tabular-nums md:text-xs">
            <span>馆藏值 {rank.points}</span>
            <span>
              {rank.nextLevelPoints
                ? `距下一级还差 ${Math.max(0, rank.nextLevelPoints - rank.points)}`
                : '已达最高传世等级'}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#D4AF6A] transition-all"
              style={{ width: `${rank.progressPercent}%` }}
            />
          </div>
        </div>

        {/* 4 Key Collector Figures */}
        <div className="mt-4 grid grid-cols-4 gap-2 border-t border-white/10 pt-3.5 text-center">
          <div>
            <p
              data-testid="profile-stat-total"
              className="font-mono text-[20px] font-medium tabular-nums text-[#FAF7F0] md:text-lg"
            >
              {stats.total}
            </p>
            <p className="mt-0.5 text-[12px] text-[#A59D90] md:text-[11px]">总馆藏</p>
          </div>
          <div>
            <p className="font-mono text-[20px] font-medium tabular-nums text-[#E4C37A] md:text-lg">
              {rank.masterpieceCount}
            </p>
            <p className="mt-0.5 text-[12px] text-[#A59D90] md:text-[11px]">典藏级</p>
          </div>
          <div>
            <p className="font-mono text-[20px] font-medium tabular-nums text-[#FAF7F0] md:text-lg">
              {rank.linkPairCount}
            </p>
            <p className="mt-0.5 text-[12px] text-[#A59D90] md:text-[11px]">羁绊组</p>
          </div>
          <div>
            <p className="font-mono text-[20px] font-medium tabular-nums text-[#E4C37A] md:text-lg">
              {unlockedMedals.length}/{medals.length}
            </p>
            <p className="mt-0.5 text-[12px] text-[#A59D90] md:text-[11px]">影藏勋章</p>
          </div>
        </div>
      </div>

      {/* 2. 14-Day Check-In Filmstrip Calendar */}
      <div className="gallery-card border border-[#E4DFD5] p-4 min-[420px]:p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-editorial text-[18px] font-medium text-[#1A1816] md:text-base">
              近 14 日巡馆足迹
            </h2>
            <p className="mt-0.5 text-[13px] text-[#7A7268] tabular-nums md:text-xs">
              连续 {streak.currentStreak} 天 · 最长 {streak.longestStreak} 天 · 累计 {streak.totalDays} 天
            </p>
          </div>
        </div>

        <div className="mt-3.5 grid grid-cols-7 gap-2">
          {calendarDays.map((cell) => (
            <div
              key={cell.dateKey}
              aria-label={`${cell.dateKey} ${cell.checked ? '已巡馆' : '未巡馆'}`}
              className={`flex aspect-square flex-col items-center justify-center rounded-xl border font-mono text-[13px] tabular-nums md:text-xs ${
                cell.checked
                  ? 'border-[#B43B2B] bg-[#B43B2B] font-medium text-white'
                  : cell.isToday
                    ? 'border-[#1A1816] bg-[#FAF9F6] font-medium text-[#1A1816]'
                    : 'border-[#ECE7DD] bg-[#FAF9F6] text-[#9C9488]'
              }`}
            >
              <span>{cell.dayNum}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Category Breakdown Compact Strip */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="gallery-card border border-[#E4DFD5] p-3.5 text-center">
          <p className="font-mono text-[22px] font-medium tabular-nums text-[#1A1816] md:text-xl">
            {stats.film}
          </p>
          <p className="mt-0.5 text-[13px] text-[#625C54] md:text-xs">影视作品</p>
        </div>
        <div className="gallery-card border border-[#E4DFD5] p-3.5 text-center">
          <p className="font-mono text-[22px] font-medium tabular-nums text-[#1A1816] md:text-xl">
            {stats.person}
          </p>
          <p className="mt-0.5 text-[13px] text-[#625C54] md:text-xs">影人档案</p>
        </div>
        <div className="gallery-card border border-[#E4DFD5] p-3.5 text-center">
          <p className="font-mono text-[22px] font-medium tabular-nums text-[#1A1816] md:text-xl">
            {stats.character}
          </p>
          <p className="mt-0.5 text-[13px] text-[#625C54] md:text-xs">角色图鉴</p>
        </div>
      </div>
        </div>

        {/* Right 7-Column Honors & Stamps Gallery */}
        <div className="space-y-4 lg:col-span-7">
      {/* 1.5 Dynamic Cinema Medals Cabinet */}
      <div
        data-testid="cinema-medals-section"
        className="gallery-card border border-[#E6E0D4] p-4 min-[420px]:p-5"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-editorial text-[18px] font-medium text-[#1A1816] md:text-base">
              影藏勋章殿
            </h2>
            <p className="mt-0.5 text-[13px] text-[#7A7268] md:text-xs">
              依收藏类型、专题标签与关联图谱动态铸造并逐阶晋升
            </p>
          </div>
          <span className="shrink-0 whitespace-nowrap font-mono text-[13px] font-medium tabular-nums text-[#8E6523] md:text-xs">
            {unlockedMedals.length} / {medals.length}
          </span>
        </div>

        {/* Velvet Featured Crest Strip (Top Unlocked Prestige Medals) */}
        {unlockedMedals.length > 0 && (
          <div className="mt-3.5 rounded-xl border border-[#C9A45C]/40 bg-[#1C1A17] p-3 text-[#F5F1E8]">
            <p className="font-mono text-[11px] tracking-[0.1em] text-[#B8AE9E] md:text-[10px]">
              荣耀陈列 · 点击勋章查看铭文与晋阶
            </p>
            <div className="h-scroll-rail no-scrollbar mt-2.5 flex gap-2.5 pb-0.5">
              {unlockedMedals.slice(0, 6).map((medal) => (
                <button
                  key={`featured-${medal.id}`}
                  type="button"
                  onClick={() => setInspectingMedal(medal)}
                  aria-label={`赏析荣耀勋章「${medal.title}」`}
                  className="flex w-[84px] shrink-0 flex-col items-center rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2 text-center transition-colors hover:border-[#C9A45C]/60 cursor-pointer min-[420px]:w-[88px] md:w-[76px]"
                >
                  <CinemaMedalSvg
                    category={medal.category}
                    motif={medal.motif}
                    tier={medal.tier}
                    monogram={medal.monogram}
                    size={48}
                  />
                  <span className="mt-1 w-full truncate text-[12px] font-medium text-[#FAF7F0] md:text-[11px]">
                    {medal.shortTitle}
                  </span>
                  <span className="text-[11px] text-[#E4C37A] whitespace-nowrap md:text-[10px]">
                    {medal.tierLabel}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category Filter Tabs */}
        <div
          role="tablist"
          aria-label="勋章分类筛选"
          className="mt-3.5 grid grid-cols-4 gap-1 rounded-xl bg-[#EFECE5] p-1"
        >
          {(
            [
              { id: 'all', label: '全部', count: medals.length },
              {
                id: 'type',
                label: '类型',
                count: medals.filter((m) => m.category === 'type').length,
              },
              {
                id: 'tag',
                label: '标签',
                count: medals.filter((m) => m.category === 'tag').length,
              },
              {
                id: 'relation',
                label: '关联',
                count: medals.filter((m) => m.category === 'relation').length,
              },
            ] as const
          ).map((tab) => {
            const active = medalFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMedalFilter(tab.id)}
                className={`min-h-[42px] rounded-lg px-1.5 text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors md:min-h-[38px] md:text-xs ${
                  active
                    ? 'bg-white text-[#1A1816] shadow-xs'
                    : 'text-[#625C54]'
                }`}
              >
                {tab.label}
                <span className="ml-0.5 font-mono text-[11px] tabular-nums opacity-75 md:text-[10px]">
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Graphical Medal Grid */}
        <div className="mt-3.5 grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {visibleMedals.map((medal) => {
            const isGoldOrCrimson =
              medal.tier === 'gold' || medal.tier === 'crimson';
            return (
              <button
                key={medal.id}
                type="button"
                data-testid={`medal-card-${medal.id}`}
                data-unlocked={medal.unlocked ? 'true' : 'false'}
                data-tier={medal.tier}
                onClick={() => setInspectingMedal(medal)}
                aria-label={`查看影藏勋章「${medal.title}」（${medal.tierLabel}）`}
                className={`flex flex-col items-center rounded-xl border p-2.5 text-center transition-colors cursor-pointer active:scale-[0.98] ${
                  medal.unlocked
                    ? isGoldOrCrimson
                      ? 'border-[#C9A45C] bg-[#FDFBF5] hover:border-[#A67C37]'
                      : 'border-[#DDD6C8] bg-[#FAF8F3] hover:border-[#1A1816]'
                    : 'border-[#ECE7DD] bg-[#FAF9F6]/80 hover:border-[#CFC7B9]'
                }`}
              >
                <CinemaMedalSvg
                  category={medal.category}
                  motif={medal.motif}
                  tier={medal.tier}
                  monogram={medal.monogram}
                  size={62}
                />
                <p
                  className={`mt-1.5 w-full truncate text-[13px] font-medium leading-tight md:text-xs ${
                    medal.unlocked ? 'text-[#1A1816]' : 'text-[#7A7268]'
                  }`}
                >
                  {medal.shortTitle}
                </p>
                <p className="mt-0.5 line-clamp-1 w-full text-[11px] text-[#7A7268] md:text-[10px]">
                  {medal.unlocked ? medal.tierLabel : '待解锁'}
                </p>
                <span
                  className={`mt-1 font-mono text-[11px] tabular-nums md:text-[10px] ${
                    medal.unlocked
                      ? medal.tier === 'crimson'
                        ? 'font-medium text-[#B43B2B]'
                        : medal.tier === 'gold'
                          ? 'font-medium text-[#8E6523]'
                          : 'font-medium text-[#4B453E]'
                      : 'text-[#8C857B]'
                  }`}
                >
                  {medal.nextTarget !== null
                    ? `${medal.current} / ${medal.target}`
                    : '满阶'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Collectible Archival Stamp Book (12 Stamps) */}
      <div
        data-testid="collector-stamps-section"
        className="gallery-card border border-[#E6E0D4] p-4 min-[420px]:p-5"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-editorial text-[18px] font-medium text-[#1A1816] md:text-base">
              馆藏印记册
            </h2>
            <p className="mt-0.5 text-[13px] text-[#7A7268] md:text-xs">
              收集、关联与打磨档案即可点亮专属纸质胶片朱印与烫金印
            </p>
          </div>
          <span className="shrink-0 whitespace-nowrap font-mono text-[13px] font-medium tabular-nums text-[#B43B2B] md:text-xs">
            {unlockedCount} / {stamps.length}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2.5 sm:grid-cols-4">
          {stamps.map((stamp, idx) => {
            const isGold = stamp.tone === 'gold';
            const sealVariant: 'zhuwen' | 'baiwen' =
              idx % 3 === 1 ? 'baiwen' : 'zhuwen';
            return (
              <div
                key={stamp.id}
                data-testid={`stamp-${stamp.id}`}
                data-unlocked={stamp.unlocked ? 'true' : 'false'}
                className={`flex flex-col items-center rounded-2xl border p-2.5 text-center transition-colors ${
                  stamp.unlocked
                    ? isGold
                      ? 'border-[#C9A45C]/75 bg-[#FDFBF5] shadow-[0_3px_10px_-6px_rgba(166,124,55,0.28)]'
                      : 'border-[#E6C5BE] bg-[#FDF9F6] shadow-[0_3px_10px_-6px_rgba(164,50,35,0.16)]'
                    : 'border-[#ECE7DD] bg-[#FAF8F3]'
                }`}
              >
                {/* Museum-Grade Paper-Film & Hot-Foil Carved Archival Seal */}
                <ArchivalSealStamp
                  title={stamp.title}
                  tone={stamp.tone}
                  unlocked={stamp.unlocked}
                  variant={sealVariant}
                  size={64}
                />

                <p
                  className={`mt-2 text-[13px] font-medium leading-tight md:text-xs ${
                    stamp.unlocked ? 'text-[#1A1816]' : 'text-[#7A7268]'
                  }`}
                >
                  {stamp.title}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[#7A7268] md:text-[10px]">
                  {stamp.desc}
                </p>
                <span
                  className={`mt-1.5 font-mono text-[11px] tabular-nums md:text-[10px] ${
                    stamp.unlocked
                      ? isGold
                        ? 'font-medium text-[#8E6523]'
                        : 'font-medium text-[#B43B2B]'
                      : 'text-[#8C857B]'
                  }`}
                >
                  {stamp.unlocked
                    ? '已点亮'
                    : `${stamp.current} / ${stamp.target}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
        </div>
      </div>

      {/* Bottom 2-Column Utilities & Data Management Shelf */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start">
        <div className="space-y-4 lg:col-span-6">
      {/* Web App Installation & GitHub Pages Card */}
      <div
        data-testid="webapp-install-card"
        className="gallery-card border border-[#E4DFD5] p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-editorial text-[19px] font-medium text-[#1A1816] md:text-lg">
            独立 Web App 与离线安装
          </h2>
          <span className="font-mono text-[12px] text-[#7A7268] md:text-[11px]">
            {runtimeMode === 'static'
              ? 'GitHub Pages 纯静态本地模式'
              : '服务端直连 + 本地离线双模'}
          </span>
        </div>
        <p className="mt-1.5 text-[14px] leading-relaxed text-[#625C54] md:text-xs">
          支持将光影志添加到手机主屏幕或安装为桌面独立窗口，断网时仍可翻阅全部本地藏馆、手记与印记册；部署至 GitHub Pages 时无需后端服务器即可完整运行。
        </p>
        <div className="mt-4">
          <PWAInstallButton variant="card" />
        </div>
      </div>

      {/* Douban Direct / Static Relay Bridge Card */}
      <div
        data-testid="douban-relay-card"
        className="rounded-2xl border border-[#E4DFD5] bg-white p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-[#B43B2B]" aria-hidden="true" />
            <h2 className="font-editorial text-[19px] font-medium text-[#1A1816] md:text-lg">
              豆瓣影视直连通道
            </h2>
          </div>
          <span className="font-mono text-[12px] text-[#2A6B46] md:text-[11px]">
            {runtimeMode === 'server'
              ? '服务端已内置直连'
              : relayInput
                ? '已启用自建中转'
                : '已内置免配置直连'}
          </span>
        </div>

        <p className="mt-1.5 text-[14px] leading-relaxed text-[#625C54] md:text-xs">
          {runtimeMode === 'server'
            ? '当前已默认直连 IMDb（评分、奖项、高清海报与主创）并原生融合豆瓣中文片名、评分、简介与剧照，开箱即用。'
            : '当前纯静态/手机端已免配置直连 IMDb（全球稳定无防盗链）并自动启用豆瓣中文信息辅助。如需在静态环境下进一步增强豆瓣中文评分与原站剧照，可按需展开绑定个人中转地址。'}
        </p>

        <button
          type="button"
          onClick={() => setRelayExpanded((prev) => !prev)}
          aria-expanded={relayExpanded}
          className="mt-3 inline-flex min-h-[40px] items-center text-[13px] font-medium text-[#1A1816] underline underline-offset-4 hover:text-[#B43B2B] cursor-pointer md:min-h-0 md:text-xs"
        >
          {relayExpanded ? '收起高级中转配置' : '高级选项：绑定自建中转（可选）'}
        </button>

        {relayExpanded && (
          <div className="mt-3.5 space-y-3 border-t border-[#ECE7DD] pt-3.5">
            <div>
              <label
                htmlFor="douban-relay-url-input"
                className="block text-[13px] font-medium text-[#4B453E] md:text-xs"
              >
                豆瓣桥接地址（Cloudflare Worker 或本应用后端 URL）
              </label>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                <input
                  id="douban-relay-url-input"
                  type="url"
                  value={relayInput}
                  onChange={(e) => {
                    setRelayInput(e.target.value);
                    if (relayStatus) setRelayStatus('');
                  }}
                  placeholder="https://your-douban-relay.workers.dev"
                  className="h-12 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 font-mono text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none sm:flex-1 md:h-10 md:px-3 md:text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    const saved = saveDoubanRelayUrl(relayInput);
                    setRelayInput(saved);
                    setRelayStatus(
                      saved
                        ? `已保存豆瓣桥接地址：${saved}`
                        : '已清空自定义豆瓣桥接地址。'
                    );
                  }}
                  className="h-12 rounded-xl bg-[#1A1816] px-4 text-[14px] font-medium text-white whitespace-nowrap cursor-pointer hover:bg-[#B43B2B] md:h-10 md:text-xs"
                >
                  保存地址
                </button>
              </div>
              {relayStatus && (
                <p role="status" className="mt-1.5 break-all text-[13px] text-[#2A6B46] md:text-xs">
                  {relayStatus}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#ECE7DD] bg-[#FAF9F6] px-3.5 py-3">
              <span className="min-w-0 text-[13px] leading-relaxed text-[#625C54] md:text-xs">
                零服务器成本：30 行 Cloudflare Worker 脚本（仓库路径 <code className="break-all font-mono text-[#1A1816]">cloudflare-worker/douban-proxy.js</code>）
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      CLOUDFLARE_WORKER_SNIPPET
                    );
                    setWorkerCopied(true);
                    window.setTimeout(() => setWorkerCopied(false), 2200);
                  } catch {
                    setRelayStatus('请直接查看项目中的 cloudflare-worker/douban-proxy.js 文件。');
                  }
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#DCD6CB] bg-white px-3 text-[13px] font-medium text-[#1A1816] cursor-pointer hover:border-[#1A1816] md:h-8 md:text-xs"
              >
                {workerCopied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#2A6B46]" aria-hidden="true" />
                    已复制 Worker 代码
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    复制 Worker 脚本
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
        </div>

        <div className="space-y-4 lg:col-span-6">
      {/* Export Backup Card */}
      <div className="gallery-card border border-[#E4DFD5] p-5">
        <h2 className="font-editorial text-[19px] font-medium text-[#1A1816] md:text-lg">
          备份与导出
        </h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-[#625C54] md:text-xs">
          {runtimeMode === 'static'
            ? '当前数据安全保存于浏览器本地存储（无需登录账号）。跨设备同步或长期归档建议定期导出 JSON 备份文件。'
            : '数据已实时保存至服务端与当前浏览器，无需登录第三方账号。你可以随时导出 JSON 备份文件。'}
        </p>
        <button
          type="button"
          onClick={handleDownloadJson}
          className="mt-4 inline-flex h-12 w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[#1A1816] px-5 text-[15px] font-medium text-white cursor-pointer active:scale-[0.98] transition-transform hover:bg-[#B43B2B] md:text-sm"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          导出全部馆藏（JSON）
        </button>
      </div>

      {/* Import Card */}
      <div className="rounded-2xl border border-[#E4DFD5] bg-white p-5">
        <h2 className="font-editorial text-[19px] font-medium text-[#1A1816] md:text-lg">
          导入恢复
        </h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-[#625C54] md:text-xs">
          导入备份时会自动按分类与名称去重，不会覆盖已有笔记。
        </p>

        <div className="mt-4">
          <label
            htmlFor="mobile-backup-file"
            className="inline-flex h-12 w-full sm:w-auto items-center justify-center gap-2 rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-5 text-[15px] font-medium text-[#1A1816] cursor-pointer active:scale-[0.98] md:text-sm"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            从手机文件选择 JSON 导入
          </label>
          <input
            id="mobile-backup-file"
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            className="sr-only"
          />
        </div>

        <div className="mt-4">
          <label
            htmlFor="mobile-backup-paste"
            className="block text-[13px] text-[#625C54] md:text-xs"
          >
            或粘贴 JSON 备份文本
          </label>
          <textarea
            id="mobile-backup-paste"
            rows={3}
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder='{"items": [...]}'
            className="mt-1.5 w-full rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3.5 py-2.5 font-mono text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-xs"
          />
          <button
            type="button"
            disabled={importing}
            onClick={() => void runImport(jsonInput)}
            className="mt-3 h-12 w-full sm:w-auto rounded-xl bg-[#B43B2B] px-5 text-[15px] font-medium text-white cursor-pointer active:scale-[0.98] disabled:opacity-50 md:h-11 md:text-sm"
          >
            {importing ? '导入中…' : '解析并合并导入'}
          </button>
        </div>
      </div>

      {/* Clear All */}
      {items.length > 0 && (
        <div className="rounded-2xl border border-[#E4DFD5] bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[15px] font-medium text-[#1A1816] md:text-sm">
                清空全部馆藏
              </h2>
              <p className="mt-0.5 text-[13px] text-[#625C54] md:text-xs">
                清除所有已收录条目，建议先导出备份。
              </p>
            </div>
            {!confirmClearAll ? (
              <button
                type="button"
                onClick={() => setConfirmClearAll(true)}
                className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border border-[#E5BFB9] bg-[#FDF4F2] px-4 text-[14px] font-medium text-[#932D20] cursor-pointer md:h-11 md:text-xs"
              >
                <Trash2 className="h-4 w-4 md:h-3.5 md:w-3.5" aria-hidden="true" />
                清空全部
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await onReplaceAll([]);
                    setConfirmClearAll(false);
                    setFeedback({
                      type: 'success',
                      message: '已清空全部馆藏。',
                    });
                  }}
                  className="h-12 flex-1 sm:flex-initial rounded-xl bg-[#B43B2B] px-4 text-[14px] font-medium text-white cursor-pointer md:h-11 md:text-xs"
                >
                  确认清空
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(false)}
                  className="h-12 flex-1 sm:flex-initial rounded-xl border border-[#DCD6CB] bg-white px-4 text-[14px] text-[#4B453E] cursor-pointer md:h-11 md:text-xs"
                >
                  取消
                </button>
              </div>
            )}
          </div>
        </div>
      )}
        </div>
      </div>

      {feedback && (
        <p
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-2xl border px-4 py-3 text-[13px] md:text-xs ${
            feedback.type === 'error'
              ? 'border-[#E5BFB9] bg-[#FDF4F2] text-[#932D20]'
              : 'border-[#C8DFD0] bg-[#F2F7F4] text-[#2A6B46]'
          }`}
        >
          {feedback.message}
        </p>
      )}
      <MedalInspectModal
        medal={inspectingMedal}
        onClose={() => setInspectingMedal(null)}
        onFilterByTag={onFilterByTag}
      />
    </section>
  );
}
