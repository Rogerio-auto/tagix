/**
 * Global setup (F10-S03): produz o `storageState` autenticado reaproveitado por
 * todas as specs do projeto `chromium`.
 *
 * A sessão real é um cookie httpOnly `hm_session` cuja PRESENÇA o middleware do
 * Next e o `getServerSession` (stub) tratam como "logado" — não há validação de
 * JWT no shell. Então basta injetar o cookie no contexto e persistir o estado;
 * cada spec já cai autenticada, sem repetir o fluxo de login (que tem spec
 * própria em `specs/auth.spec.ts`).
 */

import { test as setup, expect } from '@playwright/test';
import { SESSION_COOKIE } from './fixtures/seed';

const AUTH_STATE = './e2e/.auth/state.json';

setup('authenticate', async ({ context, baseURL }) => {
  const origin = baseURL ?? 'http://localhost:3100';
  const { hostname } = new URL(origin);

  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: 'e2e-token',
      domain: hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  const state = await context.storageState({ path: AUTH_STATE });
  // Sanidade: o cookie de sessão entrou no estado persistido.
  expect(state.cookies.some((c) => c.name === SESSION_COOKIE)).toBe(true);
});
