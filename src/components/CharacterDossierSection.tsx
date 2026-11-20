import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  PencilLine,
  RefreshCw,
} from 'lucide-react';
import type { ArchiveItem } from '../types/archive';
import {
  buildDossierSpecs,
  hasDossierDetails,
} from '../utils/characterProfile';

interface CharacterDossierSectionProps {
  item: ArchiveItem;
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onJumpToEditSpecs: () => void;
}

export function CharacterDossierSection({
  item,
  loading,
  error,
  onRefresh,
  onJumpToEditSpecs,
}: CharacterDossierSectionProps) {
  const [bioExpanded, setBioExpanded] = useState(false);

  const profile = item.characterProfile;
  const specs = buildDossierSpecs(item);
  const rawBio = (profile?.bio || item.summary || '').trim();
  const isLongBio = rawBio.length > 180;
  const displayedBio =
    isLongBio && !bioExpanded ? `${rawBio.slice(0, 180).trim()}…` : rawBio;

  const hasContent =
    specs.length > 0 || Boolean(rawBio) || Boolean(profile?.highlights) || hasDossierDetails(profile);

  return (
    <section
      className="mt-5 rounded-2xl border border-[#E4DFD5] bg-white px-4 py-4 sm:px-5"
      aria-label="角色档案"
      data-testid="character-dossier-section"
    >
      {/* Dossier Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-editorial text-[18px] font-medium text-[#1A1816] md:text-base">
            角色档案
          </h3>
          {profile?.dossierSource ? (
            <p className="mt-0.5 text-[12px] text-[#7A7268] md:text-[11px]">
              资料来源：{profile.dossierSource}
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] text-[#7A7268] md:text-[11px]">
              身份设定 · 人物小传 · 高光记忆
            </p>
          )}
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={onRefresh}
          aria-label="联网补全或刷新角色档案"
          className="inline-flex min-h-[42px] shrink-0 items-center gap-1.5 rounded-xl border border-[#E4DFD5] bg-[#FAF9F6] px-3 text-[13px] font-medium text-[#3D3832] whitespace-nowrap cursor-pointer active:scale-[0.98] hover:border-[#BFB6A7] disabled:opacity-50 md:min-h-[40px] md:text-xs"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#B43B2B]" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 text-[#625C54]" />
          )}
          {loading ? '补全中' : '联网补全'}
        </button>
      </div>

      {/* Loading skeleton / indicator when no content yet */}
      {loading && !hasContent ? (
        <div className="mt-4 flex items-center justify-center gap-2 py-6 text-[13px] text-[#7A7268] md:text-xs">
          <Loader2 className="h-4 w-4 animate-spin text-[#B43B2B]" />
          <span>正在检索角色背景与设定资料…</span>
        </div>
      ) : hasContent ? (
        <div className="mt-4 space-y-4">
          {/* Structured 2-Column Spec Grid */}
          {specs.length > 0 && (
            <dl
              data-testid="character-dossier-specs"
              className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[#EFECE5] pt-3.5"
            >
              {specs.map((row) => (
                <div
                  key={row.key}
                  className={row.wide ? 'col-span-2' : 'col-span-1'}
                >
                  <dt className="text-[12px] text-[#7A7268] md:text-[11px]">{row.label}</dt>
                  <dd className="mt-0.5 text-[14px] font-medium leading-snug text-[#1A1816] break-words md:text-[13px]">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {/* Character Biography */}
          {rawBio && (
            <div className="border-t border-[#EFECE5] pt-3.5">
              <h4 className="text-[12px] font-medium tracking-[0.06em] text-[#7A7268] md:text-[11px]">
                人物小传
              </h4>
              <p
                data-testid="character-dossier-bio"
                className="mt-1.5 whitespace-pre-line text-[15px] leading-[1.75] text-[#2E2A26] md:text-[14px]"
              >
                {displayedBio}
              </p>
              {isLongBio && (
                <button
                  type="button"
                  onClick={() => setBioExpanded((v) => !v)}
                  className="mt-2 inline-flex min-h-[40px] items-center gap-1 text-[13px] font-medium text-[#B43B2B] cursor-pointer md:min-h-[36px] md:text-xs"
                >
                  {bioExpanded ? (
                    <>
                      收起小传
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </>
                  ) : (
                    <>
                      展开完整小传
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Personal Highlights / Memorable Scenes */}
          {profile?.highlights && (
            <div className="border-t border-[#EFECE5] pt-3.5">
              <h4 className="text-[12px] font-medium tracking-[0.06em] text-[#7A7268] md:text-[11px]">
                名场面 / 高光时刻
              </h4>
              <p
                data-testid="character-dossier-highlights"
                className="mt-1.5 whitespace-pre-line text-[15px] leading-[1.75] text-[#2E2A26] md:text-[14px] md:leading-relaxed"
              >
                {profile.highlights}
              </p>
            </div>
          )}

          {/* Personal Notes preview if saved */}
          {item.notes && (
            <div className="border-t border-[#EFECE5] pt-3.5">
              <h4 className="text-[12px] font-medium tracking-[0.06em] text-[#7A7268] md:text-[11px]">
                收藏手记
              </h4>
              <p className="mt-1.5 whitespace-pre-line text-[15px] leading-[1.75] text-[#2E2A26] md:text-[14px] md:leading-relaxed">
                {item.notes}
              </p>
            </div>
          )}

          {/* Quiet Edit Shortcut */}
          <div className="flex items-center justify-between border-t border-[#EFECE5] pt-3">
            {error ? (
              <span className="text-[12px] text-[#7A7268] md:text-[11px]">{error}</span>
            ) : (
              <span className="text-[12px] text-[#8C857B] md:text-[11px]">
                所有字段均可自由补充修订
              </span>
            )}
            <button
              type="button"
              onClick={onJumpToEditSpecs}
              className="inline-flex min-h-[40px] items-center gap-1 text-[13px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer hover:text-[#B43B2B] md:min-h-[36px] md:text-xs"
            >
              <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
              编辑设定
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3.5 border-t border-[#EFECE5] pt-4 text-center">
          <p className="text-[13px] leading-relaxed text-[#7A7268] md:text-xs">
            {error || '尚未补充该角色的背景与设定资料，可一键联网检索或手动完善。'}
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="min-h-[42px] rounded-xl bg-[#1A1816] px-4 text-[13px] font-medium text-white whitespace-nowrap cursor-pointer md:min-h-[40px] md:text-xs"
            >
              联网补全档案
            </button>
            <button
              type="button"
              onClick={onJumpToEditSpecs}
              className="min-h-[42px] rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-4 text-[13px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer md:min-h-[40px] md:text-xs"
            >
              手动填写设定
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
