import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  GitBranch,
  Link2,
  Route,
  Sparkles,
  X,
} from 'lucide-react';
import type { ArchiveCategory, ArchiveItem } from '../types/archive';
import { CATEGORY_LABELS } from '../utils/archive';
import {
  getNodeVisualStyle,
  type FocusedNodeRelationContext,
  type GlobalGraphModel,
  type GlobalGraphNode,
  type GraphPathResult,
} from '../utils/globalGraph';
import { ArchivalImage } from './ArchivalImage';

const CATEGORY_DOT_COLOR: Record<ArchiveCategory, string> = {
  film: '#D85745',
  person: '#E4C37A',
  character: '#7AB59E',
};

type InspectorTab = 'direct' | 'second-hop' | 'tags';

interface GlobalGraphInspectorProps {
  graph: GlobalGraphModel;
  focusContext: FocusedNodeRelationContext | null;
  pathPicking: boolean;
  pathTargetNode: GlobalGraphNode | null;
  activePath: GraphPathResult | null;
  linkingKey: string | null;
  onFocusNode: (nodeId: string, recenter?: boolean) => void;
  onClearFocus: () => void;
  onOpenDetail: (item: ArchiveItem) => void;
  onStartPathPicking: () => void;
  onSelectPathTarget: (nodeId: string) => void;
  onSwapPathEnds: () => void;
  onClearPath: () => void;
  onPersistSingleLink?: (sourceId: string, targetId: string) => void;
}

