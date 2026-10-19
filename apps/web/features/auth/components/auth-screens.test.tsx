/**
 * O vitest do @hm/web roda em `node` (sem DOM): estes testes renderizam o HTML inicial
 * de cada tela (`renderToStaticMarkup`) e verificam copy, rótulos e estado desabilitado.
 * A interação (digitar, clicar, contagem em tempo real) é coberta pelo Playwright
 * (`apps/web/e2e/specs/auth.spec.ts`).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { ReactElement } from 'react';
import { ToastProvider } from '@hm/ui';
import type * as ReactHookForm from 'react-hook-form';
import type { FieldValues } from 'react-hook-form';
import type * as Queries from '../queries';
import type * as ApiClient from '@/shared/lib/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthStep, CompanionSignal } from '@/features/auth/companion';
import { ApiError } from '@/shared/lib/api-client';

// O esbuild do vitest compila JSX no runtime clássico (tsconfig `jsx: preserve`, e a
// config do vitest está fora deste slot): os componentes procuram `React` no escopo global.
Object.assign(globalThis, { React });

/**
 * Dublês do companheiro (F76-S12). O contrato só aceita SINAIS (`CompanionSignal` é uma
 * união fechada, sem carga livre); aqui o `signal` e o `useAuthCompanionStep` viram espiões
 * tipados. O `handleSubmit` do react-hook-form é embrulhado só para capturar os callbacks
 * (a tela roda em `node`, sem DOM para disparar o submit): o formulário real continua o mesmo.
 */
const h = vi.hoisted(() => ({
  signal: vi.fn<(s: CompanionSignal) => void>(),
  step: vi.fn<(s: AuthStep) => void>(),
  push: vi.fn<(href: string) => void>(),
  search: { current: '' },
  login: vi.fn<(input: unknown) => Promise<{ pendingPlanKey?: string | null }>>(),
  reset: vi.fn<(input: unknown) => Promise<unknown>>(),
  post: vi.fn<(path: string, body: unknown) => Promise<unknown>>(),
  form: {
    valid: undefined as undefined | ((data: FieldValues) => unknown),
    invalid: undefined as undefined | ((errors: FieldValues) => unknown),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(h.search.current),
}));

vi.mock('@/features/auth/companion', () => ({
  useAuthCompanion: () => ({ signal: h.signal }),
  useAuthCompanionStep: h.step,
  useCompanionAnchor: () => undefined,
}));

vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual<typeof ReactHookForm>('react-hook-form');
  return {
    ...actual,
    useForm: (props?: Parameters<typeof actual.useForm>[0]) => {
      const form = actual.useForm(props);
      const real = form.handleSubmit;
      const handleSubmit: typeof real = (onValid, onInvalid) => {
        h.form.valid = (data) => onValid(data, undefined);
        h.form.invalid = onInvalid;
        return real(onValid, onInvalid);
      };
      return { ...form, handleSubmit };
    },
  };
});

vi.mock('../queries', async () => {
  const actual = await vi.importActual<typeof Queries>('../queries');
  return {
    ...actual,
    useLogin: () => ({ mutateAsync: h.login }),
    useRequestReset: () => ({ mutateAsync: h.reset }),
  };
});

vi.mock('@/shared/lib/api-client', async () => {
  const actual = await vi.importActual<typeof ApiClient>('@/shared/lib/api-client');
  return { ...actual, api: { ...actual.api, post: h.post } };
});

import { ResendVerification } from './ResendVerification';
import { SignupForm } from './SignupForm';
import { UnverifiedPanel, LoginForm } from './LoginForm';
import { ExpiredLinkRecovery, VerifiedSuccess, VerifyEmail } from './VerifyEmail';
import { ResetPasswordForm } from './ResetPasswordForm';
import { NewPasswordForm } from './NewPasswordForm';
import { AuthHeading, AuthStepTransition } from './AuthKit';
import { CreatePasswordForm } from '../../invites/components/CreatePasswordForm';

