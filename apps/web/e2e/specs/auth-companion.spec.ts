/**
 * F76-S13 — QA do companheiro das telas de acesso (ADR-006 §9; SPEC auth-companion).
 *
 * O que este spec prova (a rede é 100% mockada; nenhum serviço real):
 *
 * 1. MATRIZ: cada tela de acesso (login, cadastro, cadastro enviado, verificação
 *    pendente/ok/inválida, redefinição pedido/enviado/nova/feita, convite) em 375/768/1440
 *    × claro/escuro × movimento normal/reduzido: pose esperada do personagem, figura e
 *    balão dentro da viewport, sem rolagem horizontal, axe sem violação séria, contraste do
 *    balão ≥ 4,5:1 e captura em `e2e/.artifacts/f76-s13/`.
 * 2. QUADROS-CHAVE (desktop): chegada com balão, `perch` (voo + posição), `avert`,
 *    `thinking` (só depois de 300 ms), `confused` (401 mockado), sucesso em tempos.
 * 3. PRIVACIDADE: digita e-mail e senha de teste; o palco, os `data-*`, o storage e a rede
 *    não os contêm; o módulo não escuta teclado; nenhuma requisição extra.
 * 4. CELULAR: sem voo, caixa 40x40 reservada, balão some com o teclado aberto.
 * 5. CONVITE: âncora `heading` no cabeçalho do convite (F76-S14, A4); o personagem aparece,
 *    fica na linha do eyebrow "Convite" e celebra no sucesso.
 * 6. F76-S14 (correções do QA): A1 balão acima da figura sem cobrir eyebrow/logotipo/texto;
 *    A2 `perch` dentro da faixa em fluxo do painel, nunca sobre o texto editorial, em
 *    1024/1280/1440/1920 × campos de login/cadastro/redefinição; A3 alinhamento estável.
 *
 * AMBIENTE: servidor de produção (`E2E_SERVER=start`) é o que importa; em `dev` o chunk lazy
 * compila sob demanda e os tempos mudam. Rodar com `--workers=1` (ver `mobile-nav.spec.ts`).
 */

import type { Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { waitForHydration } from '../pages/pom';
import {
  capture,
  expectNoSeriousAxe,
  minTextContrast,
  useTheme,
  type Theme,
} from '../fixtures/a11y';

const SHOTS = 'e2e/.artifacts/f76-s14';

test.use({ storageState: { cookies: [], origins: [] } });
// Contexto do NAVEGADOR de teste (não é formatação no componente).
// eslint-disable-next-line no-restricted-syntax
test.use({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });

/* ----------------------------------------------------------------------------------- */
/* Sonda no navegador: animações, estados, chamadas de rede e visualViewport falso.     */
/* ----------------------------------------------------------------------------------- */

interface AnimateRecord {
  layer: string | null;
  cls: string | null;
  duration: number;
  props: string[];
}
interface StateRecord {
  state: string;
  at: number;
}
interface CallRecord {
  kind: string;
  url: string;
  body: string;
}
interface Probe {
  animations: AnimateRecord[];
  states: StateRecord[];
  submits: number[];
  calls: CallRecord[];
}

async function installProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: Probe = { animations: [], states: [], submits: [], calls: [] };
    (window as unknown as { __probe: Probe }).__probe = probe;

    // Toda animação WAAPI criada dentro do palco do companheiro.
    const original = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ): Animation {
      try {
        if (this.closest('[data-companion-stage]')) {
          const props = new Set<string>();
          if (Array.isArray(keyframes)) {
            for (const frame of keyframes) {
              for (const key of Object.keys(frame)) {
                if (key !== 'offset' && key !== 'easing' && key !== 'composite') props.add(key);
              }
            }
          } else if (keyframes) {
            for (const key of Object.keys(keyframes)) props.add(key);
          }
          probe.animations.push({
            layer: this.getAttribute('data-layer'),
            cls: this.getAttribute('class'),
            duration: typeof options === 'number' ? options : Number(options?.duration ?? 0),
            props: [...props],
          });
        }
      } catch {
        /* a sonda nunca pode quebrar a página */
      }
      return original.call(this, keyframes, options);
    };

    // Histórico de `data-state` do personagem.
    const log = (el: Element): void => {
      const state = el.getAttribute('data-state');
      if (state) probe.states.push({ state, at: performance.now() });
    };
    const scan = (node: Node): void => {
      if (!(node instanceof Element)) return;
      if (node.hasAttribute('data-companion')) log(node);
      node.querySelectorAll('[data-companion]').forEach(log);
    };
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') scan(m.target);
        else m.addedNodes.forEach(scan);
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });

    document.addEventListener('submit', () => probe.submits.push(performance.now()), true);

    // Toda saída de dados feita pelo JS da página.
    const text = (body: unknown): string => {
      try {
        if (typeof body === 'string') return body;
        if (body instanceof URLSearchParams) return body.toString();
        if (body === null || body === undefined) return '';
        return Object.prototype.toString.call(body);
      } catch {
        return '';
      }
    };
    const realFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      probe.calls.push({
        kind: 'fetch',
        url: input instanceof Request ? input.url : String(input),
        body: text(init?.body),
      });
      return realFetch.call(window, input, init);
    };
    const realOpen = XMLHttpRequest.prototype.open;
    const realSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest & { __url?: string },
      method: string,
      url: string | URL,
      ...rest: [boolean?, (string | null)?, (string | null)?]
    ): void {
      this.__url = String(url);
      realOpen.call(this, method, url, rest[0] ?? true, rest[1], rest[2]);
    };
    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest & { __url?: string },
      body?: Document | XMLHttpRequestBodyInit | null,
    ): void {
      probe.calls.push({ kind: 'xhr', url: this.__url ?? '', body: text(body) });
      realSend.call(this, body);
    };
    const realBeacon = navigator.sendBeacon?.bind(navigator);
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null): boolean => {
      probe.calls.push({ kind: 'beacon', url: String(url), body: text(data) });
      return realBeacon ? realBeacon(url, data) : false;
    };

    // `visualViewport` falso: o teste controla a altura (teclado virtual).
    const vv = new EventTarget() as EventTarget & { height: number; width: number };
    Object.defineProperty(vv, 'height', {
      get: () => (window as unknown as { __vvHeight?: number }).__vvHeight ?? window.innerHeight,
    });
    Object.defineProperty(vv, 'width', { get: () => window.innerWidth });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  });
}

async function probeOf(page: Page): Promise<Probe> {
  return page.evaluate(() => (window as unknown as { __probe: Probe }).__probe);
}

/** Simula o teclado virtual: encolhe `visualViewport.height` e avisa. */
async function setKeyboard(page: Page, open: boolean): Promise<void> {
  await page.evaluate((isOpen) => {
    const w = window as unknown as { __vvHeight?: number; visualViewport: EventTarget };
    w.__vvHeight = isOpen ? Math.round(window.innerHeight * 0.45) : undefined;
    w.visualViewport.dispatchEvent(new Event('resize'));
  }, open);
}

/* ----------------------------------------------------------------------------------- */
/* Rede mockada                                                                         */
/* ----------------------------------------------------------------------------------- */

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const TOKEN = 'tok_abc123XYZ';
const PROOF_HASH = 'pkce_abcdef123456';
const PREVIEW = {
  workspaceName: 'Clínica Aurora',
  inviterName: 'Ana Souza',
  role: 'AGENT',
  emailMasked: 'b***@aurora.test',
  requiresEmailProof: true,
  expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
};

