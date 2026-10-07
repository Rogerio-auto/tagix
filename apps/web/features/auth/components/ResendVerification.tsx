'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, MailCheck } from 'lucide-react';
import { Button } from '@hm/ui';
import { useResendVerification } from '../queries';
import {
  RESEND_COOLDOWN_SECONDS,
  RESEND_FAILURE_COPY,
  classifyResendError,
  cooldownRemaining,
  isValidEmail,
  resendButtonLabel,
  resendSuccessMessage,
  type ResendFailure,
} from '../resend';
import { TurnstileWidget } from './TurnstileWidget';

export interface ResendVerificationProps {
  /** Email que receberá o novo link (o pai decide de onde vem). */
  email: string;
  /** Rótulo do botão quando livre; padrão "Reenviar email". */
  idleLabel?: string;
  /** Cooldown inicial em segundos (ex.: logo após um envio feito por outro passo). */
  initialCooldownSeconds?: number;
  className?: string;
}

/** Contagem regressiva em segundos; `start` reinicia. Só roda enquanto houver tempo. */
function useCooldown(initialSeconds: number) {
  const [until, setUntil] = useState<number>(() => Date.now() + initialSeconds * 1000);
  const [now, setNow] = useState<number>(() => Date.now());
  const remaining = cooldownRemaining(until, now);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [remaining]);

  const start = () => {
    const t = Date.now();
    setNow(t);
    setUntil(t + RESEND_COOLDOWN_SECONDS * 1000);
  };
  return { remaining, start };
}

/**
 * "Reenviar email de confirmação" com Turnstile, contagem de 60 s e resposta
 * uniforme (UX §2.7 feedback imediato, §2.11 erro em 3 partes). O 200 da API é
 * sempre o mesmo, então a mensagem também é: nunca diz se o email existe.
 */
export function ResendVerification({
  email,
  idleLabel,
  initialCooldownSeconds = 0,
  className,
}: ResendVerificationProps) {
  const resend = useResendVerification();
  const [token, setToken] = useState('');
  // O token do Turnstile vale para UM envio: remontar o widget gera outro.
  const [widgetKey, setWidgetKey] = useState(0);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [failure, setFailure] = useState<ResendFailure | null>(null);
  const { remaining, start } = useCooldown(initialCooldownSeconds);

  const emailOk = isValidEmail(email);
  const blocked = remaining > 0 || !emailOk || !token;

  async function onResend(): Promise<void> {
    if (blocked || resend.isPending) return;
    setFailure(null);
    setSentTo(null);
    const target = email.trim();
    try {
      await resend.mutateAsync({ email: target, turnstileToken: token });
      setSentTo(target);
      start();
    } catch (err) {
      const kind = classifyResendError(err);
      setFailure(kind);
      // Captcha/email inválido: a pessoa corrige e tenta já. Limite ou falha: segura 60 s.
      if (kind === 'rate_limited' || kind === 'unknown') start();
    } finally {
      setToken('');
      setWidgetKey((k) => k + 1);
    }
  }

  const buttonText = resend.isPending
    ? 'Enviando…'
    : remaining > 0
      ? resendButtonLabel(remaining)
      : (idleLabel ?? resendButtonLabel(0));
  const copy = failure ? RESEND_FAILURE_COPY[failure] : null;

  return (
    <div className={['flex flex-col gap-3', className].filter(Boolean).join(' ')}>
      <TurnstileWidget key={widgetKey} onToken={setToken} />
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        loading={resend.isPending}
        disabled={blocked}
        onClick={onResend}
      >
        {buttonText}
      </Button>
      {/* Região viva sempre montada: leitores de tela anunciam a mudança de conteúdo. */}
      <div aria-live="polite" role="status" className="empty:hidden">
        {sentTo && !resend.isPending && (
          <div className="flex gap-3 rounded-md border border-border bg-surface-2 p-3">
            <MailCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            <p className="font-body text-sm text-text-mid">{resendSuccessMessage(sentTo)}</p>
          </div>
        )}
      </div>
      <div role="alert" className="empty:hidden">
        {copy && (
          <div className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 p-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <p className="font-head text-sm font-semibold text-text">{copy.title}</p>
              <p className="font-body text-sm text-text-mid">{copy.description}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
