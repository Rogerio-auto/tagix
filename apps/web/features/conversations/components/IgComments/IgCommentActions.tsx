'use client';

import { useState } from 'react';
import { EyeOff, Eye, MessageCircle, Send, Trash2, X } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { ApiError } from '@/shared/lib/api-client';
import { useDeleteComment, useHideComment, useReplyComment, type IgComment } from './queries';

export interface IgCommentActionsProps {
  comment: IgComment;
  mediaId: string;
  canModerate: boolean;
  className?: string;
}

export function IgCommentActions({ comment, mediaId, canModerate, className }: IgCommentActionsProps) {
  const { toast } = useToast();
  const reply = useReplyComment(mediaId);
  const hide = useHideComment(mediaId);
  const del = useDeleteComment(mediaId);

  const [replyOpen, setReplyOpen] = useState(false);
  const [mode, setMode] = useState<'public' | 'private'>('public');
  const [text, setText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const commentId = comment.commentId ?? '';
  const disabled = !commentId || !canModerate;

  const onReply = async () => {
    if (!text.trim()) return;
    try {
      await reply.mutateAsync({ commentId, mode, text: text.trim() });
      toast({ variant: 'success', title: mode === 'public' ? 'Resposta publica enviada' : 'Resposta por DM enviada' });
      setText('');
      setReplyOpen(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha ao responder', description: message });
    }
  };

  const onHide = async () => {
    try {
      await hide.mutateAsync({ commentId, hide: !comment.hidden });
      toast({ variant: 'success', title: comment.hidden ? 'Comentario exibido' : 'Comentario ocultado' });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha ao ocultar', description: message });
    }
  };

  const onDelete = async () => {
    try {
      await del.mutateAsync({ commentId });
      toast({ variant: 'success', title: 'Comentario excluido' });
      setConfirmDelete(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha ao excluir', description: message });
    }
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <ActionButton icon={MessageCircle} label="Responder" onClick={() => setReplyOpen((v) => !v)} disabled={disabled} active={replyOpen} />
        <ActionButton icon={comment.hidden ? Eye : EyeOff} label={comment.hidden ? 'Exibir' : 'Ocultar'} onClick={() => void onHide()} disabled={disabled || hide.isPending} />
        <ActionButton icon={Trash2} label="Excluir" onClick={() => setConfirmDelete(true)} disabled={disabled} tone="danger" />
      </div>

      {replyOpen && (
        <div className="flex flex-col gap-2 rounded-md border border-border-2 bg-surface-inset p-3">
          <div className="inline-flex rounded-pill border border-border-2 bg-surface-2 p-0.5 text-xs">
            <ToggleOption active={mode === 'public'} onClick={() => setMode('public')} label="Publico" />
            <ToggleOption active={mode === 'private'} onClick={() => setMode('private')} label="Por DM" />
          </div>
          <p className="font-body text-xs text-text-low">
            {mode === 'public' ? 'Visivel a todos no post.' : 'Resposta privada (DM) ao autor; abre uma conversa direta.'}
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Escreva a resposta..."
            aria-label="Resposta ao comentario"
            className={cn(
              'w-full resize-none rounded-md border border-border-2 bg-surface px-3 py-2',
              'font-body text-sm text-text placeholder:text-text-low outline-none',
              'focus-visible:border-border focus-visible:shadow-glow-md',
            )}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReplyOpen(false)}>Cancelar</Button>
            <Button variant="primary" size="sm" loading={reply.isPending} disabled={!text.trim()} leftIcon={<Send className="size-3.5" aria-hidden />} onClick={() => void onReply()}>
              Enviar
            </Button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div role="alertdialog" aria-label="Confirmar exclusao do comentario" className="flex items-center justify-between gap-3 rounded-md border border-danger bg-[var(--danger-bg)] p-3">
          <p className="font-body text-xs text-text">Excluir este comentario? A acao nao pode ser desfeita.</p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => setConfirmDelete(false)} className="inline-flex items-center gap-1 rounded-sm px-2 py-1 font-body text-xs text-text-low outline-none hover:text-text focus-visible:shadow-glow-md">
              <X className="size-3.5" aria-hidden />
              Cancelar
            </button>
            <Button variant="danger" size="sm" loading={del.isPending} onClick={() => void onDelete()}>Excluir</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  tone,
}: {
  icon: typeof MessageCircle;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 font-body text-xs outline-none transition-colors',
        'focus-visible:shadow-glow-md disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'danger'
          ? 'border-border-2 text-danger hover:border-danger hover:bg-[var(--danger-bg)]'
          : active
            ? 'border-brand bg-surface-3 text-text'
            : 'border-border-2 bg-surface-2 text-text-mid hover:text-text',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

function ToggleOption({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-pill px-3 py-1 font-body outline-none transition-colors focus-visible:shadow-glow-md',
        active ? 'bg-brand text-text-on-brand' : 'text-text-mid hover:text-text',
      )}
    >
      {label}
    </button>
  );
}
