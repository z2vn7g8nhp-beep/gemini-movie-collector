import { useState } from 'react';
import { CalendarDays, Film, Plus, Trash2, X } from 'lucide-react';
import type { ArchiveItem, WatchMedium } from '../types/archive';
import { formatLocalDateKey } from '../utils/collector';
import {
  addWatchLogToItem,
  removeWatchLogFromItem,
  sortWatchLogsDesc,
  WATCH_MEDIUM_LABELS,
} from '../utils/curation';

interface WatchLogSectionProps {
  item: ArchiveItem;
  onUpdateItem: (id: string, patch: Partial<ArchiveItem>) => Promise<void>;
}

const MEDIUM_OPTIONS: WatchMedium[] = [
  'cinema',
  'imax',
  'streaming',
  'bluray',
  'tv',
  'other',
];

export function WatchLogSection({ item, onUpdateItem }: WatchLogSectionProps) {
  const [adding, setAdding] = useState(false);
  const [watchedAt, setWatchedAt] = useState(() => formatLocalDateKey());
  const [medium, setMedium] = useState<WatchMedium>('streaming');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const logs = sortWatchLogsDesc(item.watchLogs);
  // Assign chronological sequence number (1 = 首刷, 2 = 二刷...)
  const totalCount = logs.length;

  const handleAddLog = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const nextLogs = addWatchLogToItem(item, {
        watchedAt,
        medium,
        note,
      });
      const patch: Partial<ArchiveItem> = { watchLogs: nextLogs };
      // If item was still in watchlist, logging a watch naturally advances it to watched
      if (item.status === 'watchlist') {
        patch.status = 'watched';
      }
      await onUpdateItem(item.id, patch);
      setNote('');
      setWatchedAt(formatLocalDateKey());
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLog = async (logId: string) => {
    const nextLogs = removeWatchLogFromItem(item, logId);
    await onUpdateItem(item.id, { watchLogs: nextLogs });
  };

  return (
    <section
      aria-label="观影与重温日志"
      data-testid="watch-log-section"
      className="mt-7 border-t border-[#E6E0D5] pt-5 dark:border-[#2C2721]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-editorial text-[16px] font-medium text-[#1A1816] md:text-[15px] dark:text-[#F3EFE6]">
            <Film className="h-4 w-4 text-[#B43B2B] dark:text-[#EB7865]" aria-hidden="true" />
            <span>观影与重温记录</span>
            {totalCount > 0 && (
              <span className="font-mono text-[11px] font-normal tabular-nums text-[#8C857B] dark:text-[#9A9184]">
                {totalCount} 次
              </span>
            )}
          </h3>
          {totalCount === 0 && (
            <p className="mt-1 text-xs text-[#7A7268] dark:text-[#A59D90]">
              记下实际观看日期与媒介，支持二刷三刷对比感受
            </p>
          )}
        </div>

        <button
          type="button"
          data-testid="toggle-add-watchlog-btn"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg border border-[#DCD6CB] bg-[#FFFDF9] px-3 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer transition-colors hover:border-[#1A1816] active:scale-[0.97] dark:border-[#3A342D] dark:bg-[#1D1A17] dark:text-[#F3EFE6] dark:hover:border-[#D4AF6A]"
        >
          {adding ? (
            <>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>取消</span>
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5 text-[#B43B2B] dark:text-[#EB7865]" aria-hidden="true" />
              <span>记一次</span>
            </>
          )}
        </button>
      </div>

      {adding && (
        <form
          onSubmit={handleAddLog}
          data-testid="add-watchlog-form"
          className="mt-4 space-y-3 rounded-xl border border-[#E4DFD5] bg-[#FFFDF9] p-4 dark:border-[#322D27] dark:bg-[#1D1A17]"
        >
          <div>
            <label
              htmlFor="watchlog-date-input"
              className="block text-xs font-medium text-[#4B453E] dark:text-[#C4BCB0]"
            >
              观影日期
            </label>
            <input
              id="watchlog-date-input"
              type="date"
              required
              value={watchedAt}
              onChange={(e) => setWatchedAt(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-[#DCD6CB] bg-[#FAF9F6] px-3 font-mono text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm dark:border-[#3E3830] dark:bg-[#161310] dark:text-[#F3EFE6] dark:focus:border-[#D4AF6A]"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-[#4B453E] dark:text-[#C4BCB0]">
              观影方式 / 媒介
            </span>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {MEDIUM_OPTIONS.map((m) => {
                const active = medium === m;
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setMedium(m)}
                    className={`min-h-[36px] rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                      active
                        ? 'bg-[#1A1816] text-white dark:bg-[#F3EFE6] dark:text-[#141210]'
                        : 'border border-[#DCD6CB] bg-transparent text-[#4B453E] hover:border-[#1A1816] dark:border-[#3E3830] dark:text-[#C4BCB0] dark:hover:border-[#D4AF6A]'
                    }`}
                  >
                    {WATCH_MEDIUM_LABELS[m]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="watchlog-note-input"
              className="block text-xs font-medium text-[#4B453E] dark:text-[#C4BCB0]"
            >
              这次观影的简短感悟（选填）
            </label>
            <input
              id="watchlog-note-input"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：大银幕重映，细节比当年更震撼"
              className="mt-1 h-10 w-full rounded-lg border border-[#DCD6CB] bg-[#FAF9F6] px-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:bg-white focus:outline-none md:text-sm dark:border-[#3E3830] dark:bg-[#161310] dark:text-[#F3EFE6] dark:placeholder:text-[#8E8578] dark:focus:border-[#D4AF6A]"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            data-testid="submit-watchlog-btn"
            className="h-10 w-full rounded-lg bg-[#B43B2B] text-sm font-medium text-white cursor-pointer transition-colors hover:bg-[#932D20] active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? '保存中…' : `记录第 ${totalCount + 1} 次观看`}
          </button>
        </form>
      )}

      {logs.length > 0 && (
        <ol className="relative mt-4 space-y-4 pl-5 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-[#E2DBD0] dark:before:bg-[#322D27]">
          {logs.map((entry, idx) => {
            const watchSeq = totalCount - idx;
            return (
              <li
                key={entry.id}
                data-testid={`watchlog-entry-${entry.id}`}
                className="group relative flex items-start justify-between gap-2"
              >
                <span
                  aria-hidden="true"
                  className={`absolute -left-5 top-1.5 h-[11px] w-[11px] rounded-full border-2 ${
                    idx === 0
                      ? 'border-[#B43B2B] bg-[#F7F5F0] dark:border-[#E4C37A] dark:bg-[#141210]'
                      : 'border-[#CFC7B9] bg-[#F7F5F0] dark:border-[#534A40] dark:bg-[#141210]'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs tabular-nums text-[#625C54] dark:text-[#A59D90]">
                    <span className="font-sans font-medium text-[#B43B2B] dark:text-[#E4C37A]">
                      {watchSeq === 1 ? '首刷' : `第 ${watchSeq} 刷`}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3 text-[#8C857B] dark:text-[#9A9184]" aria-hidden="true" />
                      {entry.watchedAt}
                    </span>
                    {entry.medium && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans text-[#4B453E] dark:text-[#C4BCB0]">
                          {WATCH_MEDIUM_LABELS[entry.medium] || entry.medium}
                        </span>
                      </>
                    )}
                  </div>
                  {entry.note && (
                    <p className="mt-1 text-[13.5px] leading-[1.65] text-[#2E2A26] dark:text-[#E5DED2]">
                      {entry.note}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteLog(entry.id)}
                  aria-label={`删除 ${entry.watchedAt} 的观影记录`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#A1988B] opacity-70 transition-all hover:bg-[#EFEAE0] hover:text-[#B43B2B] hover:opacity-100 cursor-pointer md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 dark:text-[#8E8578] dark:hover:bg-[#2C2721] dark:hover:text-[#F28C7B]"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
