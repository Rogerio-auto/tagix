'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/shared/lib/api-client';
import { safeNextPath } from '@/shared/lib/safe-redirect';
import {
  useAcceptInvite,
  useInviteLogout,
  useInvitePreview,
  useInviteSession,
  useSendInviteEmail,
} from '../queries';
import { consumeProofFromFragment } from '../proof-fragment';
import { createdLoginHref, loginHrefFor, resolveStage, type SessionProbe } from '../stage';
import type { EmailProof } from '../types';
import { InviteView, type PageState, type ViewError } from './InviteView';
import type { CreatePasswordValues } from './CreatePasswordForm';

/** 1 envio por minuto por convite (API: `send_cooldown`). */
const SEND_COOLDOWN_SECONDS = 60;

const GENERIC_ERROR: ViewError = {
  title: 'Não foi possível concluir',
  description: 'Algo deu errado do nosso lado. Tente novamente em instantes.',
};

function acceptError(err: unknown): { error: ViewError; code: string | undefined; status: number | undefined } {
  if (!(err instanceof ApiError)) return { error: GENERIC_ERROR, code: undefined, status: undefined };
  const { code, status } = err;
  switch (code) {
    case 'weak_password':
    case 'password_required':
      return {
        status,
        code,
        error: {
          title: 'Escolha uma senha mais forte',
          description: 'Use ao menos 10 caracteres, com letras e números.',
        },
      };
    case 'email_proof_required':
      return {
        status,
        code,
        error: {
          title: 'O link do email não vale mais',
          description: 'Ele já foi usado ou foi trocado. Envie um novo email de confirmação.',
        },
      };
    case 'invite_conflict':
      return {
        status,
        code,
        error: {
          title: 'Não foi possível entrar nesta empresa',
          description: 'Há um conflito com o seu acesso. Fale com quem convidou você.',
        },
      };
    case 'impersonation_read_only':
      return {
        status,
        code,
        error: {
          title: 'Modo de visualização ativo',
          description: 'Saia do modo de visualização para aceitar convites.',
        },
      };
    default:
      return { error: GENERIC_ERROR, code, status };
  }
}

function sendError(err: unknown): { error: ViewError; cooldown: boolean } {
  if (err instanceof ApiError) {
    if (err.code === 'send_cooldown') {
      return {
        cooldown: true,
        error: {
          title: 'Aguarde um instante',
          description: 'O último email saiu agora há pouco. Confira também a caixa de spam.',
        },
      };
    }
    if (err.code === 'send_limit') {
      return {
        cooldown: false,
        error: {
          title: 'Limite de envios atingido',
          description: 'Já mandamos vários emails para este convite. Peça um novo a quem convidou você.',
        },
      };
    }
    if (err.status === 503) {
      return {
        cooldown: false,
        error: { title: 'Envio indisponível agora', description: 'Tente novamente em alguns minutos.' },
      };
    }
  }
  return { cooldown: false, error: GENERIC_ERROR };
}

export function InviteScreen({ token }: { token: string }): React.JSX.Element {
  const router = useRouter();
  const preview = useInvitePreview(token);
  const sessionQuery = useInviteSession();
  const accept = useAcceptInvite();
  const sendEmail = useSendInviteEmail();
  const logout = useInviteLogout();

  // Prova de posse: só em memória. `undefined` = fragmento ainda não lido.
  const [proof, setProof] = useState<EmailProof | null | undefined>(undefined);
  const proofRead = useRef(false);
  useEffect(() => {
    // Uma vez só (o StrictMode remonta o efeito e o fragmento já foi limpo da URL).
    if (proofRead.current) return;
    proofRead.current = true;
    setProof(consumeProofFromFragment(window));
  }, []);

  const [error, setError] = useState<ViewError | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [wrongAccount, setWrongAccount] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [createdNext, setCreatedNext] = useState<string | null>(null);
  const [sentEmailMasked, setSentEmailMasked] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Relógio do cooldown: só liga enquanto há contagem.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  const loginHref = loginHrefFor(token);

  const session: SessionProbe = sessionQuery.isPending
    ? { status: 'loading' }
    : sessionQuery.isError
      ? { status: 'error' }
      : { status: 'ready', email: sessionQuery.data?.email ?? null };

  const onFailure = useCallback((err: unknown) => {
    const { error: viewError, code, status } = acceptError(err);
    if (status === 404) {
      setInvalid(true);
      return;
    }
    if (code === 'login_required' || status === 401) {
      setLoginRequired(true);
      setError(null);
      return;
    }
    if (code === 'wrong_account') {
      setWrongAccount(true);
      setError(null);
      return;
    }
    if (code === 'email_proof_required') setProof(null);
    setError(viewError);
  }, []);

  const onAccept = useCallback(() => {
    setError(null);
    accept.mutate(
      { token },
      {
        onSuccess: (res) => {
          router.replace(safeNextPath(res.next));
          router.refresh();
        },
        onError: onFailure,
      },
    );
  }, [accept, onFailure, router, token]);

  const onCreate = useCallback(
    (values: CreatePasswordValues) => {
      if (!proof) return;
      setError(null);
      accept.mutate(
        { token, name: values.name, password: values.password, emailProof: proof },
        {
          onSuccess: (res) => {
            // A prova é de uso único: depois de consumida, sai da memória.
            setProof(null);
            setCreatedNext(createdLoginHref(res.next));
          },
          onError: onFailure,
        },
      );
    },
    [accept, onFailure, proof, token],
  );

  const onSendProof = useCallback(() => {
    setError(null);
    sendEmail.mutate(token, {
      onSuccess: (res) => {
        setSentEmailMasked(res.emailMasked);
        setCooldownUntil(Date.now() + SEND_COOLDOWN_SECONDS * 1000);
        setNow(Date.now());
      },
      onError: (err) => {
        const { error: viewError, cooldown: shouldCool } = sendError(err);
        if (shouldCool) {
          setCooldownUntil(Date.now() + SEND_COOLDOWN_SECONDS * 1000);
          setNow(Date.now());
        }
        setError(viewError);
      },
    });
  }, [sendEmail, token]);

  const onLogout = useCallback(() => {
    logout.mutate(undefined, {
      // Navegação completa: zera cache e stores da sessão anterior.
      onSettled: () => window.location.assign(loginHref),
    });
  }, [logout, loginHref]);

  let state: PageState;
  if (invalid || (preview.isError && preview.error instanceof ApiError && preview.error.status === 404)) {
    state = { kind: 'invalid' };
  } else if (preview.isError) {
    state = { kind: 'unavailable' };
  } else if (preview.isPending) {
    state = { kind: 'loading' };
  } else {
    const stage = resolveStage({
      preview: preview.data,
      session,
      proof,
      sentEmailMasked,
      loginRequired,
      wrongAccount,
      createdNext,
    });
    state = stage ? { kind: 'ready', preview: preview.data, stage } : { kind: 'loading' };
  }

  return (
    <InviteView
      state={state}
      loginHref={loginHref}
      busy={accept.isPending || sendEmail.isPending || logout.isPending}
      error={error}
      cooldown={cooldown}
      onAccept={onAccept}
      onCreate={onCreate}
      onSendProof={onSendProof}
      onLogout={onLogout}
      onRetry={() => void preview.refetch()}
    />
  );
}
