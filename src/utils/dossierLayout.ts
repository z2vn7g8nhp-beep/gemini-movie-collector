import type { ArchiveItem } from '../types/archive';

export type DossierSectionId = 'overview' | 'relations' | 'notes' | 'graph';

export interface DossierSectionTab {
  id: DossierSectionId;
  label: string;
  count?: number;
}

export interface AccessionMetadataRow {
  key: string;
  label: string;
  value: string;
  href?: string;
  mono?: boolean;
}

export function buildDossierSectionTabs(params: {
  relatedCount: number;
  tagCount: number;
  hasUnsavedChanges: boolean;
}): DossierSectionTab[] {
  const { relatedCount, tagCount, hasUnsavedChanges } = params;
  const networkCount = relatedCount + tagCount;
  return [
    { id: 'overview', label: '档案概览' },
    {
      id: 'relations',
      label: '标签与脉络',
      count: networkCount > 0 ? networkCount : undefined,
    },
    {
      id: 'notes',
      label: hasUnsavedChanges ? '手记 · 未保存' : '手记与编辑',
    },
    { id: 'graph', label: '关联图谱' },
  ];
}

/**
 * Computes which dossier section is currently active based on scroll position
 * inside the drawer scroll container.
 */
export function computeActiveDossierSection(
  scrollTop: number,
  sectionOffsets: Partial<Record<DossierSectionId, number>>,
  maxScrollTop: number,
  thresholdPx = 96
): DossierSectionId {
  const order: DossierSectionId[] = ['overview', 'relations', 'notes', 'graph'];
  if (scrollTop <= 24) return 'overview';

  if (maxScrollTop > 40 && scrollTop >= maxScrollTop - 24) {
    for (let i = order.length - 1; i >= 0; i -= 1) {
      if (typeof sectionOffsets[order[i]] === 'number') {
        return order[i];
      }
    }
  }

  let active: DossierSectionId = 'overview';
  for (const id of order) {
    const offset = sectionOffsets[id];
    if (typeof offset === 'number' && scrollTop + thresholdPx >= offset) {
      active = id;
    }
  }
  return active;
}

/**
 * Returns clamped 0..100 scroll progress percentage for the thin reading bar.
 */
export function computeReadingProgress(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
): number {
  const scrollable = scrollHeight - clientHeight;
  if (scrollable <= 0 || scrollTop <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, scrollTop / scrollable));
  return Math.round(ratio * 100);
}

/**
 * Builds structured museum accession metadata rows for the dossier ledger.
 */
export function buildAccessionMetadataRows(
  item: ArchiveItem,
  watchCount: number
): AccessionMetadataRow[] {
  const rows: AccessionMetadataRow[] = [
    {
      key: 'accession',
      label: '馆藏编号',
      value: item.accessionNo,
      mono: true,
    },
  ];

  if (item.year || item.region) {
    rows.push({
      key: 'origin',
      label: item.category === 'person' ? '生年 / 地区' : '年代 / 地区',
      value: [item.year, item.region].filter(Boolean).join(' · '),
      mono: Boolean(item.year && !item.region),
    });
  }

  if (item.category === 'film' && item.relatedWorkTitle) {
    rows.push({
      key: 'director',
      label: '导演 / 主创',
      value: item.relatedWorkTitle,
    });
  } else if (item.category === 'person' && item.relatedWorkTitle) {
    rows.push({
      key: 'works',
      label: '代表作品',
      value: item.relatedWorkTitle,
    });
  }

  if (item.category === 'film') {
    rows.push({
      key: 'watches',
      label: '观影记录',
      value: watchCount > 0 ? `已看 ${watchCount} 次` : '尚未记录',
      mono: watchCount > 0,
    });
  }

  if (item.sourceName) {
    rows.push({
      key: 'source',
      label: '档案来源',
      value: item.sourceName,
      href: item.sourceUrl,
    });
  }

  return rows;
}
