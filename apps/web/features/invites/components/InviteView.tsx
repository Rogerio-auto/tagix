'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, CircleCheck, Clock, LinkIcon, MailCheck, MailQuestion, UserRoundX } from 'lucide-react';
import { Button, Skeleton } from '@hm/ui';
import { formatRelative } from '../time';
import { roleLabel, type InvitePreview } from '../types';
import {
  AuthNotice,
  primaryLinkClass,
  quietLinkClass,
  secondaryLinkClass,
} from '@/features/auth/components/AuthKit';
import { CreatePasswordForm, type CreatePasswordValues } from './CreatePasswordForm';

/** Erro de ação em 3 partes (UX §2.11). */
export interface ViewError {
  title: string;
  description: string;
}

/**
 * O que a pessoa pode fazer agora. Decidido pelo container a partir do preview, da
 * sessão e do fragmento — a view só desenha.
 */
export type Stage =
  | { kind: 'accept'; sessionEmail: string | null }
  | { kind: 'login' }
  | { kind: 'wrong-account'; sessionEmail: string | null }
  | { kind: 'create-password' }
  | { kind: 'send-proof' }
  | { kind: 'proof-sent'; emailMasked: string }
  | { kind: 'created'; next: string };

export type PageState =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; preview: InvitePreview; stage: Stage };

export interface InviteViewProps {
  state: PageState;
  /** Destino do "Entre para aceitar" — já com o `next` apontando de volta ao convite. */
  loginHref: string;
  busy: boolean;
  error: ViewError | null;
  /** Segundos até poder pedir outro email de confirmação (0 = livre). */
  cooldown: number;
  onAccept: () => void;
  onCreate: (values: CreatePasswordValues) => void | Promise<void>;
  onSendProof: () => void;
  onLogout: () => void;
  onRetry: () => void;
}

/** Aviso em 3 partes, `role="alert"`. */
function Alert({ error }: { error: ViewError }): React.JSX.Element {
  return (
    <AuthNotice role="alert" tone="danger" icon={<AlertTriangle aria-hidden />} title={error.title}>
      {error.description}
    </AuthNotice>
  );
}

function Notice({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <AuthNotice tone="neutral" icon={icon} title={title}>
      {children}
    </AuthNotice>
  );
}

const eyebrowClass =
  'flex items-center gap-2.5 font-mono text-xs font-medium uppercase tracking-[0.14em] text-text-low';

/** O "passe": quem convidou, para onde, com que papel e até quando. */
function InviteHeader({ preview }: { preview: InvitePreview }): React.JSX.Element {
  const initial = preview.workspaceName.trim().charAt(0).toUpperCase() || '·';
  return (
    <header className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <p className={eyebrowClass}>
          <span aria-hidden className="h-px w-5 bg-border-2" />
          Convite
        </p>
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="grid size-14 shrink-0 place-items-center rounded-lg border border-border bg-surface-2 font-head text-2xl font-semibold text-text shadow-ds-1"
          >
            {initial}
          </span>
          <h1 className="min-w-0 break-words font-head text-h3 text-balance text-text lg:text-h2">
            {preview.workspaceName}
          </h1>
        </div>
      </div>
      <p className="font-body text-body text-text-mid">
        {preview.inviterName ? (
          <>
            <span className="font-bold text-text">{preview.inviterName}</span> convidou você para
            entrar como{' '}
          </>
        ) : (
          <>Você foi convidado para entrar como </>
        )}
        <span className="font-bold text-text">{roleLabel(preview.role)}</span>.
      </p>
      {/* Cada par é uma linha inteira (`div` em `dl` é HTML válido): a hairline atravessa
          a caixa sem o vão do `gap-x` entre termo e valor. */}
      <dl className="divide-y divide-border rounded-md border border-border bg-surface px-4 font-body text-sm">
        <div className="flex items-baseline justify-between gap-6 py-3">
          <dt className="shrink-0 font-mono text-xs uppercase tracking-[0.12em] text-text-low">Para</dt>
          <dd className="min-w-0 truncate text-right font-mono text-text">{preview.emailMasked}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-6 py-3">
          <dt className="shrink-0 font-mono text-xs uppercase tracking-[0.12em] text-text-low">Expira</dt>
          <dd className="text-right font-mono tabular-nums text-text">{formatRelative(preview.expiresAt)}</dd>
        </div>
      </dl>
    </header>
  );
}