export function GlobalGraphInspector({
  graph,
  focusContext,
  pathPicking,
  pathTargetNode,
  activePath,
  linkingKey,
  onFocusNode,
  onClearFocus,
  onOpenDetail,
  onStartPathPicking,
  onSelectPathTarget,
  onSwapPathEnds,
  onClearPath,
  onPersistSingleLink,
}: GlobalGraphInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('direct');
  const focusedNode = focusContext?.focusedNode ?? null;

  // Reset tab to 'direct' when switching focused node or exiting path mode
  useEffect(() => {
    if (!focusContext || pathPicking || pathTargetNode) return;
    if (focusContext.directRelations.length > 0) {
      setTab('direct');
    } else if (focusContext.secondHopRelations.length > 0) {
      setTab('second-hop');
    } else if (focusContext.tagRelations.length > 0) {
      setTab('tags');
    } else {
      setTab('direct');
    }
  }, [focusContext?.focusedNode.id, pathPicking, pathTargetNode?.id]);

  // 1. Path Picking Prompt Mode
  if (focusedNode && pathPicking && !pathTargetNode) {
    const candidateTargets = graph.nodes
      .filter((n) => n.id !== focusedNode.id)
      .sort((a, b) => {
        const sameClusterA = a.clusterIndex === focusedNode.clusterIndex ? 1 : 0;
        const sameClusterB = b.clusterIndex === focusedNode.clusterIndex ? 1 : 0;
        if (sameClusterB !== sameClusterA) return sameClusterB - sameClusterA;
        return b.degree - a.degree;
      })
      .slice(0, 10);

    return (
      <div
        data-testid="global-graph-path-picker"
        className="border-t border-white/10 bg-[#1C1A17] px-4 pt-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] min-[420px]:px-5"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-[#F9B49F]">
              <Route className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                路径追踪：选择与「{focusedNode.item.title}」连通的目标节点
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-[#A59D90]">
              直接在上方星图点击任意节点，或从下方快捷选择终点
            </p>
          </div>
          <button
            type="button"
            onClick={onClearPath}
            className="inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 text-xs text-[#CFC7B9] whitespace-nowrap hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span>取消</span>
          </button>
        </div>

        <div className="h-scroll-rail no-scrollbar mt-2.5 flex items-center gap-1.5 pb-0.5">
          {candidateTargets.map((cand) => (
            <button
              key={cand.id}
              type="button"
              data-testid={`path-target-option-${cand.id}`}
              onClick={() => onSelectPathTarget(cand.id)}
              className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.04] px-2.5 text-xs text-[#FAF7F0] whitespace-nowrap hover:border-[#F4896B]/70 hover:bg-[#F4896B]/15 cursor-pointer"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: CATEGORY_DOT_COLOR[cand.item.category] }}
              />
              <span className="max-w-[120px] truncate">{cand.item.title}</span>
              <span className="text-[10px] text-[#9E9587]">
                {CATEGORY_LABELS[cand.item.category]}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // 2. Active Shortest-Path Result Panel
  if (focusedNode && pathTargetNode) {
    return (
      <div
        data-testid="global-graph-path-result"
        className="border-t border-white/10 bg-[#1C1A17] px-4 pt-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] min-[420px]:px-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#FAF7F0]">
              <Route className="h-3.5 w-3.5 shrink-0 text-[#F4896B]" aria-hidden="true" />
              <span className="truncate">{focusedNode.item.title}</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-[#8C857B]" aria-hidden="true" />
              <span className="truncate">{pathTargetNode.item.title}</span>
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-[#A59D90] tabular-nums">
              {activePath
                ? `${activePath.hopCount} 步连通${activePath.usesTagBridge ? ' · 含共签桥接' : ' · 影史脉络直达'}`
                : '当前筛选下两者位于不同关系簇，暂无连通路径'}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onSwapPathEnds}
              aria-label="交换起点与终点"
              className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 text-xs text-[#CFC7B9] whitespace-nowrap hover:bg-white/10 hover:text-white cursor-pointer"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
              <span>对调</span>
            </button>
            <button
              type="button"
              onClick={onStartPathPicking}
              className="min-h-[34px] rounded-lg border border-white/15 bg-white/5 px-2.5 text-xs text-[#CFC7B9] whitespace-nowrap hover:bg-white/10 hover:text-white cursor-pointer"
            >
              重选终点
            </button>
            <button
              type="button"
              onClick={onClearPath}
              className="min-h-[34px] rounded-lg border border-[#F4896B]/45 bg-[#F4896B]/15 px-2.5 text-xs font-medium text-[#FFD3C5] whitespace-nowrap hover:bg-[#F4896B]/25 cursor-pointer"
            >
              退出路径
            </button>
          </div>
        </div>

        {activePath ? (
          <div className="h-scroll-rail no-scrollbar mt-2.5 flex items-center gap-1.5 pb-0.5">
            {activePath.steps.map((step, idx) => (
              <div key={step.edge.id} className="flex shrink-0 items-center gap-1.5">
                {idx === 0 && (
                  <button
                    type="button"
                    onClick={() => onFocusNode(step.fromNode.id, true)}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#F4896B]/55 bg-[#F4896B]/14 px-2.5 text-xs font-medium text-[#FAF7F0] whitespace-nowrap cursor-pointer"
                  >
                    <span className="font-mono text-[10px] text-[#F9B49F] tabular-nums">
                      1
                    </span>
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: CATEGORY_DOT_COLOR[step.fromNode.item.category],
                      }}
                    />
                    <span className="max-w-[100px] truncate">{step.fromNode.item.title}</span>
                  </button>
                )}

                <div className="flex flex-col items-center px-1 text-center">
                  <span className="text-[10px] font-medium text-[#F5DC9B] whitespace-nowrap">
                    {step.shortLabel}
                  </span>
                  <span className="text-[9px] text-[#8C857B] whitespace-nowrap">
                    {step.edge.kind === 'inferred'
                      ? '自动发现'
                      : step.edge.kind === 'tag'
                        ? '共签'
                        : '直连'}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onFocusNode(step.toNode.id, true)}
                  className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium text-[#FAF7F0] whitespace-nowrap cursor-pointer ${
                    idx === activePath.steps.length - 1
                      ? 'border-[#F4896B]/65 bg-[#F4896B]/18'
                      : 'border-white/15 bg-white/[0.05] hover:border-[#D4AF6A]/60'
                  }`}
                >
                  <span className="font-mono text-[10px] text-[#F9B49F] tabular-nums">
                    {idx + 2}
                  </span>
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: CATEGORY_DOT_COLOR[step.toNode.item.category],
                    }}
                  />
                  <span className="max-w-[100px] truncate">{step.toNode.item.title}</span>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[#A59D90]">
            可开启「自动发现」或「共签连线」扩展连通范围，或在档案详情中手动补充关联。
          </p>
        )}
      </div>
    );
  }

  // 3. Focused Node Inspector Panel
  if (focusContext && focusedNode) {
    const directCount = focusContext.directRelations.length;
    const secondHopCount = focusContext.secondHopRelations.length;
    const tagCount = focusContext.tagRelations.length;

    return (
      <div
        data-testid="global-graph-inspector"
        className="border-t border-white/10 bg-[#1C1A17] px-4 pt-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))] min-[420px]:px-5"
      >
        {/* Focused Item Header Row */}
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <ArchivalImage
              src={focusedNode.item.coverUrl}
              alt={focusedNode.item.title}
              title={focusedNode.item.title}
              category={focusedNode.item.category}
              compact
              className="h-12 w-9 shrink-0 rounded-lg"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-[#D4AF6A] tabular-nums">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: CATEGORY_DOT_COLOR[focusedNode.item.category],
                  }}
                />
                <span>{CATEGORY_LABELS[focusedNode.item.category]}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {directCount > 0 ? `直接关联 ${directCount} 项` : '尚未建立直连'}
                </span>
                {secondHopCount > 0 && (
                  <span className="whitespace-nowrap text-[#BDB5A8]">
                    <span aria-hidden="true" className="mr-1.5 text-[#D4AF6A]">
                      ·
                    </span>
                    二度脉络 {secondHopCount} 项
                  </span>
                )}
              </div>
              <p className="truncate font-editorial text-[15px] font-medium text-[#FAF7F0]">
                {focusedNode.item.title}
                {focusedNode.item.year ? (
                  <span className="ml-1.5 font-mono text-[11px] font-normal text-[#A59D90]">
                    {focusedNode.item.year}
                  </span>
                ) : null}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {graph.nodes.length >= 2 && (
              <button
                type="button"
                data-testid="global-graph-trace-path-btn"
                onClick={onStartPathPicking}
                aria-label={`追踪与${focusedNode.item.title}的关联路径`}
                className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-2.5 text-xs font-medium text-[#E5DEC9] whitespace-nowrap hover:border-[#F4896B]/60 hover:bg-[#F4896B]/12 hover:text-white cursor-pointer"
              >
                <Route className="h-3.5 w-3.5 text-[#F4896B]" aria-hidden="true" />
                <span className="hidden min-[440px]:inline">追踪路径</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClearFocus}
              aria-label="取消聚焦，返回全馆星图全景"
              className="min-h-[38px] rounded-xl border border-white/15 bg-white/5 px-2.5 text-xs font-medium text-[#CFC7B9] whitespace-nowrap hover:bg-white/10 hover:text-white cursor-pointer"
            >
              全景
            </button>
            <button
              type="button"
              onClick={() => onOpenDetail(focusedNode.item)}
              className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-[#B43B2B] px-3 text-xs font-medium text-white whitespace-nowrap hover:bg-[#C64635] cursor-pointer active:scale-[0.97]"
            >
              <span>{focusedNode.isIsolated ? '去关联' : '查看档案'}</span>
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Relation Layer Tabs & Interactive Navigation Strip */}
        <div
          data-testid="global-graph-relations"
          className="mt-2.5 border-t border-white/8 pt-2.5"
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div
              role="tablist"
              aria-label="关联脉络视图"
              className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'direct'}
                onClick={() => setTab('direct')}
                className={`inline-flex min-h-[28px] items-center gap-1 rounded-md px-2.5 text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                  tab === 'direct'
                    ? 'bg-[#FAF7F0] text-[#1A1816]'
                    : 'text-[#BDB5A8] hover:text-white'
                }`}
              >
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                <span>直接关联 ({directCount})</span>
              </button>

              {secondHopCount > 0 && (
                <button
                  type="button"
                  role="tab"
                  data-testid="global-graph-second-hop-tab"
                  aria-selected={tab === 'second-hop'}
                  onClick={() => setTab('second-hop')}
                  className={`inline-flex min-h-[28px] items-center gap-1 rounded-md px-2.5 text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                    tab === 'second-hop'
                      ? 'bg-[#FAF7F0] text-[#1A1816]'
                      : 'text-[#BDB5A8] hover:text-white'
                  }`}
                >
                  <GitBranch className="h-3 w-3" aria-hidden="true" />
                  <span>二度脉络 ({secondHopCount})</span>
                </button>
              )}

              {tagCount > 0 && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'tags'}
                  onClick={() => setTab('tags')}
                  className={`inline-flex min-h-[28px] items-center gap-1 rounded-md px-2.5 text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                    tab === 'tags'
                      ? 'bg-[#FAF7F0] text-[#1A1816]'
                      : 'text-[#BDB5A8] hover:text-white'
                  }`}
                >
                  <span>共签延伸 ({tagCount})</span>
                </button>
              )}
            </div>

            <span className="text-[10px] text-[#8C857B]">
              点击切换聚焦 · 双击星图节点直达档案
            </span>
          </div>

          {tab === 'direct' && (
            <>
              {directCount > 0 ? (
                <div className="h-scroll-rail no-scrollbar flex gap-2 pb-0.5 sm:grid sm:max-h-[168px] sm:grid-cols-2 sm:overflow-y-auto sm:pr-0.5 md:grid-cols-3">
                  {focusContext.directRelations.map((rel) => {
                    const isInferred = rel.kind === 'inferred';
                    const pairLockKey =
                      focusedNode.id < rel.node.id
                        ? `${focusedNode.id}::${rel.node.id}`
                        : `${rel.node.id}::${focusedNode.id}`;
                    const isSaving = linkingKey === pairLockKey;

                    return (
                      <div
                        key={rel.edgeId}
                        data-testid={`global-relation-card-${rel.node.id}`}
                        data-relation-strength={rel.strength}
                        data-relation-kind={rel.kind}
                        className={`flex w-[236px] shrink-0 flex-col justify-between gap-1 rounded-xl border px-3 py-2 text-left transition-colors sm:w-auto ${
                          isInferred
                            ? 'border-[#6EBFA5]/38 bg-[#6EBFA5]/[0.07] hover:border-[#86D1B8]/70 hover:bg-[#6EBFA5]/[0.12]'
                            : rel.strength === 3
                              ? 'border-[#E8C472]/55 bg-[#D4AF6A]/[0.09] hover:border-[#F5D688]/80 hover:bg-[#D4AF6A]/[0.15]'
                              : rel.strength === 2
                                ? 'border-[#D4AF6A]/28 bg-white/[0.04] hover:border-[#D4AF6A]/60 hover:bg-white/[0.09]'
                                : 'border-white/12 bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.06]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onFocusNode(rel.node.id, true)}
                          className="flex w-full flex-col gap-1 text-left cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: getNodeVisualStyle(
                                    rel.node.item.category,
                                    rel.strength,
                                    'direct-neighbor'
                                  ).dot,
                                }}
                              />
                              <span className="truncate text-xs font-medium text-[#FAF7F0]">
                                {rel.node.item.title}
                              </span>
                            </span>
                            <span
                              className={`inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium whitespace-nowrap ${
                                isInferred ? 'text-[#9EE0C9]' : 'text-[#F5DC9B]'
                              }`}
                            >
                              <span
                                className="inline-flex items-end gap-[2px]"
                                title={`关联强度：${rel.strengthLabel}`}
                                aria-label={`关联强度：${rel.strengthLabel}`}
                              >
                                {[1, 2, 3].map((bar) => (
                                  <span
                                    key={bar}
                                    className={`w-[2.5px] rounded-full ${
                                      bar === 1
                                        ? 'h-[4px]'
                                        : bar === 2
                                          ? 'h-[7px]'
                                          : 'h-[10px]'
                                    } ${
                                      bar <= rel.strength
                                        ? isInferred
                                          ? 'bg-[#86D1B8]'
                                          : rel.strength === 3
                                            ? 'bg-[#F5D688]'
                                            : 'bg-[#D4AF6A]'
                                        : 'bg-white/18'
                                    }`}
                                  />
                                ))}
                              </span>
                              <span>{rel.shortLabel}</span>
                            </span>
                          </div>
                          <p className="truncate text-[11px] text-[#BDB5A8]">
                            {rel.description}
                            {rel.mutualCount > 0 ? ` · ${rel.mutualCount}项共联` : ''}
                          </p>
                        </button>

                        {isInferred && rel.isPersistable && onPersistSingleLink && (
                          <div className="mt-0.5 flex items-center justify-between gap-2 border-t border-white/8 pt-1">
                            <span className="truncate text-[10px] text-[#86D1B8]">
                              {rel.evidence || '自动发现脉络'}
                            </span>
                            <button
                              type="button"
                              disabled={isSaving}
                              data-testid={`persist-link-${rel.node.id}`}
                              onClick={() => onPersistSingleLink(focusedNode.id, rel.node.id)}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#86D1B8]/40 bg-[#86D1B8]/12 px-1.5 py-0.5 text-[10px] font-medium text-[#C8F3E4] whitespace-nowrap hover:bg-[#86D1B8]/25 disabled:opacity-50 cursor-pointer"
                            >
                              {isSaving ? (
                                <Check className="h-2.5 w-2.5" aria-hidden="true" />
                              ) : (
                                <Link2 className="h-2.5 w-2.5" aria-hidden="true" />
                              )}
                              <span>{isSaving ? '写入中' : '存入关联'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-[#A59D90]">
                  该条目尚未建立直接关联，点击「去关联」即可在档案中将其与馆内影视、影人或角色连线。
                </p>
              )}
            </>
          )}

          {tab === 'second-hop' && (
            <div className="h-scroll-rail no-scrollbar flex gap-2 pb-0.5 sm:grid sm:max-h-[168px] sm:grid-cols-2 sm:overflow-y-auto sm:pr-0.5 md:grid-cols-3">
              {focusContext.secondHopRelations.map((rel) => (
                <button
                  key={`hop2-${rel.node.id}`}
                  type="button"
                  data-testid={`global-second-hop-card-${rel.node.id}`}
                  onClick={() => onFocusNode(rel.node.id, true)}
                  className="flex w-[224px] shrink-0 flex-col gap-1 rounded-xl border border-white/12 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-[#D4AF6A]/55 hover:bg-white/[0.07] cursor-pointer sm:w-auto"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: CATEGORY_DOT_COLOR[rel.node.item.category],
                        }}
                      />
                      <span className="truncate text-xs font-medium text-[#FAF7F0]">
                        {rel.node.item.title}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[#BDB5A8]">
                      {CATEGORY_LABELS[rel.node.item.category]}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-[#A59D90]">
                    {rel.bridgeSummary}
                  </p>
                </button>
              ))}
            </div>
          )}

          {tab === 'tags' && (
            <div className="h-scroll-rail no-scrollbar flex gap-2 pb-0.5 sm:grid sm:max-h-[120px] sm:grid-cols-2 sm:overflow-y-auto sm:pr-0.5 md:grid-cols-3">
              {focusContext.tagRelations.map((rel) => (
                <button
                  key={rel.edgeId}
                  type="button"
                  onClick={() => onFocusNode(rel.node.id, true)}
                  className="flex w-[210px] shrink-0 flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left hover:border-white/25 hover:bg-white/[0.07] cursor-pointer sm:w-auto"
                >
                  <span className="truncate text-xs font-medium text-[#FAF7F0]">
                    {rel.node.item.title}
                  </span>
                  <span className="truncate text-[11px] text-[#9E9587]">
                    {rel.description}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 4. Panoramic Idle Footer
  return (
    <div
      data-testid="global-graph-idle-hint"
      className="flex items-center justify-between gap-3 border-t border-white/10 bg-[#1C1A17] px-4 py-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))] min-[420px]:px-5"
    >
      <p className="text-xs text-[#BDB5A8]">
        点击任意节点查看一、二度影史脉络与角色关系，或使用检索与路径追踪穿行全馆关系网
      </p>
      {graph.hubs[0] && (
        <button
          type="button"
          onClick={() => onFocusNode(graph.hubs[0].id, true)}
          className="shrink-0 rounded-xl border border-[#D4AF6A]/40 bg-[#D4AF6A]/15 px-3 py-1.5 text-xs font-medium text-[#F5DC9B] whitespace-nowrap hover:bg-[#D4AF6A]/25 cursor-pointer"
        >
          聚焦核心枢纽
        </button>
      )}
    </div>
  );
}
