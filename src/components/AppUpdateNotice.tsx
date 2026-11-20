import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function AppUpdateNotice() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const { needRefresh: [ready, setReady], updateServiceWorker } = useRegisterSW({
    immediate: false,
    onRegisteredSW: (_url, worker) => setRegistration(worker),
  });

  useEffect(() => {
    if (!registration) return;
    const check = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void registration.update().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [registration]);

  if (!ready) return null;
  return (
    <aside aria-label="应用更新" className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-hairline bg-surface p-3 text-sm text-ink shadow-lg">
      <span>新版已就绪</span>
      <div className="flex gap-2">
        <button type="button" className="min-h-11 px-3" onClick={() => setReady(false)}>稍后</button>
        <button type="button" className="min-h-11 rounded-lg bg-vermilion px-3 text-white" onClick={() => void updateServiceWorker()}>更新并刷新</button>
      </div>
    </aside>
  );
}
