/**
 * Contador de falhas de login por IP que arma o captcha progressivo (SEC-05).
 * Roda contra o Redis dev (mesmo padrão do rate-limit.test).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  LOGIN_CAPTCHA_THRESHOLD,
  closeLoginCaptcha,
  loginCaptchaRequired,
  recordLoginFailure,
} from './login-captcha';

afterAll(async () => {
  await closeLoginCaptcha();
});

// IP sintético único por execução — não colide com runs anteriores nem entre testes.
function uniqueIp(): string {
  return `test-ip-${randomUUID()}`;
}

describe('login-captcha (SEC-05)', () => {
  it('IP sem falhas → captcha não exigido', async () => {
    await expect(loginCaptchaRequired(uniqueIp())).resolves.toBe(false);
  });

  it('abaixo do limiar → não exige; ao cruzar o limiar → exige', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < LOGIN_CAPTCHA_THRESHOLD - 1; i += 1) {
      await recordLoginFailure(ip);
    }
    await expect(loginCaptchaRequired(ip)).resolves.toBe(false);

    await recordLoginFailure(ip); // N-ésima falha arma o gate
    await expect(loginCaptchaRequired(ip)).resolves.toBe(true);
  });

  it('IPs diferentes têm contadores independentes', async () => {
    const hot = uniqueIp();
    const cold = uniqueIp();
    for (let i = 0; i < LOGIN_CAPTCHA_THRESHOLD; i += 1) {
      await recordLoginFailure(hot);
    }
    await expect(loginCaptchaRequired(hot)).resolves.toBe(true);
    await expect(loginCaptchaRequired(cold)).resolves.toBe(false);
  });
});
