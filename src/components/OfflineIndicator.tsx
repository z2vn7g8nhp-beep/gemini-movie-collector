import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      data-testid="offline-indicator"
      className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-[#C9A45C]/50 bg-[#1A1816]/95 px-4 py-2 text-[13px] font-medium text-[#FAF7F0] shadow-lg md:bottom-6"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0 text-[#E4C37A]" aria-hidden="true" />
      <span className="truncate">离线模式 · 本地藏馆与已缓存图鉴可正常翻阅</span>
    </div>
  );
}