interface Gate {
  promise: Promise<void>;
  release: () => void;
}
function gate(): Gate {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface Scenario {
  /** `POST /auth/verify`: aceito, recusado (400) ou segurado até o `release`. */
  verify?: 'ok' | 'expired' | Gate;
  /** `POST /auth/login` devolve 401. */
  badLogin?: boolean;
  /** Atraso (ms) das respostas de login, cadastro e redefinição. */
  delayMs?: number;
  /** Preview do convite; `null` = 404. */
  invite?: object | null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Rotas deste spec (precedem o roteador genérico da fixture). */
async function installRoutes(page: Page, scenario: Scenario = {}): Promise<void> {
  await page.route('**/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const pause = scenario.delayMs ?? 0;
    if (path === '/auth/verify') {
      if (typeof scenario.verify === 'object') await scenario.verify.promise;
      return scenario.verify === 'expired'
        ? json(route, { message: 'Link inválido ou expirado.' }, 400)
        : json(route, { ok: true });
    }
    if (path === '/auth/login') {
      if (pause > 0) await sleep(pause);
      return scenario.badLogin
        ? json(route, { message: 'Credenciais inválidas' }, 401)
        : json(route, { ok: true });
    }
    if (path === '/auth/signup') {
      if (pause > 0) await sleep(pause);
      return json(route, { status: 'verification_sent' }, 202);
    }
    if (path === '/auth/reset' || path === '/auth/reset/confirm') {
      if (pause > 0) await sleep(pause);
      return json(route, { ok: true });
    }
    if (path === '/auth/invite/preview' && scenario.invite !== undefined) {
      return scenario.invite
        ? json(route, scenario.invite)
        : json(route, { error: 'invite_not_found', message: 'Convite não encontrado.' }, 404);
    }
    if (path === '/auth/invite/accept') {
      if (pause > 0) await sleep(pause);
      return json(route, { next: '/login?email=bia%40aurora.test' });
    }
    if (path === '/auth/invite/send-email') {
      return json(route, { ok: true, emailMasked: 'b***@aurora.test' });
    }
    return route.fallback();
  });
  if (scenario.invite !== undefined) {
    await page.route('**/api/me', (route) => json(route, { error: 'session_invalid' }, 401));
  }
}

/* ----------------------------------------------------------------------------------- */
/* Esperas e leituras do personagem                                                     */
/* ----------------------------------------------------------------------------------- */

const h1 = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 1, name, exact: true });
const figure = (page: Page): Locator => page.locator('[data-companion]');
const actor = (page: Page): Locator => page.locator('[data-companion-actor]');
const bubbleBox = (page: Page): Locator =>
  page.locator('[data-companion-bubble] .m-bubble[data-open="true"]');

async function hydrated(page: Page, button: string): Promise<void> {
  await waitForHydration(page.getByRole('button', { name: button, exact: true }));
}

/** Só a figura posicionada e a entrada concluída (a respiração de 4,2 s não conta). */
async function companionReady(page: Page): Promise<void> {
  await expect(page.locator('[data-companion-actor][data-placed="true"]')).toHaveCount(1, {
    timeout: 15_000,
  });
  await settled(page);
}

/**
 * Espera as animações curtas terminarem. A respiração (4,2 s, até 3 ciclos) e animações
 * infinitas (`thinking`, spinner) ficam de fora: são o estado estável, não uma transição.
 */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      if (a.playState !== 'running') return true;
      const timing = a.effect?.getTiming();
      if (!timing) return true;
      return timing.iterations === Infinity || Number(timing.duration ?? 0) >= 4000;
    }),
  );
  await page.waitForTimeout(80);
}

interface Pose {
  state: string;
  eyes?: string;
  tip?: string;
}
async function expectPose(page: Page, pose: Pose, label: string): Promise<void> {
  await expect(figure(page), label).toHaveAttribute('data-state', pose.state);
  if (pose.eyes) {
    await expect(figure(page).locator('svg[data-rig]'), `${label} olhos`).toHaveAttribute(
      'data-eyes',
      pose.eyes,
    );
  }
  if (pose.tip) {
    await expect(figure(page).locator('svg[data-rig]'), `${label} ponta`).toHaveAttribute(
      'data-tip',
      pose.tip,
    );
  }
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
async function boxOf(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('elemento sem caixa (não renderizado)');
  return b;
}

function rectsIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Espera a caixa parar (duas leituras iguais com 200 ms de intervalo). */
async function stable(locator: Locator): Promise<void> {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await boxOf(locator));
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [200] },
    )
    .toBe(true);
}

/** Foco programático (sem input do usuário): o motor escuta `focusin`. */
async function focusField(page: Page, label: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).focus();
}

/** Recorte ao redor da figura e do balão para inspeção humana. */
async function detail(page: Page, name: string): Promise<void> {
  const a = await actor(page).boundingBox();
  const viewport = page.viewportSize();
  if (!a || !viewport) return;
  const x = Math.max(0, a.x - 260);
  const y = Math.max(0, a.y - 30);
  const width = Math.min(viewport.width - x, a.width + 260 + 60);
  const height = Math.min(viewport.height - y, a.height + 150);
  await page.screenshot({
    path: `${SHOTS}/${name}.png`,
    clip: { x, y, width, height },
    animations: 'disabled',
  });
}

