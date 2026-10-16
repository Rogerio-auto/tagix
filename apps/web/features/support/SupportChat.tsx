'use client';

/**
 * Chat de Suporte do membro (F38-S09) com a equipe Leadium. Overlay responsivo
 * (full-screen no mobile, painel lateral no desktop) lancado da Central de
 * Ajuda. Lista de threads + view de chat em tempo real (S08) + abrir thread +
 * resolver. Canal INTERNO (nao passa por Meta/WhatsApp). DS 3.0 (F72-S07), ARIA, estados.
 * Fechado, o painel segue montado só para a transição: `inert` + `aria-hidden` o tiram
 * do Tab e da árvore de acessibilidade. Suporte segue liberado em empresa só leitura
 * (a API isenta `/api/support/**`: quem está bloqueado precisa falar com a gente).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Headset, Plus, X } from 'lucide-react';
import { Button, IconButton } from '@hm/ui';
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
      inert={!open}
      aria-hidden={open ? undefined : true}
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
            ? 'absolute inset-0 bg-black/60 opacity-100 backdrop-blur-sm transition-opacity duration-(--dur-base) ease-ds motion-reduce:transition-none'
            : 'absolute inset-0 bg-black/60 opacity-0 transition-opacity duration-(--dur-base) ease-ds motion-reduce:transition-none'
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
          'absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-ds-3 outline-none transition-transform duration-(--dur-base) ease-ds-spring motion-reduce:transition-none'
        }
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          {view.kind !== 'list' && (
            <IconButton
              size="sm"
              aria-label="Voltar para a lista de conversas"
              icon={<ArrowLeft aria-hidden />}
              onClick={() => setView({ kind: 'list' })}
            />
          )}
          <span className="inline-flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-sm border border-border-brand bg-brand-text/10 text-brand-text"
            >
              <Headset className="size-4" />
            </span>
            <span className="truncate font-head text-lg font-semibold text-text">Suporte Leadium</span>
          </span>
          {view.kind === 'list' && (
            <Button
              variant="primary"
              size="sm"
              className="ml-auto"
              leftIcon={<Plus className="size-4" aria-hidden />}
              onClick={() => setView({ kind: 'new' })}
            >
              Nova
            </Button>
          )}
          <IconButton
            size="sm"
            aria-label="Fechar suporte"
            icon={<X aria-hidden />}
            onClick={onClose}
            className={view.kind === 'list' ? 'ml-1' : 'ml-auto'}
          />
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
