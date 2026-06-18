'use client';

/**
 * Formulario de abertura de thread de suporte (F38-S09). Assunto + prioridade +
 * primeira mensagem. Consome POST /api/support/threads (S07).
 */
import { useState } from 'react';
import { Send } from 'lucide-react';
import type { SupportThreadPriorityT } from '@hm/shared';
import { Button } from '@hm/ui';
import { ErrorState } from '@/shared/components/feedback';
import { useOpenThread } from './queries';

const PRIORITIES: { value: SupportThreadPriorityT; label: string }[] = [
  { value: 'low', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
];

const fieldCls =
  'w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-body text-sm text-text outline-none transition-colors placeholder:text-text-low focus-visible:border-border-2 focus-visible:shadow-glow-md';

export function NewThreadForm({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const open = useOpenThread();
  const [subject, setSubject] = useState('');
  const [priority, setPriority] = useState<SupportThreadPriorityT>('normal');
  const [message, setMessage] = useState('');

  const valid = subject.trim() !== '' && message.trim() !== '';

  function submit(): void {
    if (!valid) return;
    open.mutate(
      { subject: subject.trim(), priority, message: message.trim() },
      { onSuccess: (res) => onCreated(res.thread.id) },
    );
  }

  return (
    <form
      className="flex flex-1 flex-col gap-4 overflow-y-auto p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {open.isError && (
        <ErrorState
          title="Nao foi possivel abrir a conversa"
          reason="Verifique os campos e tente novamente."
        />
      )}

      <div>
        <label htmlFor="sup-subject" className="mb-1 block font-head text-xs font-semibold uppercase tracking-wide text-text-low">
          Assunto
        </label>
        <input
          id="sup-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Do que voce precisa de ajuda?"
          className={fieldCls}
        />
      </div>

      <div>
        <label htmlFor="sup-priority" className="mb-1 block font-head text-xs font-semibold uppercase tracking-wide text-text-low">
          Prioridade
        </label>
        <select
          id="sup-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as SupportThreadPriorityT)}
          className={fieldCls}
        >
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-1 flex-col">
        <label htmlFor="sup-message" className="mb-1 block font-head text-xs font-semibold uppercase tracking-wide text-text-low">
          Mensagem
        </label>
        <textarea
          id="sup-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Descreva o que esta acontecendo..."
          className={fieldCls + ' min-h-[140px] flex-1 resize-none'}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={open.isPending} disabled={!valid}>
          <Send className="size-4" aria-hidden /> Enviar
        </Button>
      </div>
    </form>
  );
}