/** Retângulos do texto visível do formulário que o balão cobre (deve ser nenhum). */
async function textUnderBubble(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bubble = document.querySelector('[data-companion-bubble] .m-bubble');
    if (!bubble) return ['(sem balão)'];
    const b = bubble.getBoundingClientRect();
    const hits: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      const text = (n.textContent ?? '').trim();
      if (
        !el ||
        !text ||
        el.closest('[data-companion-stage]') ||
        el.closest('[aria-hidden="true"]')
      )
        continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width === 0 || r.height === 0) continue;
        const overlap =
          r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
        if (overlap)
          hits.push(
            `"${text.slice(0, 30)}" ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
          );
      }
    }
    return hits;
  });
}

/* ----------------------------------------------------------------------------------- */
/* Fluxos de preenchimento                                                              */
/* ----------------------------------------------------------------------------------- */

async function fillSignup(page: Page): Promise<void> {
  await page.getByLabel('Seu nome').fill('Ana Souza');
  await page.getByLabel('Email').fill('ana@aurora.test');
  await page.getByLabel('Nome do workspace').fill('Clínica Aurora');
  await page.getByLabel('Senha').fill('senha-forte-123');
  await page.getByRole('checkbox', { name: /Li e aceito/ }).check();
}

/* ----------------------------------------------------------------------------------- */
/* 1. MATRIZ                                                                            */
/* ----------------------------------------------------------------------------------- */

interface Screen {
  name: string;
  path: string;
  scenario?: () => Scenario;
  ready: (page: Page) => Promise<void>;
  open?: (page: Page) => Promise<void>;
  /** Pose esperada depois que tudo assentou. */
  pose: Pose;
  /** Texto do balão esperado (1ª visita da sessão). */
  bubble?: string;
}

const IDLE: Pose = { state: 'idle', eyes: 'open', tip: 'off' };
const SUCCESS: Pose = { state: 'celebrate', eyes: 'happy', tip: 'lit' };

const SCREENS: Screen[] = [
  {
    name: 'login',
    path: '/login',
    ready: async (page) => {
      await expect(h1(page, 'Entrar')).toBeVisible();
      await hydrated(page, 'Entrar');
    },
    pose: IDLE,
    bubble: 'Que bom que voltou.',
  },
  {
    name: 'signup',
    path: '/signup',
    ready: async (page) => {
      await expect(h1(page, 'Criar conta')).toBeVisible();
      await hydrated(page, 'Criar conta');
    },
    pose: IDLE,
    bubble: 'Leva poucos minutos.',
  },
  {
    name: 'signup-sent',
    path: '/signup',
    ready: async (page) => {
      await expect(h1(page, 'Criar conta')).toBeVisible();
      await hydrated(page, 'Criar conta');
    },
    open: async (page) => {
      await fillSignup(page);
      await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
      await expect(h1(page, 'Verifique seu email')).toBeVisible();
    },
    pose: SUCCESS,
    bubble: 'O link está no seu email.',
  },
  {
    name: 'verify-pending',
    path: '/verify?token=tok_pendente',
    scenario: () => ({ verify: gate() }),
    ready: async (page) => {
      await expect(h1(page, 'Confirmando seu email')).toBeVisible();
    },
    pose: { state: 'thinking', tip: 'lit' },
  },
  {
    name: 'verify-ok',
    path: '/verify?token=tok_ok',
    scenario: () => ({ verify: 'ok' }),
    ready: async (page) => {
      await expect(h1(page, 'Email confirmado')).toBeVisible();
    },
    pose: SUCCESS,
  },
  {
    name: 'verify-invalid',
    path: '/verify?token=tok_velho',
    scenario: () => ({ verify: 'expired' }),
    ready: async (page) => {
      await expect(h1(page, 'Link inválido ou expirado')).toBeVisible();
    },
    pose: { state: 'confused', eyes: 'squint', tip: 'warn' },
  },
  {
    name: 'reset-request',
    path: '/reset-password',
    ready: async (page) => {
      await expect(h1(page, 'Redefinir senha')).toBeVisible();
      await hydrated(page, 'Enviar instruções');
    },
    pose: IDLE,
  },
  {
    name: 'reset-sent',
    path: '/reset-password',
    ready: async (page) => {
      await expect(h1(page, 'Redefinir senha')).toBeVisible();
      await hydrated(page, 'Enviar instruções');
    },
    open: async (page) => {
      await page.getByLabel('Email').fill('ana@aurora.test');
      await page.getByRole('button', { name: 'Enviar instruções' }).click();
      await expect(h1(page, 'Confira sua caixa de entrada')).toBeVisible();
    },
    pose: SUCCESS,
    bubble: 'O link já está a caminho.',
  },
  {
    name: 'reset-new',
    path: '/reset-password?token=tok_reset',
    ready: async (page) => {
      await expect(h1(page, 'Definir nova senha')).toBeVisible();
      await expect(page.getByLabel('Confirme a nova senha')).toBeVisible();
    },
    pose: IDLE,
  },
  {
    name: 'reset-done',
    path: '/reset-password?token=tok_reset',
    ready: async (page) => {
      await expect(h1(page, 'Definir nova senha')).toBeVisible();
      await hydrated(page, 'Redefinir senha');
    },
    open: async (page) => {
      await page.getByLabel('Nova senha', { exact: true }).fill('senha-forte-123456');
      await page.getByLabel('Confirme a nova senha').fill('senha-forte-123456');
      await page.getByRole('button', { name: 'Redefinir senha', exact: true }).click();
      await expect(h1(page, 'Senha redefinida')).toBeVisible();
    },
    pose: SUCCESS,
  },
  {
    name: 'invite',
    path: `/convite/${TOKEN}#token_hash=${PROOF_HASH}&type=invite`,
    scenario: () => ({ invite: PREVIEW }),
    ready: async (page) => {
      await expect(h1(page, 'Clínica Aurora')).toBeVisible();
      await expect(page.getByLabel('Crie uma senha')).toBeVisible();
    },
    // O cabeçalho do convite registra a âncora `heading` (F76-S14, A4): mesma pose do login.
    pose: IDLE,
  },
];

const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;
const MOTIONS = ['normal', 'reduzido'] as const;

for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
  for (const size of SIZES) {
    for (const motion of MOTIONS) {
      test.describe(`Companheiro — ${size.width} ${theme} movimento ${motion}`, () => {
        test.use({ viewport: { width: size.width, height: size.height } });

        for (const screen of SCREENS) {
          test(`${screen.name}: pose, geometria, axe, contraste do balão e captura`, async ({
            page,
          }) => {
            test.setTimeout(75_000);
            await installProbe(page);
            await page.emulateMedia({
              reducedMotion: motion === 'reduzido' ? 'reduce' : 'no-preference',
            });
            await useTheme(page, theme);
            const scenario = screen.scenario?.() ?? {};
            await installRoutes(page, scenario);
            await page.goto(screen.path);
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            await screen.ready(page);
            await screen.open?.(page);

            const label = `${screen.name} ${size.width} ${theme} ${motion}`;
            await companionReady(page);
            await expect(figure(page)).toHaveAttribute(
              'data-motion',
              motion === 'reduzido' ? 'off' : 'live',
            );
            await expectPose(page, screen.pose, label);
            if (screen.bubble) {
              await expect(bubbleBox(page), `${label}: balão`).toHaveText(screen.bubble, {
                timeout: 10_000,
              });
              await settled(page);
            }

            // Geometria: nada do palco vaza da viewport nem gera rolagem horizontal.
            const overflow = await page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            expect(overflow, `${label}: rolagem horizontal`).toBeLessThanOrEqual(0);
            {
              const fig = await boxOf(actor(page));
              expect(fig.x, `${label}: figura à esquerda da viewport`).toBeGreaterThanOrEqual(0);
              expect(fig.x + fig.width, `${label}: figura além da viewport`).toBeLessThanOrEqual(
                size.width,
              );
              await expect(actor(page), `${label}: figura visível`).toHaveCSS(
                'visibility',
                'visible',
              );
              // Em pé na linha do eyebrow / na linha do logotipo: nunca encosta no título.
              const title = await boxOf(page.getByRole('heading', { level: 1 }));
              expect(fig.y + fig.height, `${label}: figura sobre o H1`).toBeLessThanOrEqual(
                title.y + 1,
              );
              if (size.width >= 1024) {
                // Em pé na linha do eyebrow: a base da figura = base do eyebrow + 2,5 px de
                // sombra. A medida remedida quando as animações dos ancestrais terminam (A3)
                // zera o erro do `translateY` de 4 px da troca de etapa: folga de 3 px.
                const eyebrow = await boxOf(page.locator('main header p').first());
                expect(
                  Math.abs(fig.y + fig.height - (eyebrow.y + eyebrow.height)),
                  `${label}: figura fora da linha do eyebrow`,
                ).toBeLessThanOrEqual(3);
              }
              if (screen.bubble) {
                const b = await boxOf(page.locator('[data-companion-bubble] .m-bubble'));
                expect(b.x, `${label}: balão cortado à esquerda`).toBeGreaterThanOrEqual(0);
                expect(b.y, `${label}: balão cortado em cima`).toBeGreaterThanOrEqual(0);
                expect(b.x + b.width, `${label}: balão cortado à direita`).toBeLessThanOrEqual(
                  size.width,
                );
                // A1: vale também para `reset-sent` no desktop (balão acima da figura).
                expect(await textUnderBubble(page), `${label}: balão cobre texto`).toEqual([]);
              }
            }

            // Eixo A11y: axe nos dois temas (a matriz cobre claro e escuro) e contraste do balão.
            await expectNoSeriousAxe(page, { label });
            if (screen.bubble) {
              const report = await minTextContrast(page, '[data-companion-bubble]');
              expect(report.worst.length, `${label}: balão sem texto medido`).toBeGreaterThan(0);
              expect(
                report.min,
                `${label}: contraste do balão ${JSON.stringify(report.worst)}`,
              ).toBeGreaterThanOrEqual(4.5);
            }
            if (screen.name === 'verify-pending') {
              // A requisição fica segura de propósito: `networkidle` do `capture` nunca chega.
              await page.screenshot({
                path: `${SHOTS}/${screen.name}-${motion}-${size.width}-${theme}.png`,
                animations: 'disabled',
              });
              if (typeof scenario.verify === 'object') scenario.verify.release();
            } else {
              await capture(page, SHOTS, `${screen.name}-${motion}`, theme, { full: false });
            }
          });
        }
      });
    }
  }
}