function render(node: ReactElement): string {
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

describe('ResendVerification', () => {
  it('livre: botão "Reenviar email" (desabilitado até o captcha resolver)', () => {
    const html = render(<ResendVerification email="ana@empresa.com" />);
    expect(html).toContain('Reenviar email');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it('com a contagem rodando mostra os segundos e bloqueia', () => {
    const html = render(<ResendVerification email="ana@empresa.com" initialCooldownSeconds={60} />);
    expect(html).toContain('Reenviar em 60 s');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it('email inválido mantém o botão bloqueado', () => {
    const html = render(<ResendVerification email="nao-e-email" />);
    expect(html).toMatch(/<button[^>]*disabled/);
  });
});

describe('Login de não confirmado', () => {
  it('mostra a mensagem e "Reenviar confirmação" inline', () => {
    const html = render(<UnverifiedPanel email="ana@empresa.com" />);
    expect(html).toContain('Confirme seu email para entrar.');
    expect(html).toContain('Reenviar confirmação');
  });

  it('mostra o aviso do convite (o pré-preenchimento do campo é checado no e2e)', () => {
    const html = render(<LoginForm initialEmail="ana@empresa.com" notice="invite" />);
    expect(html).toContain('Conta criada. Entre com sua senha.');
  });
});

describe('Verify com link expirado', () => {
  it('oferece campo de email e reenvio em vez de beco', () => {
    const html = render(<ExpiredLinkRecovery />);
    expect(html).toContain('Link inválido ou expirado');
    expect(html).toContain('Email da sua conta');
    expect(html).toContain('Reenviar email');
    expect(html).toContain('href="/login"');
  });

  it('sem token explica que o link está incompleto', () => {
    expect(render(<ExpiredLinkRecovery missing />)).toContain('Link incompleto');
  });

  it('sucesso leva ao login com o email', () => {
    const html = render(<VerifiedSuccess email="ana@empresa.com" />);
    expect(html).toContain('Email confirmado');
    expect(html).toContain('/login?email=ana%40empresa.com&amp;from=verify');
  });
});

describe('Signup', () => {
  it('traz a caixa de aceite com links para os Termos e a Privacidade', () => {
    const html = render(<SignupForm />);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Li e aceito os');
    expect(html).toContain('href="/termos"');
    expect(html).toContain('href="/privacidade"');
  });
});

describe('Título acompanha o estado (F72-S08, ressalva da F71-S09)', () => {
  const h1 = (html: string): string | undefined => /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1];

  it('cadastro abre com "Criar conta"', () => {
    expect(h1(render(<SignupForm />))).toBe('Criar conta');
  });

  it('link expirado e link incompleto viram o H1 da verificação', () => {
    expect(h1(render(<ExpiredLinkRecovery />))).toBe('Link inválido ou expirado');
    expect(h1(render(<ExpiredLinkRecovery missing />))).toBe('Link incompleto');
  });

  it('sucesso: H1 "Email confirmado" com foco programático (tabindex -1)', () => {
    const html = render(<VerifiedSuccess email="ana@empresa.com" />);
    expect(h1(html)).toBe('Email confirmado');
    expect(html).toMatch(/<h1[^>]*tabindex="-1"/);
  });
});

/* ---------------------------------------------------------------------------------------
 * Companheiro das telas de acesso (F76-S12): os formulários anunciam a etapa e emitem
 * SINAIS (envio, erro, sucesso). O vitest roda sem DOM: o submit é disparado chamando os
 * callbacks que o `handleSubmit` recebeu, que é exatamente o que o navegador chamaria.
 * ------------------------------------------------------------------------------------- */

const SECRET = 'segredo-super-unico-123';

beforeEach(() => {
  h.signal.mockReset();
  h.step.mockReset();
  h.push.mockReset();
  h.login.mockReset();
  h.reset.mockReset();
  h.post.mockReset();
  h.search.current = '';
  h.form.valid = undefined;
  h.form.invalid = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

function signals(): CompanionSignal[] {
  return h.signal.mock.calls.map(([s]) => s);
}

function submitValid(data: FieldValues): Promise<unknown> {
  const fn = h.form.valid;
  if (!fn) throw new Error('handleSubmit não foi chamado');
  return Promise.resolve(fn(data));
}

describe('Companheiro: etapa anunciada por tela', () => {
  it('cada tela anuncia a sua etapa', () => {
    render(<LoginForm />);
    expect(h.step).toHaveBeenLastCalledWith('login');
    render(<SignupForm />);
    expect(h.step).toHaveBeenLastCalledWith('signup');
    render(<ResetPasswordForm />);
    expect(h.step).toHaveBeenLastCalledWith('reset-request');
    render(<NewPasswordForm />);
    expect(h.step).toHaveBeenLastCalledWith('reset-new');
    render(<VerifyEmail />);
    expect(h.step).toHaveBeenLastCalledWith('verify-invalid');
  });

  it('verificação com token começa pendente', () => {
    h.search.current = 'token=abc';
    render(<VerifyEmail />);
    expect(h.step).toHaveBeenLastCalledWith('verify-pending');
  });
});

describe('Companheiro: login', () => {
  it('sucesso: submit, depois success{final:false}, e o push sai no mesmo tick (sem timers)', async () => {
    vi.useFakeTimers();
    h.login.mockResolvedValue({});
    render(<LoginForm />);
    await submitValid({ email: 'ana@empresa.com', password: SECRET });
    expect(signals()).toEqual([{ type: 'submit' }, { type: 'success', final: false }]);
    expect(h.push).toHaveBeenCalledTimes(1);
    const successAt = h.signal.mock.invocationCallOrder[1] ?? Infinity;
    const pushAt = h.push.mock.invocationCallOrder[0] ?? -Infinity;
    expect(successAt).toBeLessThan(pushAt);
  });

  it('401 vira erro de credencial; outro erro vira erro de servidor', async () => {
    render(<LoginForm />);
    h.login.mockRejectedValueOnce(new ApiError(401, 'x'));
    await submitValid({ email: 'ana@empresa.com', password: SECRET });
    h.login.mockRejectedValueOnce(new ApiError(500, 'x'));
    await submitValid({ email: 'ana@empresa.com', password: SECRET });
    expect(signals()).toEqual([
      { type: 'submit' },
      { type: 'error', kind: 'credentials' },
      { type: 'submit' },
      { type: 'error', kind: 'server' },
    ]);
    expect(h.push).not.toHaveBeenCalled();
  });

  it('403 de email não verificado acalma (settled), sem erro', async () => {
    render(<LoginForm />);
    h.login.mockRejectedValueOnce(new ApiError(403, 'x', undefined, undefined, 'email_unverified'));
    await submitValid({ email: 'ana@empresa.com', password: SECRET });
    expect(signals()).toEqual([{ type: 'submit' }, { type: 'settled' }]);
  });

  it('validação do formulário vira error{validation}, sem submit', () => {
    render(<LoginForm />);
    h.form.invalid?.({});
    expect(signals()).toEqual([{ type: 'error', kind: 'validation' }]);
  });

  it('nenhum valor de campo chega ao companheiro', async () => {
    h.login.mockRejectedValueOnce(new ApiError(401, 'x'));
    render(<LoginForm />);
    await submitValid({ email: 'ana@empresa.com', password: SECRET });
    const seen = JSON.stringify([h.signal.mock.calls, h.step.mock.calls]);
    expect(seen).not.toContain(SECRET);
    expect(seen).not.toContain('ana@empresa.com');
  });
});

describe('Companheiro: cadastro', () => {
  it('sem Turnstile resolvido: error{validation} e nenhum envio', async () => {
    render(<SignupForm />);
    await submitValid({ name: 'Ana', email: 'ana@empresa.com', password: SECRET });
    expect(signals()).toEqual([{ type: 'error', kind: 'validation' }]);
  });

  it('validação do formulário vira error{validation}', () => {
    render(<SignupForm />);
    h.form.invalid?.({});
    expect(signals()).toEqual([{ type: 'error', kind: 'validation' }]);
  });
});

describe('Companheiro: pedido de redefinição', () => {
  it('sucesso é final; falha é de servidor; validação é de validação', async () => {
    render(<ResetPasswordForm />);
    h.reset.mockResolvedValueOnce({});
    await submitValid({ email: 'ana@empresa.com' });
    h.reset.mockRejectedValueOnce(new ApiError(500, 'x'));
    await submitValid({ email: 'ana@empresa.com' });
    h.form.invalid?.({});
    expect(signals()).toEqual([
      { type: 'submit' },
      { type: 'success', final: true },
      { type: 'submit' },
      { type: 'error', kind: 'server' },
      { type: 'error', kind: 'validation' },
    ]);
  });
});

describe('Companheiro: nova senha', () => {
  it('com token: sucesso é final e falha é de servidor', async () => {
    h.search.current = 'token=abc';
    render(<NewPasswordForm />);
    h.post.mockResolvedValueOnce({ ok: true });
    await submitValid({ password: SECRET, confirm: SECRET });
    h.post.mockRejectedValueOnce(new ApiError(400, 'x'));
    await submitValid({ password: SECRET, confirm: SECRET });
    expect(signals()).toEqual([
      { type: 'submit' },
      { type: 'success', final: true },
      { type: 'submit' },
      { type: 'error', kind: 'server' },
    ]);
    expect(JSON.stringify(h.post.mock.calls[0])).toContain('abc');
    expect(JSON.stringify(h.signal.mock.calls)).not.toContain(SECRET);
  });
});

describe('Companheiro: convite', () => {
  it('validação do formulário de senha vira error{validation}', () => {
    render(<CreatePasswordForm busy={false} onSubmit={vi.fn()} />);
    h.form.invalid?.({});
    expect(signals()).toEqual([{ type: 'error', kind: 'validation' }]);
  });
});

describe('AuthStepTransition e âncora do título', () => {
  it('renderiza só o bloco atual (o fantasma da saída nasce no cliente, na troca)', () => {
    const html = render(
      <AuthStepTransition stepKey="a">
        <AuthHeading eyebrow="Acesso" title="Entrar" />
      </AuthStepTransition>,
    );
    expect(html).toContain('<h1');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('aria-hidden="true"');
  });
});
