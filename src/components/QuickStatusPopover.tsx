import { useEffect, useRef } from 'react';
import { Bookmark, Check, CheckCircle2, Eye, Heart, X } from 'lucide-react';
import type { ArchiveItem, CollectionStatus } from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import {
  computeQuickMenuPosition,
  getQuickStatusOptions,
  type Point2D,
} from '../utils/quickStatusMenu';

interface QuickStatusPopoverProps {
  item: ArchiveItem;
  anchor: Point2D;
  onSelectStatus: (item: ArchiveItem, status: CollectionStatus) => void;
  onClose: () => void;
}

const MENU_WIDTH = 264;
const MENU_ESTIMATED_HEIGHT = 292;

function StatusIcon({
  status,
  active,
}: {
  status: CollectionStatus;
  active: boolean;
}) {
  const cls = `h-4 w-4 shrink-0 ${
    active
      ? status === 'favorite'
        ? 'fill-[#B43B2B] text-[#B43B2B] dark:fill-[#EB7865] dark:text-[#EB7865]'
        : 'text-[#B43B2B] dark:text-[#EB7865]'
      : status === 'favorite'
        ? 'text-[#B43B2B]/80 dark:text-[#EB7865]/80'
        : 'text-[#6E665C] dark:text-[#A59D90]'
  }`;

  if (status === 'favorite') return <Heart className={cls} aria-hidden="true" />;
  if (status === 'watched') return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (status === 'watching') return <Eye className={cls} aria-hidden="true" />;
  return <Bookmark className={cls} aria-hidden="true" />;
}

export function QuickStatusPopover({
  item,
  anchor,
  onSelectStatus,
  onClose,
}: QuickStatusPopoverProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const mountedAtRef = useRef<number>(Date.now());
  const options = getQuickStatusOptions(item.category);

  const viewportWidth =
    typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight =
    typeof window !== 'undefined' ? window.innerHeight : 800;
  const isCompactMobile = viewportWidth < 640;

  const desktopCoords = computeQuickMenuPosition(
    anchor,
    { width: MENU_WIDTH, height: MENU_ESTIMATED_HEIGHT },
    { width: viewportWidth, height: viewportHeight },
    14
  );

  useEffect(() => {
    mountedAtRef.current = Date.now();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const firstActive = menuRef.current?.querySelector<HTMLButtonElement>(
      '[data-current-status="true"]'
    );
    const firstOption = menuRef.current?.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"]'
    );
    (firstActive ?? firstOption)?.focus({ preventScroll: true });
  }, [item.id]);

  const handleBackdropClick = () => {
    if (Date.now() - mountedAtRef.current < 160) return;
    onClose();
  };

  return (
    <div
      data-testid="quick-status-overlay"
      className="fixed inset-0 z-[60]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Dimmed backdrop on mobile, subtle click-catcher on desktop */}
      <button
        type="button"
        aria-label="关闭快速标记状态菜单"
        tabIndex={-1}
        onClick={handleBackdropClick}
        className={`encounter-backdrop-in fixed inset-0 cursor-default ${
          isCompactMobile
            ? 'bg-[#1A1816]/45 backdrop-blur-[1.5px] dark:bg-black/65'
            : 'bg-[#1A1816]/15 dark:bg-black/40'
        }`}
      />

      <div
        ref={menuRef}
        role="menu"
        aria-label={`快速标记「${item.title}」状态`}
        data-testid="quick-status-menu"
        data-item-id={item.id}
        style={
          isCompactMobile
            ? undefined
            : {
                left: `${desktopCoords.left}px`,
                top: `${desktopCoords.top}px`,
              }
        }
        className={
          isCompactMobile
            ? 'drawer-panel-in fixed inset-x-3 bottom-[calc(14px+env(safe-area-inset-bottom))] z-10 overflow-hidden rounded-2xl border border-[#DFD8CA] bg-[#FFFDF9] shadow-[0_22px_50px_-14px_rgba(20,16,12,0.38)] dark:border-[#3A342D] dark:bg-[#1D1A17] dark:shadow-[0_24px_56px_-14px_rgba(0,0,0,0.75)]'
            : 'toast-pop-in fixed z-10 w-[264px] overflow-hidden rounded-2xl border border-[#DDD6C8] bg-[#FFFDF9] shadow-[0_20px_48px_-14px_rgba(20,16,12,0.32)] dark:border-[#3A342D] dark:bg-[#1D1A17] dark:shadow-[0_24px_56px_-14px_rgba(0,0,0,0.75)]'
        }
      >
        {/* Header with item context */}
        <div className="flex items-start justify-between gap-2 border-b border-[#ECE6DA] bg-[#FAF7F1] px-3.5 py-2.5 dark:border-[#302B25] dark:bg-[#24201C]">
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.12em] text-[#8C857B] dark:text-[#9E9588]">
              快速标记状态 · {CATEGORY_LABELS[item.category]}
            </p>
            <p className="mt-0.5 truncate font-editorial text-sm font-medium text-[#1A1816] dark:text-[#F3EFE6]">
              {item.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭菜单"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#7A7268] transition-colors hover:bg-[#EFEAE0] hover:text-[#1A1816] cursor-pointer dark:text-[#A59D90] dark:hover:bg-[#322C26] dark:hover:text-[#F3EFE6]"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Status Options */}
        <div className="space-y-1 p-2">
          {options.map((opt) => {
            const isCurrent = item.status === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                data-current-status={isCurrent ? 'true' : 'false'}
                data-testid={`quick-status-option-${opt.id}`}
                onClick={() => {
                  onSelectStatus(item, opt.id);
                  onClose();
                }}
                className={`flex w-full min-h-[44px] items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left transition-colors cursor-pointer active:scale-[0.98] ${
                  isCurrent
                    ? 'border border-[#E6C5BE] bg-[#FDF5F3] text-[#1A1816] dark:border-[#6B3229] dark:bg-[#351B17] dark:text-[#FAF7F0]'
                    : 'border border-transparent text-[#1A1816] hover:bg-[#F5F1E8] dark:text-[#F3EFE6] dark:hover:bg-[#27231E]'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <StatusIcon status={opt.id} active={isCurrent} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-tight">
                      {opt.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-tight text-[#7A7268] dark:text-[#A59D90]">
                      {opt.hint}
                    </span>
                  </span>
                </span>
                {isCurrent && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#B43B2B]/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#B43B2B] dark:bg-[#EB7865]/15 dark:text-[#F28C7B]">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    当前
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