/* ----------------------------------------------------------------------------------- */
/* 2. QUADROS-CHAVE (desktop)                                                           */
/* ----------------------------------------------------------------------------------- */

for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
  test.describe(`Companheiro — quadros-chave 1440 ${theme}`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('chegada: em pé no título, olhar neutro, saudação uma vez por sessão', async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await installProbe(page);
      await useTheme(page, theme);
      await installRoutes(page);
      await page.goto('/login');
      await hydrated(page, 'Entrar');
      await companionReady(page);

      await expect(actor(page)).toHaveAttribute('data-station', 'heading');
      await expectPose(page, IDLE, 'chegada');
      await expect(figure(page)).toHaveAttribute('data-look', 'none');
      await expect(figure(page)).toHaveAttribute('data-size', '48');
      await expect(bubbleBox(page)).toHaveText('Que bom que voltou.', { timeout: 10_000 });
      await settled(page);

      // Balão ACIMA da figura, alinhado à direita dela, rabicho para baixo (SPEC §2.4, A1).
      const fig = await boxOf(figure(page));
      const bubble = await boxOf(page.locator('[data-companion-bubble] .m-bubble'));
      expect(bubble.y + bubble.height, 'balão acima da figura').toBeLessThanOrEqual(fig.y + 1);
      expect(
        Math.abs(bubble.x + bubble.width - (fig.x + fig.width)),
        'balão alinhado à direita da figura',
      ).toBeLessThanOrEqual(2);
      // Em pé na linha do eyebrow: a base da figura cai na base do eyebrow (±3 px da sombra).
      const eyebrow = await boxOf(page.locator('main header p').first());
      expect(Math.abs(fig.y + fig.height - (eyebrow.y + eyebrow.height))).toBeLessThanOrEqual(3);
      // O balão não toca o eyebrow nem o logotipo, e fica na coluna de 25rem.
      expect(rectsIntersect(bubble, eyebrow), 'balão sobre o eyebrow').toBe(false);
      const logo = await boxOf(page.getByText('Leadium', { exact: true }).first());
      expect(rectsIntersect(bubble, logo), 'balão sobre o logotipo').toBe(false);
      expect(await textUnderBubble(page), 'balão cobre texto').toEqual([]);
      // A 24 px da borda direita da coluna de 25rem.
      const header = await boxOf(page.locator('main header').first());
      expect(Math.abs(fig.x + fig.width / 2 - (header.x + header.width - 24))).toBeLessThanOrEqual(
        2,
      );

      await detail(page, `chave-chegada-balao-${theme}`);
      await capture(page, SHOTS, 'chave-chegada', theme, { full: false });

      // Uma vez por sessão: recarregar não saúda de novo.
      await page.reload();
      await hydrated(page, 'Entrar');
      await companionReady(page);
      await page.waitForTimeout(1_500);
      await expect(page.locator('[data-companion-bubble]')).toHaveCount(0);
    });

    test('perch: o 1º foco leva o personagem ao painel, olhando para o formulário', async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await installProbe(page);
      await useTheme(page, theme);
      await installRoutes(page);
      await page.goto('/login');
      await hydrated(page, 'Entrar');
      await companionReady(page);

      await focusField(page, 'Email');
      await expect(actor(page)).toHaveAttribute('data-station', 'perch');
      await expect(figure(page)).toHaveAttribute('data-look', 'left');
      // Voo concluído: caixa estável e animações curtas assentadas.
      await settled(page);
      await stable(actor(page));

      // A2: o perch é a faixa em fluxo do painel; a caixa da figura fica DENTRO dela, no início
      // do texto do painel, e o y acompanha o campo limitado à faixa.
      const strip = await boxOf(page.locator('[data-companion-anchor="perch"]'));
      const field = await boxOf(page.getByLabel('Email', { exact: true }));
      const fig = await boxOf(actor(page));
      expect(strip.height, 'faixa do perch reserva ≥ 56 px').toBeGreaterThanOrEqual(56);
      expect(Math.abs(fig.x - strip.x), 'perch: x = início da faixa').toBeLessThanOrEqual(1);
      expect(fig.y, 'perch: acima da faixa').toBeGreaterThanOrEqual(strip.y - 1);
      expect(fig.y + fig.height, 'perch: abaixo da faixa').toBeLessThanOrEqual(
        strip.y + strip.height + 1,
      );
      const expectedY = Math.min(
        Math.max(field.y + field.height / 2 - fig.height / 2, strip.y),
        strip.y + strip.height - fig.height,
      );
      expect(
        Math.abs(fig.y - expectedY),
        'perch: y = centro do campo (limitado à faixa)',
      ).toBeLessThanOrEqual(2);
      expect(await editorialTextUnderActor(page), 'perch: texto do painel sob a figura').toEqual(
        [],
      );
      // No perch o balão nunca existe.
      await expect(page.locator('[data-companion-bubble]')).toHaveCount(0);

      // O voo: dois trilhos (x e y) de 560–760 ms.
      const flights = (await probeOf(page)).animations.filter((a) => a.cls === 'm-layer');
      expect(flights.length, 'voo: trilhos x e y').toBeGreaterThanOrEqual(2);
      for (const f of flights.slice(0, 2)) {
        expect(f.duration).toBeGreaterThanOrEqual(560);
        expect(f.duration).toBeLessThanOrEqual(760);
        expect(
          f.props.every((p) => p === 'transform' || p === 'translate' || p === 'opacity'),
        ).toBe(true);
      }

      await detail(page, `chave-perch-${theme}`);
      await capture(page, SHOTS, 'chave-perch', theme, { full: false });

      // Voltar ao 1º campo depois de passar pelo 2º não faz outro voo (só deslize).
      await focusField(page, 'Senha');
      await settled(page);
      const flightsAfter = (await probeOf(page)).animations.filter(
        (a) => a.cls === 'm-layer' && a.duration >= 560,
      );
      expect(flightsAfter.length, 'sem 2º voo ao trocar de campo').toBe(flights.length);
    });

    test('avert: foco em senha fecha os olhos e vira a cabeça; sair devolve o olhar', async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await installProbe(page);
      await useTheme(page, theme);
      await installRoutes(page);
      await page.goto('/login');
      await hydrated(page, 'Entrar');
      await companionReady(page);

      await focusField(page, 'Senha');
      await expectPose(page, { state: 'avert', eyes: 'closed', tip: 'off' }, 'avert');
      await expect(figure(page)).toHaveAttribute('data-look', 'right');
      await settled(page);
      await detail(page, `chave-avert-${theme}`);
      await capture(page, SHOTS, 'chave-avert', theme, { full: false });

      await focusField(page, 'Email');
      await expectPose(page, { state: 'idle', eyes: 'open' }, 'avert saiu');
      await expect(figure(page)).toHaveAttribute('data-look', 'left');
    });

    test('thinking só depois de 300 ms; confused no 401 e segura até o próximo foco', async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await installProbe(page);
      await useTheme(page, theme);
      await installRoutes(page, { badLogin: true, delayMs: 1_400 });
      await page.goto('/login');
      await hydrated(page, 'Entrar');
      await companionReady(page);

      await page.getByLabel('Email').fill('ana@aurora.test');
      await page.getByLabel('Senha').fill('senha-errada-123');
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();

      await expect(figure(page)).toHaveAttribute('data-state', 'thinking', { timeout: 3_000 });
      await expectPose(page, { state: 'thinking', tip: 'lit' }, 'thinking');
      const probe = await probeOf(page);
      const thinkingAt = probe.states.find((s) => s.state === 'thinking')?.at ?? 0;
      const submitAt = probe.submits[probe.submits.length - 1] ?? 0;
      expect(thinkingAt - submitAt, 'thinking nunca antes de 300 ms').toBeGreaterThanOrEqual(290);
      await page.waitForTimeout(150);
      await detail(page, `chave-thinking-${theme}`);
      await capture(page, SHOTS, 'chave-thinking', theme, { full: false });

      // Resposta 401: sai de thinking na hora e vira confused (olho assimétrico, ponta de alerta).
      await expect(figure(page)).toHaveAttribute('data-state', 'confused', { timeout: 5_000 });
      await expect(
        page.getByRole('main').getByRole('alert').getByText('Email ou senha incorretos'),
      ).toBeVisible();
      await expectPose(page, { state: 'confused', eyes: 'squint', tip: 'warn' }, 'confused');
      await settled(page);
      await detail(page, `chave-confused-${theme}`);
      await capture(page, SHOTS, 'chave-confused', theme, { full: false });

      // Fica até o próximo foco (900 ms de animação NÃO é o tempo de vida do estado).
      await page.waitForTimeout(1_800);
      await expect(figure(page)).toHaveAttribute('data-state', 'confused');
      await focusField(page, 'Email');
      await expect(figure(page)).toHaveAttribute('data-state', 'idle');
    });

    test('sucesso em tempos: ação (thinking) → prova → mensagem → celebração → balão', async ({
      page,
    }) => {
      test.setTimeout(75_000);
      await installProbe(page);
      await useTheme(page, theme);
      await installRoutes(page, { delayMs: 900 });
      await page.goto('/signup');
      await hydrated(page, 'Criar conta');
      await companionReady(page);

      await fillSignup(page);
      await page.getByRole('button', { name: 'Criar conta', exact: true }).click();

      // 1. Ação: o indicador do botão é sempre; o personagem pensa depois de 300 ms.
      await expect(figure(page)).toHaveAttribute('data-state', 'thinking', { timeout: 3_000 });
      await capture(page, SHOTS, 'chave-sucesso-1-acao', theme, { full: false });

      // 2-3. Resposta → mensagem nova (H1 com foco) e celebração.
      await expect(h1(page, 'Verifique seu email')).toBeVisible({ timeout: 5_000 });
      await expect(h1(page, 'Verifique seu email')).toBeFocused();
      await expect(figure(page)).toHaveAttribute('data-state', 'celebrate', { timeout: 5_000 });
      await capture(page, SHOTS, 'chave-sucesso-2-mensagem', theme, { full: false });

      // 4. Pose final: olhos felizes e ponta acesa; a celebração nunca termina sozinha.
      await expect(actor(page)).toHaveAttribute('data-station', 'heading');
      await settled(page);
      await expectPose(page, SUCCESS, 'sucesso final');
      // 5. Balão contextual, depois da celebração.
      await expect(bubbleBox(page)).toHaveText('O link está no seu email.', { timeout: 6_000 });
      await settled(page);
      await detail(page, `chave-sucesso-3-final-balao-${theme}`);
      await capture(page, SHOTS, 'chave-sucesso-3-final', theme, { full: false });
      await page.waitForTimeout(2_000);
      await expectPose(page, SUCCESS, 'sucesso final segura');

      const states = (await probeOf(page)).states.map((s) => s.state);
      const order = states.filter((s, i) => s !== states[i - 1]);
      expect(order, `ordem de estados: ${order.join(' > ')}`).toEqual(
        expect.arrayContaining(['thinking', 'celebrate']),
      );
      expect(order.indexOf('thinking')).toBeLessThan(order.indexOf('celebrate'));
    });

    test('cadastro com foco em campo: sucesso faz o voo de volta ao título (perch → heading)', async ({
      page,
    }) => {
      test.setTimeout(75_000);
      await installProbe(page);
      await useTheme(page, theme);
      await installRoutes(page, { delayMs: 300 });
      await page.goto('/signup');
      await hydrated(page, 'Criar conta');
      await companionReady(page);

      await focusField(page, 'Seu nome');
      await expect(actor(page)).toHaveAttribute('data-station', 'perch');
      await settled(page);
      const before = (await probeOf(page)).animations.filter(
        (a) => a.cls === 'm-layer' && a.duration >= 560,
      ).length;
      await fillSignup(page);
      await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
      await expect(h1(page, 'Verifique seu email')).toBeVisible({ timeout: 5_000 });
      await expect(actor(page)).toHaveAttribute('data-station', 'heading', { timeout: 5_000 });
      await settled(page);
      const after = (await probeOf(page)).animations.filter(
        (a) => a.cls === 'm-layer' && a.duration >= 560,
      ).length;
      expect(after - before, 'voo de volta ao título (x e y)').toBeGreaterThanOrEqual(2);
      await expect(figure(page)).toHaveAttribute('data-state', 'celebrate');
    });
  });
}

