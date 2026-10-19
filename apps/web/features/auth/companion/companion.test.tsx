// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthCompanionRoot, useAuthCompanion, useAuthCompanionStep } from './AuthCompanionRoot';
import { CompanionInlineSlot, CompanionPerch, useCompanionAnchor } from './anchors';
import { COMPANION_CHUNK_MARKER, CompanionFigure, MotionDeck } from './CompanionFigure';
import type { AuthCompanionApi } from './contract';

// O esbuild do vitest compila JSX no runtime clássico (mesmo contorno do rig.test.ts).
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

/* ----------------------- WAAPI falso (happy-dom não tem) ----------------------- */

class FakeAnimation {
  playState: 'running' | 'paused' | 'finished' | 'idle' = 'running';
  onfinish: (() => void) | null = null;
  oncancel: (() => void) | null = null;
  pause(): void {
    if (this.playState === 'running') this.playState = 'paused';
  }
  play(): void {
    if (this.playState === 'paused') this.playState = 'running';
  }
  cancel(): void {
    if (this.playState === 'idle' || this.playState === 'finished') return;
    this.playState = 'idle';
    this.oncancel?.();
  }
  finish(): void {
    if (this.playState === 'idle' || this.playState === 'finished') return;
    this.playState = 'finished';
    this.onfinish?.();
  }
}

interface Rec {
  el: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  anim: FakeAnimation;
}
const created: Rec[] = [];

function installAnimate(): void {
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const anim = new FakeAnimation();
      created.push({ el: this, keyframes, options, anim });
      return anim;
    },
  });
}

const layerOf = (r: Rec): string | null => r.el.getAttribute('data-layer');
const props = (r: Rec): string[] =>
  r.keyframes.flatMap((k) => Object.keys(k).filter((p) => p !== 'offset' && p !== 'easing'));
const alive = (): Rec[] => created.filter((r) => ['running', 'paused'].includes(r.anim.playState));
const finite = (r: Rec): boolean => r.options.iterations !== Number.POSITIVE_INFINITY;
const isBreath = (r: Rec): boolean => r.keyframes.some((k) => k['translate'] === '0 -1.5px');

/** Termina as animações finitas até não nascerem novas (o pouso nasce do fim do voo). */
async function settleAnimations(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    const pending = alive().filter((r) => finite(r) && !isBreath(r));
    if (pending.length === 0) return;
    await act(async () => {
      for (const r of pending) r.anim.finish();
      await Promise.resolve();
    });
  }
}

/* ------------------------------ ambiente falso ------------------------------ */

