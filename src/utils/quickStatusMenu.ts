import type { ArchiveCategory, CollectionStatus } from '../types/archive';
import { getStatusLabel } from './archive';

export const LONG_PRESS_DURATION_MS = 450;
export const LONG_PRESS_MOVE_THRESHOLD_PX = 10;

export interface QuickStatusOption {
  id: CollectionStatus;
  label: string;
  hint: string;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface RectSize {
  width: number;
  height: number;
}

export interface PopoverCoordinates {
  left: number;
  top: number;
}

const ORDERED_STATUSES: CollectionStatus[] = [
  'favorite',
  'watched',
  'watching',
  'watchlist',
];

export function getQuickStatusOptions(
  category: ArchiveCategory
): QuickStatusOption[] {
  return ORDERED_STATUSES.map((status) => {
    const label = getStatusLabel(status, category);
    let hint = '';
    if (status === 'favorite') {
      hint = '列入私藏挚爱';
    } else if (status === 'watched') {
      hint = category === 'film' ? '已完整观看' : '已归档收录';
    } else if (status === 'watching') {
      hint = category === 'film' ? '正在追看中' : '持续关注动态';
    } else {
      hint = category === 'film' ? '加入待看片单' : '待后续补全资料';
    }
    return { id: status, label, hint };
  });
}

export function isPointerDragExceeded(
  start: Point2D,
  current: Point2D,
  thresholdPx: number = LONG_PRESS_MOVE_THRESHOLD_PX
): boolean {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return Math.hypot(dx, dy) > thresholdPx;
}

export function computeQuickMenuPosition(
  anchor: Point2D,
  menuSize: RectSize,
  viewport: RectSize,
  margin: number = 12
): PopoverCoordinates {
  const safeMargin = Math.max(8, margin);
  const maxLeft = Math.max(safeMargin, viewport.width - menuSize.width - safeMargin);
  const maxTop = Math.max(safeMargin, viewport.height - menuSize.height - safeMargin);

  // Prefer opening slightly offset below-right of the press point, flipping when near edges
  let left = anchor.x - menuSize.width / 2;
  let top = anchor.y + 12;

  if (top + menuSize.height + safeMargin > viewport.height) {
    top = anchor.y - menuSize.height - 12;
  }

  left = Math.min(Math.max(safeMargin, left), maxLeft);
  top = Math.min(Math.max(safeMargin, top), maxTop);

  return {
    left: Math.round(left),
    top: Math.round(top),
  };
}

export function buildQuickStatusNotice(
  title: string,
  status: CollectionStatus,
  category: ArchiveCategory,
  changed: boolean
): string {
  const label = getStatusLabel(status, category);
  if (!changed) {
    return `「${title}」当前已是「${label}」`;
  }
  return `已将「${title}」标记为「${label}」`;
}