/*
 * A1 (F76-S14): no desktop o balão do `reset-sent` ("O link já está a caminho.") ficava à
 * esquerda da figura e cobria a base do eyebrow "RECUPERAÇÃO DE ACESSO". Agora ele vai ACIMA
 * da figura (`placement='top'`): não toca o eyebrow, o logotipo nem texto algum, e fica na
 * coluna do formulário.
 */
for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
  test.describe(`Companheiro — balão x eyebrow 1440 ${theme}`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('reset-sent: o balão não cobre o texto do eyebrow', async ({ page }) => {
      test.setTimeout(60_000);
      await installProbe(page);
      await useTheme(page, theme);
      await installRoutes(page);
      await page.goto('/reset-password');
      await hydrated(page, 'Enviar instruções');
      await companionReady(page);
      await page.getByLabel('Email').fill('ana@aurora.test');
      await page.getByRole('button', { name: 'Enviar instruções' }).click();
      await expect(h1(page, 'Confira sua caixa de entrada')).toBeVisible();
      await expect(bubbleBox(page)).toHaveText('O link já está a caminho.', { timeout: 10_000 });
      await settled(page);
      await detail(page, `achado-A1-balao-acima-do-eyebrow-${theme}`);

      const bubble = await boxOf(page.locator('[data-companion-bubble] .m-bubble'));
      const fig = await boxOf(figure(page));
      const eyebrow = await boxOf(page.locator('main header p').first());
      const column = await boxOf(page.locator('main header').first());
      expect(await textUnderBubble(page), 'balão cobre texto').toEqual([]);
      expect(rectsIntersect(bubble, eyebrow), 'balão sobre o eyebrow').toBe(false);
      expect(bubble.y + bubble.height, 'balão acima da figura').toBeLessThanOrEqual(fig.y + 1);
      expect(bubble.x, 'balão dentro da coluna (esquerda)').toBeGreaterThanOrEqual(column.x);
      expect(bubble.x + bubble.width, 'balão dentro da coluna (direita)').toBeLessThanOrEqual(
        column.x + column.width + 1,
      );
      expect(bubble.y, 'balão dentro da viewport').toBeGreaterThanOrEqual(0);
      const logo = await boxOf(page.getByText('Leadium', { exact: true }).first());
      expect(rectsIntersect(bubble, logo), 'balão sobre o logotipo').toBe(false);
    });
  });
}

/**
 * Texto do painel editorial que a caixa da figura cobre. O `perch` é uma faixa em fluxo
 * (F76-S14), então o resultado esperado é sempre vazio.
 */
