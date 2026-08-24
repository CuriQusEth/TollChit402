import { useEffect, type FC } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export type ToastKind = 'success' | 'error';

export type ToastMessage = {
  id: number;
  kind: ToastKind;
  text: string;
};

/** Başarı bildirimleri kendiliğinden kapanır; hatalar okunacak kadar kalır. */
const DISMISS_AFTER_MS: Record<ToastKind, number> = {
  success: 5000,
  error: 9000,
};

const Toast: FC<{ toast: ToastMessage; onDismiss: (id: number) => void }> = ({
  toast,
  onDismiss,
}) => {
  useEffect(() => {
    const timer = setTimeout(
      () => onDismiss(toast.id),
      DISMISS_AFTER_MS[toast.kind]
    );
    return () => clearTimeout(timer);
  }, [toast.id, toast.kind, onDismiss]);

  const isSuccess = toast.kind === 'success';

  return (
    <div
      role="status"
      className={`flex items-start gap-3 p-3 border shadow-lg backdrop-blur-md max-w-sm ${
        isSuccess
          ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
          : 'bg-red-950/80 border-red-500/40 text-red-300'
      }`}
    >
      {isSuccess ? (
        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      )}
      <p className="text-[11px] font-mono leading-relaxed flex-1">{toast.text}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Bildirimi kapat"
        className="text-gray-500 hover:text-white transition-colors shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
