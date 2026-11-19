import { useEffect, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import type { ArchiveItem } from '../types/archive';
import { shouldUseBackendApi } from '../services/apiClient';
import { mergeImportedItems, parseImportPayload } from '../utils/archive';

interface BackupModalProps {
  open: boolean;
  items: ArchiveItem[];
  onClose: () => void;
  onReplaceAll: (items: ArchiveItem[]) => Promise<void>;
}

export function BackupModal({
  open,
  items,
  onClose,
  onReplaceAll,
}: BackupModalProps) {
  const [jsonInput, setJsonInput] = useState('');
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    setConfirmClearAll(false);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleDownloadJson = () => {
    const payload = {
      app: '光影志 CinéArchive',
      version: 1,
      exportedAt: new Date().toISOString(),
      items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cinearchive-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFeedback({
      type: 'success',
      message: `已导出全部 ${items.length} 件藏品到本地 JSON 备份文件。`,
    });
  };

  const runImport = async (rawText: string) => {
    if (!rawText.trim()) {
      setFeedback({ type: 'error', message: '请先选择备份文件或粘贴 JSON 内容。' });
      return;
    }
    const parsed = parseImportPayload(rawText);
    if (parsed.error) {
      setFeedback({ type: 'error', message: parsed.error });
      return;
    }
    setImporting(true);
    try {
      const { merged, addedCount, skippedCount } = mergeImportedItems(
        items,
        parsed.items
      );
      await onReplaceAll(merged);
      setJsonInput('');
      setFeedback({
        type: 'success',
        message: `导入完成：新增 ${addedCount} 件藏品，跳过 ${skippedCount} 件重复条目。`,
      });
    } finally {
      setImporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      void runImport(text);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1816]/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl border border-[#DCD6CB] bg-[#F7F5F0] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#E4DFD5] bg-white px-6 py-4">
          <div>
            <h2
              id="backup-modal-title"
              className="font-editorial text-xl font-semibold text-[#1A1816]"
            >
              馆藏数据备份与恢复
            </h2>
            <p className="mt-0.5 text-xs text-[#625C54]">
              {shouldUseBackendApi()
                ? '数据已自动保存至服务端与本地浏览器，无需登录第三方账号'
                : '数据已自动保存至当前浏览器本地存储，无需登录第三方账号，可随时导出 JSON 备份'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭备份窗口"
            className="flex h-10 w-10 items-center justify-center rounded-md text-[#625C54] hover:bg-[#F3EFE8] hover:text-[#1A1816] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-6 py-6">
          {/* Export */}
          <div className="border border-[#E4DFD5] bg-white p-5">
            <h3 className="text-sm font-medium text-[#1A1816]">
              导出全部馆藏（JSON）
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-[#625C54]">
              当前共收录 <span className="font-mono tabular-nums">{items.length}</span> 件影视、影人与角色档案，导出后可在任意设备随时恢复。
            </p>
            <button
              type="button"
              onClick={handleDownloadJson}
              className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[#1A1816] px-4 py-2 text-xs font-medium text-white cursor-pointer transition-colors hover:bg-[#B43B2B]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              下载备份文件
            </button>
          </div>

          {/* Import */}
          <div className="border border-[#E4DFD5] bg-white p-5">
            <h3 className="text-sm font-medium text-[#1A1816]">
              从 JSON 备份合并导入
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-[#625C54]">
              导入时会自动按分类与名称去重，不会覆盖你当前已有的馆藏笔记。
            </p>

            <div className="mt-4">
              <label
                htmlFor="backup-file-upload"
                className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-[#DCD6CB] bg-[#F7F5F0] px-4 py-2 text-xs font-medium text-[#1A1816] cursor-pointer hover:border-[#1A1816]"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                选择 JSON 文件导入
              </label>
              <input
                id="backup-file-upload"
                type="file"
                accept="application/json,.json"
                onChange={handleFileChange}
                className="sr-only"
              />
            </div>

            <div className="mt-4">
              <label
                htmlFor="backup-json-paste"
                className="block text-xs text-[#625C54]"
              >
                或直接粘贴备份 JSON 内容
              </label>
              <textarea
                id="backup-json-paste"
                rows={4}
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                placeholder='{"items": [...]}'
                className="mt-1.5 w-full rounded-md border border-[#DCD6CB] bg-[#FAF9F6] px-3 py-2 font-mono text-xs text-[#1A1816] focus:border-[#1A1816] focus:outline-none"
              />
              <button
                type="button"
                disabled={importing}
                onClick={() => void runImport(jsonInput)}
                className="mt-3 min-h-[38px] rounded-md bg-[#B43B2B] px-4 py-1.5 text-xs font-medium text-white cursor-pointer hover:bg-[#932D20] disabled:opacity-50"
              >
                {importing ? '导入中…' : '解析并合并导入'}
              </button>
            </div>
          </div>

          {/* Clear All Collection */}
          {items.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border border-[#E4DFD5] bg-white px-5 py-4">
              <div>
                <h3 className="text-sm font-medium text-[#1A1816]">
                  清空全部馆藏
                </h3>
                <p className="mt-0.5 text-xs text-[#625C54]">
                  清除当前所有已收录条目，建议先下载 JSON 备份。
                </p>
              </div>
              {!confirmClearAll ? (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="min-h-[36px] rounded-md border border-[#E5BFB9] bg-[#FDF4F2] px-3.5 py-1.5 text-xs font-medium text-[#932D20] whitespace-nowrap cursor-pointer hover:bg-[#B43B2B] hover:text-white transition-colors"
                >
                  清空全部
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await onReplaceAll([]);
                      setConfirmClearAll(false);
                      setFeedback({
                        type: 'success',
                        message: '已清空全部馆藏记录。',
                      });
                    }}
                    className="min-h-[36px] rounded-md bg-[#B43B2B] px-3.5 py-1.5 text-xs font-medium text-white cursor-pointer hover:bg-[#932D20]"
                  >
                    确认清空
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="min-h-[36px] rounded-md border border-[#DCD6CB] bg-white px-3 py-1.5 text-xs text-[#4B453E] cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          )}

          {feedback && (
            <p
              role={feedback.type === 'error' ? 'alert' : 'status'}
              className={`border px-4 py-3 text-xs ${
                feedback.type === 'error'
                  ? 'border-[#E5BFB9] bg-[#FDF4F2] text-[#932D20]'
                  : 'border-[#C8DFD0] bg-[#F2F7F4] text-[#2A6B46]'
              }`}
            >
              {feedback.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