async function editorialTextUnderActor(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const panel = document.querySelector('aside[aria-label="Sobre a Leadium"]');
    const a = document.querySelector('[data-companion-actor]')?.getBoundingClientRect();
    if (!panel || !a) return ['(sem painel ou figura)'];
    const hits: string[] = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      if (!text) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        if (r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top) {
          hits.push(`"${text.slice(0, 22)}" em ${Math.round(r.left)},${Math.round(r.top)}`);
        }
      }
    }
    return hits;
  });
}

/*
 * A2 (F76-S14): o `perch` é uma FAIXA em fluxo no `BrandPanel` (`flex-1 min-h-14`, sem
 * texto); o personagem fica dentro dela. Prova por medição, em cada campo de login, cadastro
 * e redefinição: a caixa da figura (1) não intersecta nenhum texto do painel, (2) está dentro
 * da faixa e (3) a faixa reserva >= 56 px. O 1600x600 é a viewport baixa: a faixa segura 56 px
 * mesmo quando o painel cresce.
 */
interface PerchRoute {
  name: string;
  path: string;
  button: string;
  fields: string[];
}
const PERCH_ROUTES: PerchRoute[] = [
  { name: 'login', path: '/login', button: 'Entrar', fields: ['Email', 'Senha'] },
  {
    name: 'signup',
    path: '/signup',
    button: 'Criar conta',
    fields: ['Seu nome', 'Email', 'Nome do workspace', 'Senha'],
  },
  { name: 'reset', path: '/reset-password', button: 'Enviar instruções', fields: ['Email'] },
];
const PERCH_SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1600, height: 600 },
] as const;

test.describe('Companheiro — perch x painel editorial (A2)', () => {
  for (const size of PERCH_SIZES) {
    for (const route of PERCH_ROUTES) {
      test(`${size.width}x${size.height} ${route.name}: a figura no perch não cobre o texto do painel`, async ({
        page,
      }) => {
        test.setTimeout(75_000);
        await installProbe(page);
        await installRoutes(page);
        await page.setViewportSize(size);
        await page.goto(route.path);
        await hydrated(page, route.button);
        await companionReady(page);
        for (const [i, label] of route.fields.entries()) {
          await focusField(page, label);
          await expect(actor(page)).toHaveAttribute('data-station', 'perch');
          await settled(page);
          await stable(actor(page));
          const strip = await boxOf(page.locator('[data-companion-anchor="perch"]'));
          const fig = await boxOf(actor(page));
          const where = `${route.name} ${size.width}x${size.height} "${label}"`;
          expect(strip.height, `${where}: faixa ≥ 56 px`).toBeGreaterThanOrEqual(56);
          expect(fig.x, `${where}: figura à esquerda da faixa`).toBeGreaterThanOrEqual(strip.x - 1);
          expect(fig.y, `${where}: figura acima da faixa`).toBeGreaterThanOrEqual(strip.y - 1);
          expect(fig.y + fig.height, `${where}: figura abaixo da faixa`).toBeLessThanOrEqual(
            strip.y + strip.height + 1,
          );
          expect(
            await editorialTextUnderActor(page),
            `${where}: texto do painel sob a figura`,
          ).toEqual([]);
          if (i === 0 && route.name === 'signup' && size.width !== 1920) {
            await detail(page, `achado-A2-perch-na-faixa-${size.width}x${size.height}`);
            await page.screenshot({
              path: `${SHOTS}/achado-A2-perch-na-faixa-${size.width}x${size.height}-tela.png`,
              animations: 'disabled',
            });
          }
        }
      });
    }
  }
});

/* Movimento reduzido nos quadros-chave: sem voo, sem respiração, sem piscar. */
test.describe('Companheiro — movimento reduzido (1440)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('troca de posto por crossfade de opacidade; nenhuma animação de transform no palco', async ({
    page,
  }) => {
    test.setTimeout(75_000);
    await installProbe(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installRoutes(page, { delayMs: 1_200 });
    await page.goto('/signup');
    await hydrated(page, 'Criar conta');
    await companionReady(page);
    await expect(figure(page)).toHaveAttribute('data-motion', 'off');

    await focusField(page, 'Seu nome');
    await expect(actor(page)).toHaveAttribute('data-station', 'perch');
    await fillSignup(page);
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await expect(figure(page)).toHaveAttribute('data-state', 'thinking', { timeout: 3_000 });
    // thinking = ponta acesa PARADA.
    await expect(figure(page).locator('svg[data-rig]')).toHaveAttribute('data-tip', 'lit');
    await expect(h1(page, 'Verifique seu email')).toBeVisible({ timeout: 5_000 });
    await expect(actor(page)).toHaveAttribute('data-station', 'heading', { timeout: 5_000 });
    await expect(figure(page)).toHaveAttribute('data-state', 'celebrate');
    // celebrate = pose success parada: olhos felizes, ponta acesa.
    await expect(figure(page).locator('svg[data-rig]')).toHaveAttribute('data-eyes', 'happy');
    await page.waitForTimeout(6_000);

    const animations = (await probeOf(page)).animations;
    const moving = animations.filter((a) =>
      a.props.some((p) => p === 'transform' || p === 'translate'),
    );
    expect(moving, `animações de movimento no palco: ${JSON.stringify(moving)}`).toEqual([]);
    for (const a of animations) {
      expect(a.duration, `crossfade curto: ${JSON.stringify(a)}`).toBeLessThanOrEqual(160);
    }
    expect(
      await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === 'running').length,
      ),
    ).toBe(0);
  });
});

/* ----------------------------------------------------------------------------------- */
/* 3. PRIVACIDADE                                                                       */
/* ----------------------------------------------------------------------------------- */

const SECRET_EMAIL = 'privado.teste.9981@exemplo.test';
const SECRET_PASSWORD = 'S3nh@-Secreta-Zq7731';

