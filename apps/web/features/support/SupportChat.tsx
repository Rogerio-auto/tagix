'use client';

/**
 * Chat de Suporte do membro (F38-S09) com a equipe Leadium. Overlay responsivo
 * (full-screen no mobile, painel lateral no desktop) lancado da Central de
 * Ajuda. Lista de threads + view de chat em tempo real (S08) + abrir thread +
 * resolver. Canal INTERNO (nao passa por Meta/WhatsApp). DS v2, ARIA, estados.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Headset, Plus, X } from 'lucide-react';
import { ThreadList } from './ThreadList';
import { ThreadView } from './ThreadView';
import { NewThreadForm } from './NewThreadForm';

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'thread'; id: string };

export function SupportChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<View>({ kind: 'list' });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  // Reseta para a lista ao reabrir.
  useEffect(() => {
    if (open) setView({ kind: 'list' });
  }, [open]);

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={
        open
          ? 'fixed inset-0 z-50 pointer-events-auto'
          : 'fixed inset-0 z-50 pointer-events-none'
      }
    >
      <div
        onClick={onClose}
        aria-hidden
        className={
          open
            ? 'absolute inset-0 bg-black/50 opacity-100 transition-opacity duration-200'
            : 'absolute inset-0 bg-black/50 opacity-0 transition-opacity duration-200'
        }
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Suporte Leadium"
        tabIndex={-1}
        className={
          (open ? 'translate-x-0 ' : 'translate-x-full ') +
          'absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-elev-4 outline-none transition-transform duration-200 ease-out'
        }
      >
        <header className="flex items-center gap-2 border-b border-border-2 px-4 py-3">
          {view.kind !== 'list' && (
            <button
              type="button"
              onClick={() => setView({ kind: 'list' })}
              aria-label="Voltar para a lista de conversas"
              className="rounded-sm p-1 text-text-low outline-none transition-colors hover:text-text focus-visible:shadow-glow-md"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </button>
          )}
          <span className="inline-flex items-center gap-2">
            <Headset className="size-5 text-brand" aria-hidden />
            <span className="font-head text-base font-semibold text-text">Suporte Leadium</span>
          </span>
          {view.kind === 'list' && (
            <button
              type="button"
              onClick={() => setView({ kind: 'new' })}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 font-head text-sm font-semibold text-text-on-brand outline-none transition-colors hover:bg-brand-strong focus-visible:shadow-glow-md"
            >
              <Plus className="size-4" aria-hidden /> Nova
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar suporte"
            className={
              (view.kind === 'list' ? 'ml-2 ' : 'ml-auto ') +
              'rounded-sm p-1 text-text-low outline-none transition-colors hover:text-text focus-visible:shadow-glow-md'
            }
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {view.kind === 'list' && (
            <ThreadList
              onOpen={(id) => setView({ kind: 'thread', id })}
              onNew={() => setView({ kind: 'new' })}
              active={open}
            />
          )}
          {view.kind === 'new' && (
            <NewThreadForm
              onCreated={(id) => setView({ kind: 'thread', id })}
              onCancel={() => setView({ kind: 'list' })}
            />
          )}
          {view.kind === 'thread' && <ThreadView threadId={view.id} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
