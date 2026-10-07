'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, CircleCheck, Clock, LinkIcon, MailCheck, MailQuestion, UserRoundX } from 'lucide-react';
import { Button, Skeleton } from '@hm/ui';
import { formatRelative } from '../time';
import { roleLabel, type InvitePreview } from '../types';
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

function Wordmark(): React.JSX.Element {
  return (
    <div className="mb-8 flex items-center gap-2">
      <span className="font-display text-2xl text-brand" aria-hidden>
        ◢
      </span>
      <span className="font-head text-2xl font-semibold text-text">Leadium</span>
    </div>
  );
}

/** Aviso em 3 partes, `role="alert"`. */
function Alert({ error }: { error: ViewError }): React.JSX.Element {
  return (
    <div role="alert" className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 p-3">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
      <div className="flex flex-col gap-0.5">
        <p className="font-head text-sm font-semibold text-text">{error.title}</p>
        <p className="font-body text-sm text-text-mid">{error.description}</p>
      </div>
    </div>
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
    <div className="flex gap-3 rounded-md border border-border bg-surface-2 p-3">
      <span className="mt-0.5 shrink-0 text-text-mid">{icon}</span>
      <div className="flex flex-col gap-1">
        <p className="font-head text-sm font-semibold text-text">{title}</p>
        <div className="font-body text-sm text-text-mid">{children}</div>
      </div>
    </div>
  );
}

const textLinkClass =
  'touch-target flex items-center justify-center rounded-sm font-body text-sm text-text-low outline-none transition-colors hover:text-text focus-visible:shadow-glow-md';

/** O "passe": quem convidou, para onde, com que papel e até quando. */
function InviteHeader({ preview }: { preview: InvitePreview }): React.JSX.Element {
  const initial = preview.workspaceName.trim().charAt(0).toUpperCase() || '·';
  return (
    <header className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-border-2 bg-surface-3 font-head text-2xl font-semibold text-text"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <p className="font-head text-xs font-medium uppercase tracking-widest text-text-low">
            Convite
          </p>
          <h1 className="break-words font-head text-3xl font-semibold leading-tight text-text">
            {preview.workspaceName}
          </h1>
        </div>
      </div>
      <p className="font-body text-base text-text-mid">
        {preview.inviterName ? (
          <>
            <span className="font-semibold text-text">{preview.inviterName}</span> convidou você para
            entrar como{' '}
          </>
        ) : (
          <>Você foi convidado para entrar como </>
        )}
        <span className="font-semibold text-text">{roleLabel(preview.role)}</span>.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-y border-border py-3 font-body text-sm">
        <dt className="text-text-low">Para</dt>
        <dd className="min-w-0 truncate text-right font-price text-text">{preview.emailMasked}</dd>
        <dt className="text-text-low">Expira</dt>
        <dd className="text-right text-text">{formatRelative(preview.expiresAt)}</dd>
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
              <span className="font-price text-text-mid">{stage.sessionEmail}</span>.
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
            className="inline-flex h-12 w-full items-center justify-center rounded-md bg-brand px-6 font-head text-base font-semibold text-text-on-brand outline-none transition-[background-color,box-shadow] duration-200 hover:bg-brand-strong focus-visible:shadow-glow-md"
          >
            Entre para aceitar
          </Link>
        </div>
      );

    case 'wrong-account':
      return (
        <div className="flex flex-col gap-4">
          <Notice icon={<UserRoundX className="size-5" aria-hidden />} title="Este convite é para outra conta">
            <p>
              {stage.sessionEmail ? (
                <>
                  Você está conectado como{' '}
                  <span className="font-price text-text">{stage.sessionEmail}</span>, mas o convite foi
                  enviado para <span className="font-price text-text">{preview.emailMasked}</span>.
                </>
              ) : (
                <>
                  A conta conectada não é a do convite, enviado para{' '}
                  <span className="font-price text-text">{preview.emailMasked}</span>.
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
          <Notice icon={<MailQuestion className="size-5" aria-hidden />} title="Confirme que o email é seu">
            <p>
              Para criar a sua conta, vamos enviar um link de confirmação para{' '}
              <span className="font-price text-text">{preview.emailMasked}</span>. Abra o email e
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
          <Notice icon={<MailCheck className="size-5" aria-hidden />} title="Email enviado">
            <p>
              Mandamos o link para <span className="font-price text-text">{stage.emailMasked}</span>.
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
          <Notice icon={<CircleCheck className="size-5 text-success" aria-hidden />} title="Conta criada">
            <p>
              Entre com a sua senha para abrir a{' '}
              <span className="font-semibold text-text">{preview.workspaceName}</span>.
            </p>
          </Notice>
          <Link
            href={stage.next}
            className="inline-flex h-12 w-full items-center justify-center rounded-md bg-brand px-6 font-head text-base font-semibold text-text-on-brand outline-none transition-[background-color,box-shadow] duration-200 hover:bg-brand-strong focus-visible:shadow-glow-md"
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
    <div className="mx-auto w-full max-w-sm py-8 md:py-0">
      <Wordmark />

      {state.kind === 'loading' && (
        <div role="status" aria-busy="true" aria-label="Carregando convite" className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-48" />
            </div>
          </div>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {state.kind === 'invalid' && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <span className="flex size-12 items-center justify-center rounded-pill border border-border-2 bg-surface-2 text-text-mid">
              <LinkIcon className="size-6" aria-hidden strokeWidth={1.75} />
            </span>
            <h1 className="font-head text-2xl font-semibold text-text">
              Este convite não está mais disponível
            </h1>
            <p className="font-body text-base text-text-mid">
              O link pode ter expirado ou já ter sido usado. Peça um novo convite a quem convidou
              você.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex h-12 w-full items-center justify-center rounded-md border border-border bg-transparent px-6 font-head text-base font-semibold text-text outline-none transition-[border-color,background-color,box-shadow] duration-200 hover:border-border-2 hover:bg-surface-2 focus-visible:shadow-glow-md"
          >
            Ir para o login
          </Link>
        </div>
      )}

      {state.kind === 'unavailable' && (
        <div role="alert" className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <span className="flex size-12 items-center justify-center rounded-pill border border-danger/25 bg-danger/10 text-danger">
              <Clock className="size-6" aria-hidden strokeWidth={1.75} />
            </span>
            <h1 className="font-head text-2xl font-semibold text-text">Não conseguimos abrir o convite</h1>
            <p className="font-body text-base text-text-mid">
              O serviço está instável agora. Seu convite continua válido — tente de novo em instantes.
            </p>
          </div>
          <Button size="lg" variant="secondary" onClick={props.onRetry} className="w-full">
            Tentar de novo
          </Button>
        </div>
      )}

      {state.kind === 'ready' && (
        <div className="flex flex-col gap-6">
          <InviteHeader preview={state.preview} />
          <StageBody {...props} preview={state.preview} stage={state.stage} />
          {(state.stage.kind === 'create-password' || state.stage.kind === 'send-proof') && (
            <Link href={props.loginHref} className={textLinkClass}>
              Já tenho conta — entrar
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
