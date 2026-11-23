import { useState } from 'react';
import { CheckCircle2, Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  /** Compact button for top header vs full archival card button for Profile view */
  variant?: 'topbar' | 'card';
}

export function PWAInstallButton({ variant = 'topbar' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (variant === 'topbar') {
    if (isInstalled) return null;

    if (isInstallable) {
      return (
        <button
          type="button"
          onClick={() => void install()}
          data-testid="pwa-install-topbar-btn"
          aria-label="安装光影志 Web App 到桌面"
          className="inline-flex h-[40px] items-center gap-1.5 rounded-xl border border-[#DCD6CB] bg-white px-2.5 text-[13px] font-medium text-[#1A1816] whitespace-nowrap shrink-0 cursor-pointer transition-colors hover:border-[#1A1816] active:scale-[0.97] dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:hover:border-[#D4AF6A]"
        >
          <Download className="h-3.5 w-3.5 text-[#B43B2B] dark:text-[#EB7865]" aria-hidden="true" />
          <span>安装应用</span>
        </button>
      );
    }

    if (isIOS) {
      return (
        <>
          <button
            type="button"
            onClick={() => setShowGuide(true)}
            data-testid="pwa-ios-topbar-btn"
            aria-label="将光影志添加到主屏幕"
            className="inline-flex h-[40px] items-center gap-1 rounded-xl border border-[#DCD6CB] bg-white px-2.5 text-[13px] font-medium text-[#1A1816] whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.97] dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:hover:border-[#D4AF6A]"
          >
            <Smartphone className="h-3.5 w-3.5 text-[#B43B2B] dark:text-[#EB7865]" aria-hidden="true" />
            <span>加桌面</span>
          </button>
          {showGuide && <InstallGuideModal isIOS={true} onClose={() => setShowGuide(false)} />}
        </>
      );
    }

    return null;
  }

  // Profile card variant: always renders clear status or install action
  return (
    <>
      {isInstalled ? (
        <span
          data-testid="pwa-installed-badge"
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#C8DFD0] bg-[#F2F7F4] px-4 text-[13px] font-medium text-[#2A6B46] dark:border-[#2B523B] dark:bg-[#172B20] dark:text-[#6CC492]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>已作为独立 Web App 安装运行</span>
        </span>
      ) : isInstallable ? (
        <button
          type="button"
          onClick={() => void install()}
          data-testid="pwa-install-card-btn"
          className="inline-flex min-h-[46px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[#B43B2B] px-5 text-[15px] font-medium text-white whitespace-nowrap cursor-pointer transition-colors hover:bg-[#932D20] active:scale-[0.98]"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>一键安装到桌面 / 主屏幕</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          data-testid="pwa-guide-card-btn"
          className="inline-flex min-h-[46px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl border border-[#DCD6CB] bg-[#FAF9F6] px-5 text-[15px] font-medium text-[#1A1816] whitespace-nowrap cursor-pointer transition-colors hover:border-[#1A1816] active:scale-[0.98] dark:border-[#3A342D] dark:bg-[#24201C] dark:text-[#F3EFE6] dark:hover:border-[#D4AF6A]"
        >
          <Smartphone className="h-4 w-4 text-[#B43B2B] dark:text-[#EB7865]" aria-hidden="true" />
          <span>{isIOS ? '添加到 iPhone / iPad 主屏幕' : '查看桌面 / 手机安装指南'}</span>
        </button>
      )}

      {showGuide && (
        <InstallGuideModal isIOS={isIOS} onClose={() => setShowGuide(false)} />
      )}
    </>
  );
}

function InstallGuideModal({
  isIOS,
  onClose,
}: {
  isIOS: boolean;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-guide-title"
      data-testid="pwa-install-guide-modal"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[#12100E]/65 p-0 sm:items-center sm:p-4 dark:bg-black/80"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[440px] rounded-t-3xl border border-[#DDD6C8] bg-[#FAF9F6] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-5 dark:border-[#322D27] dark:bg-[#181512]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3
              id="pwa-guide-title"
              className="font-editorial text-[19px] font-medium text-[#1A1816] dark:text-[#F3EFE6]"
            >
              {isIOS ? '在 iPhone / iPad 安装光影志' : '将光影志安装为独立 Web App'}
            </h3>
            <p className="mt-1 text-[13px] text-[#7A7268] dark:text-[#A59D90]">
              安装后支持全屏沉浸浏览、离线翻阅馆藏与图标直达
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭安装指南"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#625C54] hover:bg-[#EAE4D9] cursor-pointer dark:text-[#A59D90] dark:hover:bg-[#2A2520] dark:hover:text-[#F3EFE6]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3 rounded-2xl border border-[#E4DFD5] bg-white p-4 text-[14px] leading-relaxed text-[#3E3933] dark:border-[#322D27] dark:bg-[#1D1A17] dark:text-[#D4CCC0]">
          {isIOS ? (
            <>
              <p className="flex items-start gap-2">
                <Share className="mt-0.5 h-4 w-4 shrink-0 text-[#B43B2B] dark:text-[#EB7865]" aria-hidden="true" />
                <span>
                  1. 在 Safari 底部工具栏轻点<strong className="dark:text-[#F3EFE6]">「分享」</strong>按钮。
                </span>
              </p>
              <p>
                2. 向上滑动菜单，选择<strong className="dark:text-[#F3EFE6]">「添加到主屏幕」</strong>并点击右上角「添加」。
              </p>
            </>
          ) : (
            <>
              <p>
                <strong className="dark:text-[#F3EFE6]">手机端（Chrome / Edge / Safari）</strong>：点击浏览器菜单或分享按钮，选择<strong className="dark:text-[#F3EFE6]">「安装应用」</strong>或<strong className="dark:text-[#F3EFE6]">「添加到主屏幕」</strong>。
              </p>
              <p>
                <strong className="dark:text-[#F3EFE6]">桌面端（Chrome / Edge）</strong>：点击浏览器地址栏右侧的<strong className="dark:text-[#F3EFE6]">安装图标</strong>，即可将光影志独立成桌面应用窗口。
              </p>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 h-12 w-full rounded-xl bg-[#1A1816] text-[15px] font-medium text-white cursor-pointer hover:bg-[#B43B2B] transition-colors dark:bg-[#F3EFE6] dark:text-[#141210] dark:hover:bg-[#E4C37A]"
        >
          我知道了
        </button>
      </div>
    </div>
  );
}
