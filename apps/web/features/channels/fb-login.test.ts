/**
 * F69-S12 — o login da conexão Meta abre com a configuração do Facebook Login for Business.
 *
 * A primeira conexão real falhou na troca do código (`100/36008`): o login abria com `scope`, e o
 * app Leadium é do tipo Business, onde a Meta exige `config_id`. Este arquivo trava as duas regras:
 * `config_id` sem `scope`, e nenhum login aberto quando a configuração não está no build.
 *
 * Ambiente `node` (sem DOM): o SDK já "carregado" é simulado em `window.FB`, o caminho que o
 * módulo usa quando o script já está na página.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface LoginCall {
  readonly options: Record<string, unknown> | undefined;
}

const ENV_KEYS = ['NEXT_PUBLIC_META_APP_ID', 'NEXT_PUBLIC_META_LOGIN_CONFIG_ID', 'NEXT_PUBLIC_META_CONFIG_ID'] as const;
const original: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function instalarFb(code: string | null): LoginCall[] {
  const chamadas: LoginCall[] = [];
  const fb = {
    init: vi.fn(),
    login: (
      callback: (r: { status: string; authResponse: { code?: string } | null }) => void,
      options?: Record<string, unknown>,
    ) => {
      chamadas.push({ options });
      callback(code === null ? { status: 'unknown', authResponse: null } : { status: 'connected', authResponse: { code } });
    },
  };
  (globalThis as unknown as { window: { FB: typeof fb } }).window = { FB: fb };
  return chamadas;
}

async function carregar(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  // O App ID é lido na importação do módulo: reimporta com o ambiente deste teste.
  vi.resetModules();
  return import('./fb-login');
}

beforeEach(() => {
  for (const k of ENV_KEYS) original[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = original[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete (globalThis as { window?: unknown }).window;
});

describe('startMetaConnect', () => {
  it('abre o login com config_id e sem scope, e devolve só o code', async () => {
    const chamadas = instalarFb('codigo-de-teste');
    const { startMetaConnect } = await carregar({
      NEXT_PUBLIC_META_APP_ID: '1241342414558641',
      NEXT_PUBLIC_META_LOGIN_CONFIG_ID: 'cfg-login-123',
    });

    await expect(startMetaConnect()).resolves.toEqual({ code: 'codigo-de-teste' });
    expect(chamadas).toHaveLength(1);
    const opcoes = chamadas[0]?.options ?? {};
    expect(opcoes['config_id']).toBe('cfg-login-123');
    expect(opcoes).not.toHaveProperty('scope');
    expect(opcoes['response_type']).toBe('code');
    expect(opcoes['override_default_response_type']).toBe(true);
    // Sem `auth_type`: com ele (e com uma autorização já concedida ao app), o `code` voltava
    // atrelado a uma `redirect_uri` e a troca no servidor era recusada com 100/36008 — mesmo já
    // usando `config_id`. O exemplo da Meta para Login for Business tem só os três acima.
    expect(opcoes).not.toHaveProperty('auth_type');
    expect(Object.keys(opcoes).sort()).toEqual(['config_id', 'override_default_response_type', 'response_type']);
  });

  it('não depende da configuração do WhatsApp', async () => {
    const chamadas = instalarFb('c');
    const { startMetaConnect } = await carregar({
      NEXT_PUBLIC_META_APP_ID: '1241342414558641',
      NEXT_PUBLIC_META_LOGIN_CONFIG_ID: 'cfg-login-123',
    });
    await expect(startMetaConnect()).resolves.toEqual({ code: 'c' });
    expect(chamadas).toHaveLength(1);
  });

  it('sem a configuração de login no build, não abre o login', async () => {
    const chamadas = instalarFb('nao-deveria');
    const { startMetaConnect } = await carregar({
      NEXT_PUBLIC_META_APP_ID: '1241342414558641',
      NEXT_PUBLIC_META_CONFIG_ID: 'cfg-do-whatsapp',
    });
    await expect(startMetaConnect()).rejects.toMatchObject({ reason: 'not_configured' });
    expect(chamadas).toHaveLength(0);
  });

  it('login cancelado na Meta vira cancelled', async () => {
    instalarFb(null);
    const { startMetaConnect } = await carregar({
      NEXT_PUBLIC_META_APP_ID: '1241342414558641',
      NEXT_PUBLIC_META_LOGIN_CONFIG_ID: 'cfg-login-123',
    });
    await expect(startMetaConnect()).rejects.toMatchObject({ reason: 'cancelled' });
  });
});