test.describe('Companheiro — privacidade (ADR-006 §9)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('digitar e-mail e senha não deixa rastro no palco, nos data-*, no storage nem na rede', async ({
    page,
    context,
  }) => {
    test.setTimeout(75_000);
    await installProbe(page);
    await installRoutes(page);
    const requests: string[] = [];
    await page.goto('/login');
    await hydrated(page, 'Entrar');
    await companionReady(page);
    await page.waitForTimeout(500);

    // Janela de observação: só o que acontece DEPOIS de o personagem estar de pé.
    const callsBefore = (await probeOf(page)).calls.length;
    page.on('request', (req) =>
      requests.push(`${req.method()} ${req.url()} ${req.postData() ?? ''}`),
    );

    await page.getByLabel('Email').click();
    await page.getByLabel('Email').pressSequentially(SECRET_EMAIL, { delay: 15 });
    await page.getByLabel('Senha').click();
    await page.getByLabel('Senha').pressSequentially(SECRET_PASSWORD, { delay: 15 });
    await expect(page.getByLabel('Senha')).toHaveValue(SECRET_PASSWORD);
    await page.getByLabel('Email').click(); // sai da senha
    await settled(page);
    await page.waitForTimeout(500);

    const leaks = await page.evaluate(
      ({ email, password }) => {
        const found: string[] = [];
        const check = (where: string, value: string | null | undefined): void => {
          if (!value) return;
          if (value.includes(email) || value.includes(password)) found.push(where);
        };
        const stage = document.querySelector('[data-companion-stage]');
        check('stage.outerHTML', stage?.outerHTML);
        check('stage.textContent', stage?.textContent);
        for (const el of Array.from(document.querySelectorAll('*'))) {
          for (const attr of Array.from(el.attributes)) {
            if (attr.name.startsWith('data-') || attr.name.startsWith('aria-')) {
              check(`${el.tagName}[${attr.name}]`, attr.value);
            }
          }
        }
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i) ?? '';
          check(`localStorage:${k}`, k + (localStorage.getItem(k) ?? ''));
        }
        for (let i = 0; i < sessionStorage.length; i += 1) {
          const k = sessionStorage.key(i) ?? '';
          check(`sessionStorage:${k}`, k + (sessionStorage.getItem(k) ?? ''));
        }
        check('document.title', document.title);
        check('location', location.href);
        const sessionKeys = Array.from(
          { length: sessionStorage.length },
          (_, i) => sessionStorage.key(i) ?? '',
        );
        return { found, sessionKeys };
      },
      { email: SECRET_EMAIL, password: SECRET_PASSWORD },
    );
    expect(leaks.found, 'valor digitado encontrado').toEqual([]);
    // A única coisa que o módulo guarda é a chave da saudação.
    expect(leaks.sessionKeys.filter((k) => k.includes('companion'))).toEqual([
      'hm:auth-companion:greeted',
    ]);

    // Zero rede extra: digitar e mudar de foco não faz fetch, XHR, beacon nem requisição.
    const probe = await probeOf(page);
    expect(probe.calls.slice(callsBefore), 'chamadas fetch/XHR/beacon durante a digitação').toEqual(
      [],
    );
    expect(requests, 'requisições durante a digitação').toEqual([]);
    for (const r of probe.calls) {
      expect(r.url + r.body).not.toContain(SECRET_PASSWORD);
    }

    // Nenhum listener de teclado/entrada na raiz do módulo: só foco e ponteiro.
    const cdp = await context.newCDPSession(page);
    const root = await cdp.send('Runtime.evaluate', {
      expression: "document.querySelector('[data-companion-root]')",
    });
    const objectId = root.result.objectId;
    expect(objectId, 'raiz do companheiro').toBeTruthy();
    const listeners = await cdp.send('DOMDebugger.getEventListeners', {
      objectId: objectId as string,
    });
    const types = listeners.listeners.map((l) => l.type).sort();
    expect(types, `listeners da raiz: ${types.join(',')}`).toEqual([
      'focusin',
      'focusout',
      'pointerdown',
    ]);
    await cdp.detach();
  });

  test('a senha fica no campo: avert não revela nem altera o valor, e o envio leva só o que a pessoa digitou', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installProbe(page);
    let sent: string | null = null;
    await installRoutes(page, { badLogin: true });
    await page.route('**/auth/login', (route) => {
      sent = route.request().postData();
      return json(route, { message: 'Credenciais inválidas' }, 401);
    });
    await page.goto('/login');
    await hydrated(page, 'Entrar');
    await companionReady(page);
    await page.getByLabel('Email').fill(SECRET_EMAIL);
    await page.getByLabel('Senha').fill(SECRET_PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(figure(page)).toHaveAttribute('data-state', 'confused', { timeout: 5_000 });
    expect(JSON.parse(sent ?? '{}')).toEqual({ email: SECRET_EMAIL, password: SECRET_PASSWORD });
    // O campo de senha continua type=password (o motor não o "destampa").
    await expect(page.getByLabel('Senha')).toHaveAttribute('type', 'password');
  });
});

/* ----------------------------------------------------------------------------------- */
/* 4. CELULAR                                                                           */
/* ----------------------------------------------------------------------------------- */

test.describe('Companheiro — celular 375', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('caixa 40x40 reservada no SSR; a figura entra nela sem mexer no layout', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installProbe(page);
    await installRoutes(page);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    const slot = page.locator('[data-companion-slot="inline"]');
    const reserved = await boxOf(slot);
    expect(Math.round(reserved.width)).toBe(40);
    expect(Math.round(reserved.height)).toBe(40);
    expect(await page.locator('[data-companion]').count(), 'a figura ainda não chegou').toBe(0);
    // A subida de entrada da coluna (hm-rise, 320 ms) mexe no Y do título: mede depois dela.
    await page.waitForFunction(() =>
      (document.querySelector('main > div')?.getAnimations() ?? []).every(
        (a) => a.playState === 'finished',
      ),
    );
    const title = await boxOf(page.getByRole('heading', { level: 1, name: 'Entrar', exact: true }));

    await companionReady(page);
    expect(await boxOf(slot)).toEqual(reserved);
    expect(
      (await boxOf(page.getByRole('heading', { level: 1, name: 'Entrar', exact: true }))).y,
    ).toBe(title.y);
    const fig = await boxOf(actor(page));
    expect(Math.abs(fig.x - reserved.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(fig.y - reserved.y)).toBeLessThanOrEqual(1);
    expect(Math.round(fig.width)).toBe(40);
    await expect(figure(page)).toHaveAttribute('data-size', '40');
    await expect(actor(page)).toHaveAttribute('data-station', 'inline');
  });

  test('nunca voa: trocar de campo, errar e ter sucesso não move o personagem', async ({
    page,
  }) => {
    test.setTimeout(75_000);
    await installProbe(page);
    await installRoutes(page, { delayMs: 1_200 });
    await page.goto('/signup');
    await hydrated(page, 'Criar conta');
    await companionReady(page);
    const slot = page.locator('[data-companion-slot="inline"]');
    const offsetFromSlot = async (): Promise<{ dx: number; dy: number }> => {
      const [a, b] = [await boxOf(actor(page)), await boxOf(slot)];
      return { dx: a.x - b.x, dy: a.y - b.y };
    };
    const rest = await offsetFromSlot();
    expect(rest).toEqual({ dx: 0, dy: 0 });

    await focusField(page, 'Seu nome');
    await focusField(page, 'Senha');
    await expect(figure(page)).toHaveAttribute('data-state', 'avert');
    await expect(figure(page).locator('svg[data-rig]')).toHaveAttribute('data-eyes', 'closed');
    await expect(actor(page)).toHaveAttribute('data-station', 'inline');
    await capture(page, SHOTS, 'chave-mobile-avert', 'dark', { full: false });
    // Erro de validação (campos vazios): no celular não há campo para o olhar procurar.
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await page.waitForTimeout(300);
    expect(await offsetFromSlot()).toEqual(rest);

    await fillSignup(page);
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await expect(figure(page)).toHaveAttribute('data-state', 'thinking', { timeout: 3_000 });
    await capture(page, SHOTS, 'chave-mobile-thinking', 'dark', { full: false });
    await expect(h1(page, 'Verifique seu email')).toBeVisible({ timeout: 5_000 });
    await expect(figure(page)).toHaveAttribute('data-state', 'celebrate');
    await settled(page);
    expect(await offsetFromSlot()).toEqual(rest);
    await capture(page, SHOTS, 'chave-mobile-sucesso', 'dark', { full: false });

    const probe = await probeOf(page);
    const travel = probe.animations.filter((a) => a.cls === 'm-layer');
    expect(travel, 'voo/deslize no celular').toEqual([]);
    expect(
      probe.animations.some(
        (a) =>
          a.duration >= 560 &&
          a.duration <= 760 &&
          a.props.includes('transform') &&
          a.layer === null,
      ),
    ).toBe(false);
  });

  test('confused no 401 e thinking acima de 300 ms funcionam no lugar', async ({ page }) => {
    test.setTimeout(60_000);
    await installProbe(page);
    await installRoutes(page, { badLogin: true, delayMs: 1_000 });
    await page.goto('/login');
    await hydrated(page, 'Entrar');
    await companionReady(page);
    await page.getByLabel('Email').fill('ana@aurora.test');
    await page.getByLabel('Senha').fill('senha-errada-123');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(figure(page)).toHaveAttribute('data-state', 'thinking', { timeout: 3_000 });
    await expect(figure(page)).toHaveAttribute('data-state', 'confused', { timeout: 5_000 });
    await settled(page);
    await capture(page, SHOTS, 'chave-mobile-confused', 'dark', { full: false });
    await expect(actor(page)).toHaveAttribute('data-station', 'inline');
  });

  test('teclado aberto: o balão contextual do sucesso não aparece', async ({ page }) => {
    test.setTimeout(60_000);
    await installProbe(page);
    await installRoutes(page, { delayMs: 200 });
    await page.goto('/signup');
    await hydrated(page, 'Criar conta');
    await companionReady(page);
    await fillSignup(page);
    await setKeyboard(page, true);
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await expect(h1(page, 'Verifique seu email')).toBeVisible({ timeout: 5_000 });
    await expect(figure(page)).toHaveAttribute('data-state', 'celebrate', { timeout: 5_000 });
    // A celebração acontece; o balão (que repetiria o título) não.
    await page.waitForTimeout(2_500);
    await expect(page.locator('[data-companion-bubble]')).toHaveCount(0);
  });

  test('balão (abaixo da figura) some com o teclado aberto e a respiração congela', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installProbe(page);
    await installRoutes(page);
    await page.goto('/login');
    await hydrated(page, 'Entrar');
    await companionReady(page);
    await expect(bubbleBox(page)).toHaveText('Que bom que voltou.', { timeout: 10_000 });
    const fig = await boxOf(actor(page));
    const bubble = await boxOf(page.locator('[data-companion-bubble] .m-bubble'));
    expect(bubble.y, 'balão ABAIXO da figura').toBeGreaterThanOrEqual(fig.y + fig.height);
    expect(
      Math.abs(bubble.x + bubble.width - (fig.x + fig.width)),
      'alinhado à direita da figura',
    ).toBeLessThanOrEqual(2);
    await capture(page, SHOTS, 'chave-mobile-chegada-balao', 'dark', { full: false });

    await setKeyboard(page, true);
    await expect(page.locator('[data-companion-bubble]')).toHaveCount(0, { timeout: 3_000 });
    // Teclado aberto: nenhuma animação de respiração rodando.
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) => a.playState === 'running' && Number(a.effect?.getTiming().duration ?? 0) >= 4000,
          ).length,
    );
    expect(running, 'respiração congelada com o teclado aberto').toBe(0);
    await capture(page, SHOTS, 'chave-mobile-teclado-aberto', 'dark', { full: false });

    // Observação (não é falha): o balão dispensado só pelo teclado volta ao fechá-lo se ainda
    // está nos 7 s de vida. Na prática o teclado abre por um `focusin`, que já o dispensa.
    await setKeyboard(page, false);
    await page.waitForTimeout(500);
    test.info().annotations.push({
      type: 'teclado-fechado-balao',
      description: `balões após fechar o teclado sem foco: ${await page.locator('[data-companion-bubble]').count()}`,
    });
  });
});

