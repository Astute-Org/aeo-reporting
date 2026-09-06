import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, Info, AlertCircle } from 'lucide-react';

type ToastType = 'success' | 'info' | 'error';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const icons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={16} />,
  info: <Info size={16} />,
  error: <AlertCircle size={16} />,
};

const colors: Record<ToastType, string> = {
  success: 'var(--color-green)',
  info: 'var(--color-accent)',
  error: 'var(--color-error)',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    // Errors stay longer: they usually name a fix worth reading.
    timerRef.current = setTimeout(() => setExiting(true), toast.type === 'error' ? 8000 : 4000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [toast.type]);

  useEffect(() => {
    if (exiting) {
      const t = setTimeout(() => onDismiss(toast.id), 300);
      return () => clearTimeout(t);
    }
  }, [exiting, toast.id, onDismiss]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
        fontSize: 14,
        color: 'var(--color-ink)',
        minWidth: 280,
        maxWidth: 460,
        animation: exiting ? 'toastOut 300ms ease-in forwards' : 'toastIn 280ms ease-out',
        pointerEvents: 'auto',
      }}
    >
      <span style={{ color: colors[toast.type], flexShrink: 0, display: 'flex' }}>{icons[toast.type]}</span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => setExiting(true)}
        aria-label="Dismiss"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--color-ink-light)', flexShrink: 0, display: 'flex' }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {createPortal(
        <>
          <style>{`
            @keyframes toastIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes toastOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(12px); } }
          `}</style>
          <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
            {toasts.map((t) => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
          </div>
        </>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