class FakeIO {
  static instances: FakeIO[] = [];
  constructor(private readonly cb: IntersectionObserverCallback) {
    FakeIO.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  trigger(isIntersecting: boolean): void {
    this.cb(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

let reducedMotion = false;
let hidden = false;

function installEnvironment(): void {
  installAnimate();
  FakeIO.instances = [];
  Object.defineProperty(window, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: FakeIO,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: query.includes('min-width') ? true : reducedMotion,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

function stub(el: Element | null, r: DOMRect): void {
  if (el) vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r);
}

/* ---------------------------------- telas ---------------------------------- */

let api: AuthCompanionApi | null = null;
/** `false` simula uma tela sem `AuthHeading` (ex.: convite carregando). */
let withHeading = true;

function Screen(): React.ReactNode {
  const heading = useCompanionAnchor<HTMLElement>('heading');
  api = useAuthCompanion();
  useAuthCompanionStep('login');
  return (
    <>
      <div className="logo-row">
        <CompanionInlineSlot />
      </div>
      <header ref={withHeading ? heading : undefined}>
        <p>Acesso</p>
        <h1>Entrar</h1>
      </header>
      <input id="email" type="email" aria-label="email" />
      <input id="pass" type="password" aria-label="senha" />
      <aside>
        <CompanionPerch />
      </aside>
    </>
  );
}

let host: HTMLElement;
let root: Root;

async function mount(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <AuthCompanionRoot>
        <Screen />
      </AuthCompanionRoot>,
    );
  });
  stub(host.querySelector('[data-companion-stage]'), rect(0, 0, 1200, 800));
  stub(host.querySelector('header'), rect(100, 300, 400, 120));
  stub(host.querySelector('header > p'), rect(100, 300, 300, 16));
  // A faixa do perch (F76-S14): 400x120 no fluxo do painel, y 100..220.
  stub(host.querySelector('[data-companion-anchor="perch"]'), rect(700, 100, 400, 120));
  stub(host.querySelector('#email'), rect(100, 380, 300, 44));
  stub(host.querySelector('#pass'), rect(100, 450, 300, 44));
}

const actor = (): HTMLElement | null => host.querySelector('[data-companion-actor]');

async function waitForActor(): Promise<HTMLElement> {
  await vi.waitFor(
    () => {
      expect(actor()?.getAttribute('data-placed')).toBe('true');
    },
    { timeout: 5000, interval: 25 },
  );
  const el = actor();
  if (!el) throw new Error('ator não montou');
  return el;
}

function focus(el: Element): Promise<void> {
  return act(async () => {
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  created.length = 0;
  reducedMotion = false;
  hidden = false;
  api = null;
  withHeading = true;
  installEnvironment();
});

afterEach(async () => {
  delete document.documentElement.dataset['brand'];
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------ marca ------------------------------------ */

describe('marca e carregamento', () => {
  it('não carrega o chunk antes de ≥ 400 ms; depois monta o ator com a marca do chunk', async () => {
    await mount();
    expect(host.querySelector('[data-companion-stage]')).not.toBeNull();
    expect(actor()).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(actor()).toBeNull();
    await waitForActor();
    expect(host.querySelector('[data-companion-chunk]')?.getAttribute('data-companion-chunk')).toBe(
      COMPANION_CHUNK_MARKER,
    );
  });

  it('o palco não afeta layout nem acessibilidade', async () => {
    await mount();
    const stage = host.querySelector('[data-companion-stage]');
    expect(stage?.getAttribute('aria-hidden')).toBe('true');
    expect(stage?.className).toContain('absolute');
    expect(stage?.className).toContain('inset-0');
    expect(stage?.className).toContain('pointer-events-none');
  });

  it.each(['odonto', 'maian'])('data-brand="%s": não renderiza nada', async (brand) => {
    document.documentElement.dataset['brand'] = brand;
    await mount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });
    expect(actor()).toBeNull();
    expect(created).toHaveLength(0);
  });

  it('data-brand="leadium" renderiza', async () => {
    document.documentElement.dataset['brand'] = 'leadium';
    await mount();
    await waitForActor();
  });

  it('fora do provider tudo é inerte', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    let outside: AuthCompanionApi | null = null;
    function Outside(): React.ReactNode {
      const ref = useCompanionAnchor<HTMLElement>('heading');
      outside = useAuthCompanion();
      useAuthCompanionStep('login');
      return <header ref={ref} />;
    }
    await act(async () => {
      root.render(<Outside />);
    });
    expect(() => outside?.signal({ type: 'submit' })).not.toThrow();
  });
});

/* --------------------------------- voo e foco --------------------------------- */

describe('voo (movimento vivo)', () => {
  it('1º foco num campo: voa do título ao painel com a duração do plano e will-change só durante o voo', async () => {
    await mount();
    const pos = await waitForActor();
    await settleAnimations();
    created.length = 0;

    await focus(host.querySelector('#email') as Element);

    const x = created.find((r) =>
      r.keyframes[0]?.['transform']?.toString().startsWith('translateX('),
    );
    expect(x).toBeDefined();
    const d = Number(x?.options.duration);
    expect(d).toBeGreaterThanOrEqual(560);
    expect(d).toBeLessThanOrEqual(760);
    expect(pos.style.willChange).toBe('transform');
    expect(pos.getAttribute('data-station')).toBe('perch');
    // x = início da faixa; y = centro do campo (402) limitado à faixa (100..220 - 48).
    expect(pos.style.transform).toBe('translate(700px, 172px)');

    // O arco, o esticar e a sombra viajam juntos.
    const flightLayers = created.map(layerOf);
    expect(flightLayers).toEqual(expect.arrayContaining(['fig', 'antenna', 'shadow']));

    await settleAnimations();
    expect(pos.style.willChange).toBe('');
  });

  it('depois do pouso a respiração roda no máx. 3 ciclos e fica congelada enquanto há campo focado', async () => {
    await mount();
    await waitForActor();
    await settleAnimations();
    await focus(host.querySelector('#email') as Element);
    await settleAnimations();

    const breath = created.filter(isBreath);
    expect(breath.length).toBeGreaterThan(0);
    expect(breath.at(-1)?.options.iterations).toBe(3);
    expect(breath.at(-1)?.anim.playState).toBe('paused');
  });

  it('a senha vira avert: olhos fechados, olhar à direita', async () => {
    await mount();
    await waitForActor();
    await focus(host.querySelector('#pass') as Element);
    const fig = host.querySelector('.m-figure');
    expect(fig?.getAttribute('data-state')).toBe('avert');
    expect(host.querySelector('svg')?.getAttribute('data-eyes')).toBe('closed');
    expect(host.querySelector('svg')?.getAttribute('data-look')).toBe('right');
  });

  it('sinais do formulário chegam à figura: credencial errada confunde; o próximo foco desfaz', async () => {
    await mount();
    await waitForActor();
    await settleAnimations();
    await act(async () => {
      api?.signal({ type: 'error', kind: 'credentials' });
    });
    expect(host.querySelector('.m-figure')?.getAttribute('data-state')).toBe('confused');
    expect(host.querySelector('svg')?.getAttribute('data-tip')).toBe('warn');
    await focus(host.querySelector('#email') as Element);
    expect(host.querySelector('.m-figure')?.getAttribute('data-state')).toBe('idle');
  });

  it('sucesso celebra no lugar (sem voo) quando o título já é o posto', async () => {
    await mount();
    await waitForActor();
    await settleAnimations();
    created.length = 0;
    await act(async () => {
      api?.signal({ type: 'success', final: false });
    });
    expect(host.querySelector('.m-figure')?.getAttribute('data-state')).toBe('celebrate');
    expect(created.some((r) => layerOf(r) === 'halo')).toBe(true);
  });

  it('o personagem só anima transform, translate e opacity', async () => {
    await mount();
    await waitForActor();
    await settleAnimations();
    await focus(host.querySelector('#email') as Element);
    await settleAnimations();
    for (const r of created) {
      for (const p of props(r)) expect(['transform', 'translate', 'opacity']).toContain(p);
    }
  });
});

describe('perch em faixa e fallback de postos (F76-S14)', () => {
  it('a caixa da figura fica sempre dentro da faixa, com o campo acima ou abaixo dela', async () => {
    await mount();
    const pos = await waitForActor();
    await settleAnimations();
    await focus(host.querySelector('#email') as Element); // centro 402: abaixo da faixa
    await settleAnimations();
    expect(pos.style.transform).toBe('translate(700px, 172px)');

    stub(host.querySelector('#pass'), rect(100, 20, 300, 44)); // centro 42: acima da faixa
    await focus(host.querySelector('#pass') as Element);
    await settleAnimations();
    expect(pos.style.transform).toBe('translate(700px, 100px)');
  });

  it('faixa mais baixa que a figura (48 px): fica no heading, sem voar para o painel', async () => {
    await mount();
    const pos = await waitForActor();
    await settleAnimations();
    const before = pos.style.transform;
    stub(host.querySelector('[data-companion-anchor="perch"]'), rect(700, 100, 400, 40));
    created.length = 0;
    await focus(host.querySelector('#email') as Element);
    await settleAnimations();
    expect(pos.getAttribute('data-station')).toBe('heading');
    expect(pos.style.transform).toBe(before);
    expect(created.some((r) => r.options.duration === 560)).toBe(false);
  });

  it('o heading mede a base do primeiro <p> do header (o eyebrow), não a do header', async () => {
    await mount();
    const pos = await waitForActor();
    // A base do eyebrow (316) manda, não a do header (420).
    expect(pos.style.transform).toBe('translate(452px, 270.5px)');
  });

  it('sem âncora heading o personagem usa o perch em vez de ficar invisível', async () => {
    withHeading = false;
    await mount();
    const pos = await waitForActor();
    expect(pos.getAttribute('data-station')).toBe('perch');
    expect(pos.getAttribute('data-placed')).toBe('true');
    expect(pos.style.transform).toBe('translate(700px, 136px)');
  });
});

describe('movimento reduzido', () => {
  it('não voa: troca de posto por crossfade de 160 ms; sem respiração nem piscar', async () => {
    reducedMotion = true;
    await mount();
    const pos = await waitForActor();
    await settleAnimations();
    created.length = 0;

    await focus(host.querySelector('#email') as Element);

    const fade = created.find((r) => r.el === pos);
    expect(fade?.options.duration).toBe(160);
    expect(props(fade as Rec).every((p) => p === 'opacity')).toBe(true);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    await settleAnimations();

    expect(pos.style.transform).toBe('translate(700px, 172px)');
    expect(pos.style.willChange).toBe('');
    const moving = created.filter((r) =>
      props(r).some((p) => p === 'transform' || p === 'translate'),
    );
    expect(moving).toHaveLength(0);
  });

  it('a entrada vira só opacity', async () => {
    reducedMotion = true;
    await mount();
    await waitForActor();
    expect(created.length).toBeGreaterThan(0);
    for (const r of created) expect(props(r).every((p) => p === 'opacity')).toBe(true);
  });
});

describe('pausa: zero animações com aba oculta ou fora da viewport', () => {
  it('fora da viewport pausa tudo; ao voltar retoma', async () => {
    await mount();
    await waitForActor();
    expect(alive().length).toBeGreaterThan(0);
    const io = FakeIO.instances.at(-1);
    expect(io).toBeDefined();

    await act(async () => io?.trigger(false));
    expect(alive().every((r) => r.anim.playState === 'paused')).toBe(true);

    await act(async () => io?.trigger(true));
    expect(alive().some((r) => r.anim.playState === 'running')).toBe(true);
  });

  it('aba oculta pausa tudo; ao voltar retoma', async () => {
    await mount();
    await waitForActor();
    hidden = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(alive().length).toBeGreaterThan(0);
    expect(alive().every((r) => r.anim.playState === 'paused')).toBe(true);

    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(alive().some((r) => r.anim.playState === 'running')).toBe(true);
  });
});

/* ------------------------- figura isolada (relógio falso) ------------------------- */

describe('figura', () => {
  let container: HTMLElement;
  let figRoot: Root;
  let deck: MotionDeck;
  let ended: string[];

  async function renderFigure(
    p: Partial<React.ComponentProps<typeof CompanionFigure>> = {},
  ): Promise<void> {
    await act(async () => {
      figRoot.render(
        <CompanionFigure
          state="idle"
          look="none"
          size={48}
          motion="live"
          deck={deck}
          onStateEnd={(s) => ended.push(s)}
          {...p}
        />,
      );
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    figRoot = createRoot(container);
    deck = new MotionDeck();
    ended = [];
  });

  afterEach(async () => {
    await act(async () => {
      figRoot.unmount();
    });
    container.remove();
  });

  const tick = (ms: number): Promise<void> =>
    act(async () => {
      vi.advanceTimersByTime(ms);
    });

  it('repouso: respira 0 → −1,5 → 0 px por 3 ciclos de 4,2 s e pisca entre 4 e 9 s', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await renderFigure();
    const breath = created.find((r) => layerOf(r) === 'fig');
    expect(breath?.options).toMatchObject({ duration: 4200, iterations: 3 });
    expect(created.some((r) => layerOf(r) === 'eyes-open')).toBe(false);
    await tick(3999);
    expect(created.some((r) => layerOf(r) === 'eyes-open')).toBe(false);
    await tick(2);
    const blink = created.find((r) => layerOf(r) === 'eyes-open');
    expect(blink?.options.duration).toBe(140);
    expect(blink?.keyframes[1]?.['transform']).toBe('scaleY(0.12)');
  });

  it('autoBlink=false não pisca', async () => {
    await renderFigure({ autoBlink: false });
    await tick(30_000);
    expect(created.some((r) => layerOf(r) === 'eyes-open')).toBe(false);
  });

  it('suspensa (voo/entrada): nem respira nem pisca; ao liberar, respira', async () => {
    await renderFigure({ suspended: true });
    await tick(30_000);
    expect(created).toHaveLength(0);
    await renderFigure({ suspended: false });
    expect(created.some((r) => layerOf(r) === 'fig')).toBe(true);
  });

  it('movimento reduzido: 60 s sem uma única animação', async () => {
    await renderFigure({ motion: 'off' });
    await tick(60_000);
    expect(created).toHaveLength(0);
  });

  it('pausa total (aba oculta / fora da viewport) mesmo para o piscar que nasce depois', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await renderFigure();
    act(() => deck.setHalted(true));
    expect(deck.running).toBe(0);
    await tick(10_000);
    expect(created.some((r) => layerOf(r) === 'eyes-open')).toBe(true);
    expect(deck.running).toBe(0);
    act(() => deck.setHalted(false));
    expect(deck.running).toBeGreaterThan(0);
  });

  it('frozen (digitando / teclado virtual) congela só a respiração', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await renderFigure({ frozen: true });
    const breath = created.find((r) => layerOf(r) === 'fig');
    expect(breath?.anim.playState).toBe('paused');
    await tick(4100);
    const blink = created.find((r) => layerOf(r) === 'eyes-open');
    expect(blink?.anim.playState).toBe('running');
    await renderFigure({ frozen: false });
    expect(breath?.anim.playState).toBe('running');
  });

  it('thinking: ponta pulsa, antena balança e olhos varrem em loop de 1,6 s; sai limpo', async () => {
    await renderFigure({ state: 'thinking' });
    const loops = created.filter((r) => r.options.iterations === Number.POSITIVE_INFINITY);
    expect(loops.map(layerOf).sort()).toEqual(['antenna', 'antenna-tip', 'eyes']);
    expect(loops.every((r) => r.options.duration === 1600)).toBe(true);
    expect(container.querySelector('svg')?.getAttribute('data-tip')).toBe('lit');
    await renderFigure({ state: 'idle' });
    expect(loops.every((r) => r.anim.playState === 'idle')).toBe(true);
  });

  it('celebrate: olhos felizes aos 100 ms, avisa o fim em 900 + 1200 ms', async () => {
    await renderFigure({ state: 'celebrate' });
    const svg = (): Element | null => container.querySelector('svg');
    expect(svg()?.getAttribute('data-eyes')).toBe('open');
    expect(svg()?.getAttribute('data-tip')).toBe('lit');
    await tick(100);
    expect(svg()?.getAttribute('data-eyes')).toBe('happy');
    await tick(2100 - 100 - 1);
    expect(ended).toEqual([]);
    await tick(2);
    expect(ended).toEqual(['celebrate']);
    expect(created.some((r) => layerOf(r) === 'halo')).toBe(true);
  });

  it('celebrate com movimento reduzido: pose success parada', async () => {
    await renderFigure({ state: 'celebrate', motion: 'off' });
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('data-eyes')).toBe('happy');
    expect(svg?.getAttribute('data-tip')).toBe('lit');
    expect(created).toHaveLength(0);
    await tick(1200);
    expect(ended).toEqual(['celebrate']);
  });