/* ----------------------------------------------------------------------------------- */
/* 5. CONVITE: âncora `heading` no cabeçalho (F76-S14, A4)                              */
/* ----------------------------------------------------------------------------------- */

const INVITE_URL = `/convite/${TOKEN}#token_hash=${PROOF_HASH}&type=invite`;

test.describe('Companheiro — convite (âncora heading no cabeçalho)', () => {
  test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('o personagem aparece na linha do eyebrow "Convite", vai ao perch e celebra no sucesso', async ({
      page,
    }) => {
      test.setTimeout(75_000);
      await installProbe(page);
      await installRoutes(page, { invite: PREVIEW });
      await page.goto(INVITE_URL);
      await expect(h1(page, 'Clínica Aurora')).toBeVisible();
      await expect(page.getByLabel('Crie uma senha')).toBeVisible();
      await companionReady(page);

      // Visível, no posto heading, em pé na linha do eyebrow (o `<p>` dentro do `div`).
      await expect(actor(page)).toHaveAttribute('data-station', 'heading');
      await expect(actor(page)).toHaveCSS('visibility', 'visible');
      await expectPose(page, IDLE, 'convite');
      const fig = await boxOf(actor(page));
      const eyebrow = await boxOf(page.locator('main header p').first());
      expect(
        Math.abs(fig.y + fig.height - (eyebrow.y + eyebrow.height)),
        'convite: figura fora da linha do eyebrow',
      ).toBeLessThanOrEqual(3);
      const header = await boxOf(page.locator('main header').first());
      expect(Math.abs(fig.x + fig.width / 2 - (header.x + header.width - 24))).toBeLessThanOrEqual(
        2,
      );
      const title = await boxOf(page.getByRole('heading', { level: 1 }));
      expect(fig.y + fig.height, 'convite: figura sobre o H1').toBeLessThanOrEqual(title.y + 1);
      await capture(page, SHOTS, 'convite-sem-ancora', 'dark', { full: false });

      // 1º foco: voa ao perch, dentro da faixa do painel.
      await focusField(page, 'Seu nome');
      await expect(actor(page)).toHaveAttribute('data-station', 'perch');
      await settled(page);
      await stable(actor(page));
      const strip = await boxOf(page.locator('[data-companion-anchor="perch"]'));
      const perched = await boxOf(actor(page));
      expect(Math.abs(perched.x - strip.x)).toBeLessThanOrEqual(1);
      expect(perched.y).toBeGreaterThanOrEqual(strip.y - 1);
      expect(perched.y + perched.height).toBeLessThanOrEqual(strip.y + strip.height + 1);
      expect(await editorialTextUnderActor(page), 'convite: texto do painel sob a figura').toEqual(
        [],
      );
      await detail(page, 'convite-foco-perch-dark');
      await capture(page, SHOTS, 'convite-foco-perch', 'dark', { full: false });

      // Sucesso ('invite-done', final): volta ao título e CELEBRA, visível.
      await page.getByLabel('Seu nome').fill('Bia Lima');
      await page.getByLabel('Crie uma senha').fill('senha-forte-2026');
      await page.getByRole('button', { name: 'Criar conta e entrar' }).click();
      await expect(page.getByText('Conta criada', { exact: true })).toBeVisible({ timeout: 5_000 });
      await expect(actor(page)).toHaveAttribute('data-station', 'heading', { timeout: 5_000 });
      await expect(figure(page)).toHaveAttribute('data-state', 'celebrate', { timeout: 5_000 });
      await settled(page);
      await expectPose(page, SUCCESS, 'convite: sucesso final');
      await expect(actor(page), 'convite: celebra visível').toHaveCSS('visibility', 'visible');
      await expect(actor(page)).toHaveAttribute('data-placed', 'true');
      const done = await boxOf(actor(page));
      const doneEyebrow = await boxOf(page.locator('main header p').first());
      expect(
        Math.abs(done.y + done.height - (doneEyebrow.y + doneEyebrow.height)),
        'convite: celebração fora da linha do eyebrow',
      ).toBeLessThanOrEqual(3);
      expect(done.x).toBeGreaterThanOrEqual(0);
      expect(done.x + done.width).toBeLessThanOrEqual(1440);
      await detail(page, 'convite-celebra-heading-dark');
      await capture(page, SHOTS, 'convite-conta-criada', 'dark', { full: false });
    });
  });

  test.describe('celular', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('no celular a caixa inline existe: o personagem aparece normalmente', async ({ page }) => {
      test.setTimeout(60_000);
      await installProbe(page);
      await installRoutes(page, { invite: PREVIEW });
      await page.goto(INVITE_URL);
      await expect(h1(page, 'Clínica Aurora')).toBeVisible();
      await companionReady(page);
      await expect(actor(page)).toHaveAttribute('data-station', 'inline');
      await capture(page, SHOTS, 'convite-mobile-inline', 'dark', { full: false });
    });
  });
});
