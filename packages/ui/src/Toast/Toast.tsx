import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

export type ToastVariant = 'success' | 'error' | 'warn' | 'info';
export type ToastPosition = 'top-right' | 'bottom';

export interface ToastOptions {
  variant?: ToastVariant;
  title: string;
  description?: string;
  /** ms até auto-dismiss (default 4000; 0 = não fecha sozinho). */
  duration?: number;
  position?: ToastPosition;
}

interface ToastItem extends ToastOptions {
  id: string;
  variant: ToastVariant;
  position: ToastPosition;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantConfig: Record<ToastVariant, { icon: LucideIcon; accent: string; iconColor: string }> = {
  success: { icon: CheckCircle2, accent: 'border-l-success', iconColor: 'text-success' },
  error: { icon: XCircle, accent: 'border-l-danger', iconColor: 'text-danger' },
  warn: { icon: AlertTriangle, accent: 'border-l-warn', iconColor: 'text-warn' },
  info: { icon: Info, accent: 'border-l-info', iconColor: 'text-info' },
};

const positionClass: Record<ToastPosition, string> = {
  'top-right': 'top-4 right-4 items-end',
  bottom: 'bottom-4 left-1/2 -translate-x-1/2 items-center',
};

/**
 * Provider ÚNICO de toasts (DESIGN_SYSTEM §4.6 — nunca duplicar, lição v1).
 * Envolva a app uma vez e use `useToast()`.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = crypto.randomUUID();
      const item: ToastItem = {
        ...opts,
        id,
        variant: opts.variant ?? 'info',
        position: opts.position ?? 'top-right',
      };
      setItems((prev) => [...prev, item]);
      const duration = opts.duration ?? 4000;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  const byPosition = (pos: ToastPosition) => items.filter((t) => t.position === pos);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <>
            {(['top-right', 'bottom'] as const).map((pos) => {
              const list = byPosition(pos);
              if (list.length === 0) return null;
              return (
                <div
                  key={pos}
                  className={cn('pointer-events-none fixed z-[60] flex flex-col gap-2', positionClass[pos])}
                >
                  {list.map((t) => {
                    const { icon: Icon, accent, iconColor } = variantConfig[t.variant];
                    return (
                      <div
                        key={t.id}
                        role={t.variant === 'error' ? 'alert' : 'status'}
                        // Erro = assertivo (interrompe); demais = polido. aria-atomic
                        // garante que título+descrição sejam lidos como uma unidade.
                        aria-live={t.variant === 'error' ? 'assertive' : 'polite'}
                        aria-atomic="true"
                        className={cn(
                          'pointer-events-auto flex w-80 items-start gap-3 rounded-md border border-border border-l-4 bg-surface-2 p-3 shadow-elev-3',
                          'motion-safe:animate-[hm-toast-in_240ms_ease-out]',
                          accent,
                        )}
                      >
                        <Icon className={cn('mt-0.5 size-5 shrink-0', iconColor)} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="font-head text-sm font-semibold text-text">{t.title}</p>
                          {t.description && (
                            <p className="mt-0.5 font-body text-sm text-text-mid">{t.description}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => dismiss(t.id)}
                          aria-label="Fechar notificação"
                          className="rounded-sm p-0.5 text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>.');
  return ctx;
}