  it('confused: olho apertado, ponta de alerta; sem animação própria (pose CSS)', async () => {
    await renderFigure({ state: 'confused', autoBlink: false });
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('data-eyes')).toBe('squint');
    expect(svg?.getAttribute('data-tip')).toBe('warn');
    expect(container.querySelector('.m-figure')?.getAttribute('data-state')).toBe('confused');
  });

  it('a ponta pisca de leve ao trocar de cor (só opacity)', async () => {
    await renderFigure({ autoBlink: false });
    created.length = 0;
    await renderFigure({ state: 'confused', autoBlink: false });
    const dip = created.find((r) => layerOf(r) === 'antenna-tip');
    expect(dip?.options.duration).toBe(160);
    expect(props(dip as Rec)).toEqual(['opacity', 'opacity']);
  });

  it('"prova" do sucesso: ponta de .4 a 1 e escala 1 → 1,25 em 200 ms', async () => {
    await renderFigure({ proofRev: 0, autoBlink: false });
    created.length = 0;
    await renderFigure({ proofRev: 1, autoBlink: false });
    const proof = created.find((r) => layerOf(r) === 'antenna-tip');
    expect(proof?.options.duration).toBe(200);
    expect(proof?.keyframes[1]).toMatchObject({ opacity: 1, transform: 'scale(1.25)' });
  });

  it('LOD de celular desenha o 40 e usa o pulo de 5 px', async () => {
    await renderFigure({ size: 40, state: 'celebrate' });
    expect(container.querySelector('svg')?.getAttribute('data-rig')).toBe('inline-40');
    const arc = created.find((r) => r.keyframes.some((k) => k['translate'] === '0 -5px'));
    expect(arc).toBeDefined();
  });
});