function StageBody({
  preview,
  stage,
  loginHref,
  busy,
  error,
  cooldown,
  onAccept,
  onCreate,
  onSendProof,
  onLogout,
}: Omit<InviteViewProps, 'state' | 'onRetry'> & { preview: InvitePreview; stage: Stage }): React.JSX.Element {
  switch (stage.kind) {
    case 'accept':
      return (
        <div className="flex flex-col gap-4">
          {error && <Alert error={error} />}
          {stage.sessionEmail && (
            <p className="font-body text-sm text-text-low">
              Você está conectado como{' '}
              <span className="font-mono text-text-mid">{stage.sessionEmail}</span>.
            </p>
          )}
          <Button size="lg" loading={busy} onClick={onAccept} className="w-full">
            Entrar na {preview.workspaceName}
          </Button>
        </div>
      );

    case 'login':
      return (
        <div className="flex flex-col gap-4">
          {error && <Alert error={error} />}
          <p className="font-body text-sm text-text-mid">
            Este convite é para uma conta que já existe. Entre com ela para aceitar.
          </p>
          <Link
            href={loginHref}
            className={primaryLinkClass}
          >
            Entre para aceitar
          </Link>
        </div>
      );

    case 'wrong-account':
      return (
        <div className="flex flex-col gap-4">
          <Notice icon={<UserRoundX aria-hidden />} title="Este convite é para outra conta">
            <p>
              {stage.sessionEmail ? (
                <>
                  Você está conectado como{' '}
                  <span className="font-mono text-text">{stage.sessionEmail}</span>, mas o convite foi
                  enviado para <span className="font-mono text-text">{preview.emailMasked}</span>.
                </>
              ) : (
                <>
                  A conta conectada não é a do convite, enviado para{' '}
                  <span className="font-mono text-text">{preview.emailMasked}</span>.
                </>
              )}{' '}
              Saia e entre com o email certo.
            </p>
          </Notice>
          <Button size="lg" variant="secondary" loading={busy} onClick={onLogout} className="w-full">
            Sair e entrar com outra conta
          </Button>
        </div>
      );

    case 'create-password':
      return (
        <div className="flex flex-col gap-4">
          {error && <Alert error={error} />}
          <p className="font-body text-sm text-text-mid">
            Seu email foi confirmado. Falta criar a senha para entrar na equipe.
          </p>
          <CreatePasswordForm busy={busy} onSubmit={onCreate} />
        </div>
      );

    case 'send-proof':
      return (
        <div className="flex flex-col gap-4">
          {error && <Alert error={error} />}
          <Notice icon={<MailQuestion aria-hidden />} title="Confirme que o email é seu">
            <p>
              Para criar a sua conta, vamos enviar um link de confirmação para{' '}
              <span className="font-mono text-text">{preview.emailMasked}</span>. Abra o email e
              toque no botão dele — ele traz você de volta aqui.
            </p>
          </Notice>
          <Button
            size="lg"
            loading={busy}
            disabled={cooldown > 0}
            onClick={onSendProof}
            className="w-full"
          >
            {cooldown > 0 ? `Enviar de novo em ${cooldown}s` : 'Receber email de confirmação'}
          </Button>
        </div>
      );

    case 'proof-sent':
      return (
        <div className="flex flex-col gap-4">
          {error && <Alert error={error} />}
          <Notice icon={<MailCheck aria-hidden />} title="Email enviado">
            <p>
              Mandamos o link para <span className="font-mono text-text">{stage.emailMasked}</span>.
              Abra o email e toque em <span className="font-semibold text-text">Aceitar convite</span>.
              Pode fechar esta aba — o link do email abre a tela certa.
            </p>
          </Notice>
          <Button
            size="lg"
            variant="secondary"
            loading={busy}
            disabled={cooldown > 0}
            onClick={onSendProof}
            className="w-full"
          >
            {cooldown > 0 ? `Não chegou? Reenviar em ${cooldown}s` : 'Não chegou? Reenviar email'}
          </Button>
        </div>
      );

    case 'created':
      return (
        <div className="flex flex-col gap-4">
          <Notice icon={<CircleCheck className="text-success" aria-hidden />} title="Conta criada">
            <p>
              Entre com a sua senha para abrir a{' '}
              <span className="font-semibold text-text">{preview.workspaceName}</span>.
            </p>
          </Notice>
          <Link
            href={stage.next}
            className={primaryLinkClass}
          >
            Entrar
          </Link>
        </div>
      );
  }
}

/**
 * Tela do convite (`/convite/[token]`). Apresentacional: recebe o estado pronto e
 * desenha. Cobre carregando, inválido/expirado (sem dizer o motivo) e indisponível.
 */
export function InviteView(props: InviteViewProps): React.JSX.Element {
  const { state } = props;

  return (
    <div className="w-full">
      {state.kind === 'loading' && (
        <div role="status" aria-busy="true" aria-label="Carregando convite" className="flex flex-col gap-6">
          <Skeleton className="h-3 w-20" />
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 rounded-lg" />
            <Skeleton className="h-9 w-48" />
          </div>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-24 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-sm" />
        </div>
      )}

      {state.kind === 'invalid' && (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <span className="grid size-12 place-items-center rounded-md border border-border bg-surface-2 text-text-mid">
              <LinkIcon className="size-5" aria-hidden strokeWidth={1.75} />
            </span>
            <h1 className="font-head text-h3 text-balance text-text lg:text-h2">
              Este convite não está mais disponível
            </h1>
            <p className="font-body text-body text-text-mid">
              O link pode ter expirado ou já ter sido usado. Peça um novo convite a quem convidou
              você.
            </p>
          </div>
          <Link href="/login" className={secondaryLinkClass}>
            Ir para o login
          </Link>
        </div>
      )}

      {state.kind === 'unavailable' && (
        <div role="alert" className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <span className="grid size-12 place-items-center rounded-md border border-danger/30 bg-danger/10 text-danger">
              <Clock className="size-5" aria-hidden strokeWidth={1.75} />
            </span>
            <h1 className="font-head text-h3 text-balance text-text lg:text-h2">
              Não conseguimos abrir o convite
            </h1>
            <p className="font-body text-body text-text-mid">
              O serviço está instável agora. Seu convite continua válido — tente de novo em instantes.
            </p>
          </div>
          <Button size="lg" variant="secondary" onClick={props.onRetry} className="w-full">
            Tentar de novo
          </Button>
        </div>
      )}

      {state.kind === 'ready' && (
        <div className="flex flex-col gap-8">
          <InviteHeader preview={state.preview} />
          <StageBody {...props} preview={state.preview} stage={state.stage} />
          {(state.stage.kind === 'create-password' || state.stage.kind === 'send-proof') && (
            <div className="-mt-3 flex justify-center border-t border-border pt-3">
              <Link href={props.loginHref} className={quietLinkClass}>
                Já tenho conta — entrar
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
