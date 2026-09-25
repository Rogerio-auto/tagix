/**
 * F70-S28 — a versão nova do service worker assume sem ficar presa em `waiting`,
 * mas nunca no meio do trabalho de alguém.
 */
import { describe, expect, it } from 'vitest';
import { canActivateWaitingWorker } from './sw-update';

describe('canActivateWaitingWorker', () => {
  it('tela pública (login) → assume já: é onde a sessão expirada deixa a pessoa', () => {
    expect(canActivateWaitingWorker({ pathname: '/login', hidden: false })).toBe(true);
    expect(canActivateWaitingWorker({ pathname: '/signup', hidden: false })).toBe(true);
  });

  it('app em segundo plano → assume (ninguém está olhando)', () => {
    expect(canActivateWaitingWorker({ pathname: '/conversations', hidden: true })).toBe(true);
  });

  it('tela protegida em uso → espera', () => {
    expect(canActivateWaitingWorker({ pathname: '/conversations', hidden: false })).toBe(false);
    expect(canActivateWaitingWorker({ pathname: '/hoje', hidden: false })).toBe(false);
  });
});
