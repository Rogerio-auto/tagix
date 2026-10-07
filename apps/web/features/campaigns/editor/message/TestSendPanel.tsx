'use client';

/**
 * "Enviar teste" (F58-S09).
 *
 * O teste usa o MESMO pipeline do envio real (F58-S06), então ele prova o que
 * importa: o modelo, as variáveis e o número funcionam juntos. Três garantias
 * na tela:
 *
 * 1. **Destinatário explícito.** O número aparece por extenso no botão e na
 *    confirmação — ninguém manda teste para o cliente achando que era para si.
 * 2. **Clique duplo não envia dois.** O botão trava durante o envio e a mesma
 *    intenção (modelo + número + variáveis) reaproveita a mesma
 *    `Idempotency-Key`; o servidor devolve o envio anterior em vez de repetir.
 * 3. **Resultado honesto.** A API responde "na fila", não "entregue". A
 *    mensagem de sucesso diz exatamente isso.
 */
import type * as React from 'react';
import { useId, useRef, useState } from 'react';
import { CheckCircle2, Send, TriangleAlert } from 'lucide-react';
import { Button, Input } from '@hm/ui';
import type { TestSendResult } from './queries';
import type { TemplateBinding } from './model';

const E164 = /^\+[1-9]\d{7,14}$/u;

/** "+55 (11) 99999-0000" → "+5511999990000". Sem `+`, devolve como está. */
export function normalizeTestPhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/gu, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export function isValidTestPhone(phone: string): boolean {
  return E164.test(phone);
}

function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export interface TestIntent {
  readonly intent: string;
  readonly key: string;
}

/**
 * Chave de idempotência da tentativa. A MESMA intenção (modelo + número +
 * variáveis) reaproveita a chave anterior — retentativa e clique duplo viram
 * replay no servidor; qualquer mudança gera chave nova.
 */
export function intentFor(
  previous: TestIntent | null,
  input: { templateId: string; to: string; bindings: readonly TemplateBinding[] },
  makeKey: () => string = newKey,
): TestIntent {
  const intent = JSON.stringify([input.templateId, input.to, input.bindings]);
  return previous?.intent === intent ? previous : { intent, key: makeKey() };
}

export interface TestSendPanelProps {
  readonly templateId: string | null;
  readonly bindings: readonly TemplateBinding[];
  /** Motivo de bloqueio já traduzido (sem campanha salva, campos pendentes…). */
  readonly blockedReason: string | null;
  /** Número sugerido (o do próprio usuário, quando o orquestrador souber). */
  readonly defaultPhone?: string;
  readonly pending: boolean;
  readonly onSend: (input: {
    templateId: string;
    to: string;
    bindings: readonly TemplateBinding[];
    idempotencyKey: string;
  }) => Promise<TestSendResult>;
}

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sent'; readonly to: string; readonly replayed: boolean }
  | { readonly kind: 'failed'; readonly to: string; readonly message: string };

export function TestSendPanel({
  templateId,
  bindings,
  blockedReason,
  defaultPhone = '',
  pending,
  onSend,
}: TestSendPanelProps): React.JSX.Element {
  const id = useId();
  const [phone, setPhone] = useState(defaultPhone);
  const [touched, setTouched] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  // Uma chave por intenção. Repetir a MESMA intenção (retentativa após falha,
  // clique duplo) reaproveita a chave; mudar qualquer parte gera outra.
  const intentRef = useRef<TestIntent | null>(null);
  // Trava síncrona: dois cliques no mesmo quadro chegam antes de `pending` virar
  // true na tela. O ref fecha essa janela.
  const inFlightRef = useRef(false);

  const to = normalizeTestPhone(phone);
  const phoneValid = isValidTestPhone(to);
  const phoneError =
    touched && !phoneValid ? 'Use o número com país e DDD, ex.: +55 11 99999-0000.' : undefined;

  const disabled = blockedReason !== null || templateId === null;

  async function send(): Promise<void> {
    setTouched(true);
    if (inFlightRef.current || pending || disabled || templateId === null || !phoneValid) return;
    inFlightRef.current = true;
    const attempt = intentFor(intentRef.current, { templateId, to, bindings });
    intentRef.current = attempt;
    try {
      const result = await onSend({ templateId, to, bindings, idempotencyKey: attempt.key });
      setOutcome({ kind: 'sent', to, replayed: result.replayed });
      // Enviado: um novo clique é um NOVO teste, com chave nova.
      intentRef.current = null;
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Não foi possível enviar o teste. Tente de novo.';
      setOutcome({ kind: 'failed', to, message });
    } finally {
      inFlightRef.current = false;
    }
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-3"
    >
      <div className="flex flex-col gap-0.5">
        <h4 id={`${id}-title`} className="text-sm font-medium text-text">
          Testar no seu celular
        </h4>
        <p className="text-xs text-text-low">
          Chega como chegaria para o cliente. Não conta nas métricas da campanha.
        </p>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="sm:flex-1">
          <Input
            label="Enviar para"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            disabled={disabled}
            placeholder="+55 11 99999-0000"
            onBlur={() => setTouched(true)}
            onChange={(e) => {
              setPhone(e.target.value);
              if (outcome.kind !== 'idle') setOutcome({ kind: 'idle' });
            }}
            {...(phoneError ? { error: phoneError } : {})}
          />
        </div>
        <Button
          type="submit"
          variant="secondary"
          className="sm:mt-[1.625rem]"
          loading={pending}
          disabled={disabled || pending}
          leftIcon={<Send className="size-4" aria-hidden />}
        >
          {pending ? 'Enviando…' : 'Enviar teste'}
        </Button>
      </form>

      {blockedReason ? <p className="text-xs text-text-low">{blockedReason}</p> : null}

      <div role="status" aria-live="polite" className="empty:hidden">
        {outcome.kind === 'sent' ? (
          <p className="flex items-start gap-2 rounded-sm bg-success-bg px-3 py-2 text-xs text-success">
            <CheckCircle2 className="mt-px size-4 shrink-0" aria-hidden />
            <span>
              {outcome.replayed
                ? `Este teste já tinha saído para ${outcome.to}. Não mandamos de novo.`
                : `Teste na fila para ${outcome.to}. Deve chegar em instantes.`}
            </span>
          </p>
        ) : outcome.kind === 'failed' ? (
          <p className="flex items-start gap-2 rounded-sm bg-danger-bg px-3 py-2 text-xs text-danger">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
            <span>
              O teste para {outcome.to} não saiu. {outcome.message}
            </span>
          </p>
        ) : null}
      </div>
    </section>
  );
}
