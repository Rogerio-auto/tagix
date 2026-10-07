import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { IconButton } from '../IconButton/IconButton';

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

/* DS 3.0: vidro + chip de ícone tingido; a cor do estado está no chip e na borda, não numa barra lateral. */
const variantConfig: Record<ToastVariant, { icon: LucideIcon; accent: string; iconColor: string }> = {
  success: { icon: CheckCircle2, accent: 'border-success/25', iconColor: 'bg-success/12 text-success' },
  error: { icon: XCircle, accent: 'border-danger/30', iconColor: 'bg-danger/12 text-danger' },
  warn: { icon: AlertTriangle, accent: 'border-warn/30', iconColor: 'bg-warn/12 text-warn' },
  info: { icon: Info, accent: 'border-info/25', iconColor: 'bg-info/12 text-info' },
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
                          'pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-md border bg-surface-2 p-3 shadow-ds-2 supports-[backdrop-filter]:bg-surface-glass supports-[backdrop-filter]:backdrop-blur-md [@media(prefers-reduced-transparency:reduce)]:bg-surface-2 [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none',
                          'motion-safe:animate-[hm-toast-in_250ms_var(--ease-spring)_both]',
                          accent,
                        )}
                      >
                        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-xs', iconColor)}>
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-head text-sm font-semibold text-text">{t.title}</p>
                          {t.description && (
                            <p className="mt-0.5 font-body text-sm text-text-mid">{t.description}</p>
                          )}
                        </div>
                        <IconButton
                          aria-label="Fechar notificação"
                          icon={<X />}
                          size="sm"
                          onClick={() => dismiss(t.id)}
                          className="-mr-1 -mt-1 shrink-0"
                        />
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