describe('MotionDeck', () => {
  it('sem WAAPI (elemento sem animate) resolve na hora e não quebra', async () => {
    const deck = new MotionDeck();
    await expect(
      deck.play(null, { duration: 1, keyframes: [{ offset: 0 }, { offset: 1 }] }, 'x'),
    ).resolves.toBeUndefined();
  });
});

/* ------------------------------ buscas na fonte ------------------------------ */

describe('fonte do módulo (buscas da DoD)', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)],
    );
  const source = files(dir).filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\.tsx?$/.test(f));
  const strip = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('há fontes para varrer', () => {
    expect(source.length).toBeGreaterThan(10);
  });

  it('nenhum keydown/keyup/keypress/beforeinput, fetch, sendBeacon, XHR nem WebSocket', () => {
    for (const f of source) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(
        /keydown|keyup|keypress|beforeinput|sendBeacon|XMLHttpRequest|WebSocket/i,
      );
      expect(text, f).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('nenhum hex em TSX/CSS/TS', () => {
    for (const f of source) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(
        /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/,
      );
    }
  });

  it('o motor nunca lê .value (fora dos comentários)', () => {
    for (const f of source.filter((x) => !x.includes('art'))) {
      expect(strip(readFileSync(f, 'utf8')), f).not.toMatch(/\.value\b/);
    }
  });

  it('sem rAF contínuo', () => {
    for (const f of source) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/requestAnimationFrame/);
    }
  });

  it('will-change nunca no CSS (só inline, durante o voo)', () => {
    const css = source.filter((f) => f.endsWith('.css'));
    expect(css.length).toBeGreaterThan(0);
    for (const f of css) expect(readFileSync(f, 'utf8'), f).not.toMatch(/will-change\s*:/);
  });

  it('o CSS do módulo só transiciona transform e opacity', () => {
    const css = readFileSync(join(dir, 'companion.css'), 'utf8');
    for (const m of css.matchAll(/transition(?:-property)?\s*:([^;]+);/g)) {
      const names = (m[1] ?? '')
        .split(',')
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean);
      for (const n of names) expect(['transform', 'opacity', 'none']).toContain(n);
    }
  });

  it('a marca do chunk vive só no chunk lazy, que o provider importa por next/dynamic', () => {
    const rootSrc = readFileSync(join(dir, 'AuthCompanionRoot.tsx'), 'utf8');
    const figSrc = readFileSync(join(dir, 'CompanionFigure.tsx'), 'utf8');
    const indexSrc = readFileSync(join(dir, 'index.ts'), 'utf8');
    expect(figSrc).toContain('COMPANION_CHUNK_MARKER');
    expect(rootSrc).not.toContain('COMPANION_CHUNK_MARKER');
    expect(indexSrc).not.toContain('COMPANION_CHUNK_MARKER');
    expect(rootSrc).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\('\.\/CompanionFigure'\)/);
    expect(rootSrc).toContain('ssr: false');
    expect(rootSrc).not.toMatch(/from '\.\/CompanionFigure'/);
    expect(strip(indexSrc)).not.toMatch(/['"]\.\/CompanionFigure['"]|companion\.css/);
  });

  it('exporta exatamente a API pública do contrato', async () => {
    const mod = await import('./index');
    expect(Object.keys(mod).sort()).toEqual([
      'AuthCompanionRoot',
      'CompanionInlineSlot',
      'CompanionPerch',
      'useAuthCompanion',
      'useAuthCompanionStep',
      'useCompanionAnchor',
    ]);
  });
});
