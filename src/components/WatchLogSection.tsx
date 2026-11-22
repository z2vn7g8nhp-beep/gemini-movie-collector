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
      className="mt-5 rounded-2xl border border-[#E4DFD5] bg-white p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 font-editorial text-[16px] font-medium text-[#1A1816] md:text-[15px]">
            <Film className="h-4 w-4 text-[#B43B2B]" aria-hidden="true" />
            <span>观影 / 重温记录</span>
          </h3>
          <p className="mt-0.5 text-xs text-[#7A7268] tabular-nums">
            {totalCount > 0
              ? `已记录 ${totalCount} 次观看${totalCount > 1 ? `（含 ${totalCount - 1} 次重温）` : ''}`
              : '记下实际观看日期与媒介，支持二刷三刷对比感受'}
          </p>
        </div>

        <button
          type="button"
          data-testid="toggle-add-watchlog-btn"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-3 text-xs font-medium text-[#1A1816] whitespace-nowrap cursor-pointer active:scale-[0.97]"
        >
          {adding ? (
            <>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>取消</span>
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5 text-[#B43B2B]" aria-hidden="true" />
              <span>记一次</span>
            </>
          )}
        </button>
      </div>

      {adding && (
        <form
          onSubmit={handleAddLog}
          data-testid="add-watchlog-form"
          className="mt-3.5 space-y-3 rounded-xl border border-[#E4DFD5] bg-[#FAF9F6] p-3.5"
        >
          <div>
            <label
              htmlFor="watchlog-date-input"
              className="block text-xs font-medium text-[#4B453E]"
            >
              观影日期
            </label>
            <input
              id="watchlog-date-input"
              type="date"
              required
              value={watchedAt}
              onChange={(e) => setWatchedAt(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3 font-mono text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-sm"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-[#4B453E]">
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
                    className={`min-h-[38px] rounded-xl text-xs font-medium whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-[#1A1816] text-white'
                        : 'border border-[#DCD6CB] bg-white text-[#4B453E]'
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
              className="block text-xs font-medium text-[#4B453E]"
            >
              这次观影的简短感悟（选填）
            </label>
            <input
              id="watchlog-note-input"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：大银幕重映，细节比当年更震撼"
              className="mt-1 h-11 w-full rounded-xl border border-[#DCD6CB] bg-white px-3 text-[16px] text-[#1A1816] focus:border-[#1A1816] focus:outline-none md:text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            data-testid="submit-watchlog-btn"
            className="h-11 w-full rounded-xl bg-[#B43B2B] text-sm font-medium text-white cursor-pointer active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? '保存中…' : `记录第 ${totalCount + 1} 次观看`}
          </button>
        </form>
      )}

      {logs.length > 0 && (
        <ul className="mt-3 divide-y divide-[#EFECE4]">
          {logs.map((entry, idx) => {
            const watchSeq = totalCount - idx;
            return (
              <li
                key={entry.id}
                data-testid={`watchlog-entry-${entry.id}`}
                className="flex items-start justify-between gap-2 py-2.5 first:pt-1 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs tabular-nums text-[#625C54]">
                    <span className="font-sans font-medium text-[#B43B2B]">
                      {watchSeq === 1 ? '首刷' : `第 ${watchSeq} 刷`}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3 text-[#8C857B]" aria-hidden="true" />
                      {entry.watchedAt}
                    </span>
                    {entry.medium && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans text-[#4B453E]">
                          {WATCH_MEDIUM_LABELS[entry.medium] || entry.medium}
                        </span>
                      </>
                    )}
                  </div>
                  {entry.note && (
                    <p className="mt-1 text-[13px] leading-relaxed text-[#2E2A26]">
                      {entry.note}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteLog(entry.id)}
                  aria-label={`删除 ${entry.watchedAt} 的观影记录`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#9C9488] hover:bg-[#F3EFE8] hover:text-[#B43B2B] cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
