import { describe, expect, it } from 'vitest';
import rig from './art/rig.json';
import {
  ANTICIPATE_MS,
  APEX_OFFSET,
  EASE,
  EASE_SPRING,
  EASE_X,
  apexLift,
  bezierProgress,
  blinkDelay,
  clamp,
  flightDuration,
  planBlink,
  planBreath,
  planCelebrate,
  planCrossfade,
  planEntrance,
  planFlight,
  planThinking,
} from './flight';
import type { PlanTrack } from './flight';

const allTracks = (): PlanTrack[] => {
  const f = planFlight({ x: 0, y: 0 }, { x: 600, y: 240 });
  const c = planCelebrate('md-48');
  const t = planThinking({ x: 0, y: -1.5 });
  return [
    f.x,
    f.y,
    f.figArc,
    f.fig,
    f.antenna,
    f.shadow,
    f.land.fig,
    f.land.antenna,
    c.fig,
    c.figArc,
    ...(c.antenna ? [c.antenna] : []),
    c.shadow,
    c.halo,
    t.tip,
    t.antenna,
    t.eyes,
    planBreath(),
    planBlink(),
    planEntrance(),
    planCrossfade(),
  ];
};

describe('duração do voo', () => {
  it('d = clamp(560, 420 + dist · 0,45, 760)', () => {
    expect(flightDuration(0)).toBe(560);
    expect(flightDuration(100)).toBe(560);
    expect(flightDuration(400)).toBeCloseTo(600, 6);
    expect(flightDuration(600)).toBeCloseTo(690, 6);
    expect(flightDuration(2000)).toBe(760);
  });

  it('nunca passa dos limites do ADR (voo ≤ 760 ms)', () => {
    for (const d of [0, 50, 311, 311.1, 755, 1e6]) {
      expect(flightDuration(d)).toBeGreaterThanOrEqual(560);
      expect(flightDuration(d)).toBeLessThanOrEqual(760);
    }
  });

  it('o plano usa a distância euclidiana entre os pontos', () => {
    const plan = planFlight({ x: 0, y: 0 }, { x: 300, y: 400 });
    expect(plan.dist).toBe(500);
    expect(plan.duration).toBeCloseTo(645, 6);
  });
});

describe('arco do voo', () => {
  it('lift = clamp(24, dist · 0,12, 56)', () => {
    expect(apexLift(10)).toBe(24);
    expect(apexLift(300)).toBe(36);
    expect(apexLift(2000)).toBe(56);
  });

  it.each([
    ['descendo', { x: 100, y: 40 }, { x: 600, y: 300 }],
    ['subindo', { x: 600, y: 400 }, { x: 80, y: 60 }],
    ['na horizontal', { x: 100, y: 200 }, { x: 700, y: 200 }],
  ])('o ápice no offset .45 fica em menor y − lift (%s)', (_name, from, to) => {
    const plan = planFlight(from, to);
    const a = ANTICIPATE_MS / plan.duration;
    const dy0 = from.y - to.y;
    // y total = chão (Y em --ease depois da antecipação) − arco da figura.
    const g = bezierProgress([0.2, 0.8, 0.2, 1], (APEX_OFFSET - a) / (1 - a));
    const total = dy0 * (1 - g) - plan.hump;
    expect(total).toBeCloseTo(Math.min(dy0, 0) - apexLift(plan.dist), 6);
    expect(plan.hump).toBeGreaterThan(0);
  });

  it('o arco da figura sobe no ápice (.45) e volta a 0', () => {
    const plan = planFlight({ x: 0, y: 0 }, { x: 500, y: 100 });
    const kf = plan.figArc.keyframes;
    expect(kf.map((k) => k.offset)).toEqual([0, ANTICIPATE_MS / plan.duration, APEX_OFFSET, 1]);
    expect(kf[2]?.translate).toBe(`0 ${-Math.round(plan.hump * 100) / 100}px`);
    expect(kf[3]?.translate).toBe('0 0px');
  });

  it('X usa cubic-bezier(.4, 0, .1, 1) e depois da antecipação', () => {
    const plan = planFlight({ x: 0, y: 0 }, { x: 500, y: 100 });
    const [k0, k1, k2] = plan.x.keyframes;
    expect(k0?.transform).toBe('translateX(-500px)');
    expect(k1?.offset).toBeCloseTo(ANTICIPATE_MS / plan.duration, 9);
    expect(k1?.easing).toBe(EASE_X);
    expect(k2?.transform).toBe('translateX(0px)');
  });

  it('a sombra anda no chão (sem arco): encolhe no ápice a .6 / .4 e volta', () => {
    const plan = planFlight({ x: 0, y: 0 }, { x: 500, y: 100 });
    const apex = plan.shadow.keyframes.find((k) => k.offset === APEX_OFFSET);
    expect(apex).toMatchObject({ transform: 'scale(0.6)', opacity: 0.4 });
    expect(plan.shadow.keyframes.at(-1)).toMatchObject({ transform: 'scale(1)', opacity: 1 });
  });

  it('inclina para o lado do movimento', () => {
    const right = planFlight({ x: 0, y: 0 }, { x: 400, y: 0 });
    const left = planFlight({ x: 400, y: 0 }, { x: 0, y: 0 });
    expect(right.dir).toBe(1);
    expect(left.dir).toBe(-1);
    expect(right.fig.keyframes[2]?.transform).toContain('rotate(7deg)');
    expect(left.fig.keyframes[2]?.transform).toContain('rotate(-7deg)');
  });

  it('pouso: amassa por 120 ms e volta em 220 ms --ease-spring; antena assenta em 360 ms', () => {
    const plan = planFlight({ x: 0, y: 0 }, { x: 400, y: 0 });
    expect(plan.land.fig.duration).toBe(340);
    expect(plan.land.fig.keyframes[1]?.offset).toBeCloseTo(120 / 340, 9);
    expect(plan.land.fig.keyframes[1]?.easing).toBe(EASE_SPRING);
    expect(plan.land.antenna.duration).toBe(360);
  });

  it('keyframes bem formados: offsets crescentes de 0 a 1', () => {
    for (const track of allTracks()) {
      const offs = track.keyframes.map((k) => k.offset);
      expect(offs[0]).toBe(0);
      expect(offs.at(-1)).toBe(1);
      expect([...offs].sort((a, b) => a - b)).toEqual(offs);
    }
  });
});

describe('só transform/opacity no personagem', () => {
  it('nenhum keyframe anima outra propriedade', () => {
    for (const track of allTracks()) {
      for (const k of track.keyframes) {
        const props = Object.keys(k).filter((p) => !['offset', 'easing'].includes(p));
        for (const p of props) expect(['transform', 'translate', 'opacity']).toContain(p);
      }
    }
  });
});

describe('espelho do rig.json', () => {
  const poses = rig.lods['md-48'].poses;
  const norm = (s: string | undefined): string => (s ?? '').replace('rotate(0deg) ', '');
  const plan = planFlight({ x: 0, y: 0 }, { x: 400, y: 0 });

  it('antecipar, esticar, ápice e amassar batem com as poses do rig', () => {
    expect(norm(plan.fig.keyframes[1]?.transform)).toBe(poses.anticipate.layers.fig.transform);
    expect(plan.fig.keyframes[2]?.transform).toBe(poses.stretch.layers.fig.transform);
    expect(plan.fig.keyframes[3]?.transform).toBe(poses.apex.layers.fig.transform);
    expect(norm(plan.fig.keyframes[4]?.transform)).toBe(poses.squash.layers.fig.transform);
  });

  it('antena: −10° na partida, +6° no pouso', () => {
    expect(plan.antenna.keyframes[2]?.transform).toBe(poses.stretch.layers.antenna.transform);
    expect(plan.antenna.keyframes[3]?.transform).toBe(poses.squash.layers.antenna.transform);
  });

  it('sombra: ápice e esticar batem com as poses do rig', () => {
    expect(plan.shadow.keyframes[2]?.transform).toBe(poses.apex.layers.shadow.transform);
    expect(plan.shadow.keyframes[2]?.opacity).toBe(poses.apex.layers.shadow.opacity);
  });

  it('celebrate: agachar, pulo, pouso e sombra no pico batem com as poses (md e 40)', () => {
    const md = planCelebrate('md-48');
    expect(md.fig.keyframes[1]?.transform).toBe(poses.crouch.layers.fig.transform);
    expect(md.fig.keyframes[3]?.transform).toBe(poses.land.layers.fig.transform);
    expect(md.figArc.keyframes[2]?.translate).toBe('0 -6px');
    expect(poses.jump.layers.fig.transform).toBe('translateY(-6px)');
    const peak = md.shadow.keyframes.find((k) => k.transform === 'scale(0.7)');
    expect(peak?.opacity).toBe(poses.jump.layers.shadow.opacity);
    const inline = planCelebrate('inline-40');
    expect(inline.figArc.keyframes[2]?.translate).toBe('0 -5px');
    expect(rig.lods['inline-40'].poses.jump.layers.fig.transform).toBe('translateY(-5px)');
    expect(inline.antenna).toBeNull();
  });
});

describe('demais movimentos', () => {
  it('celebração: 900 ms, olhos felizes seguram +1,2 s, halo 480 ms a partir de 120 ms', () => {
    const c = planCelebrate('md-48');
    expect(c.duration).toBe(900);
    expect(c.holdMs).toBe(1200);
    expect(c.halo).toMatchObject({ duration: 480, delay: 120 });
    expect(c.halo.keyframes[0]).toMatchObject({ transform: 'scale(0.6)', opacity: 0.5 });
    expect(c.halo.keyframes[1]).toMatchObject({ transform: 'scale(1.4)', opacity: 0 });
    expect(c.fig.duration).toBe(900);
  });

  it('respiração: 0 → −1,5 → 0 px, 4,2 s, no máximo 3 ciclos', () => {
    const b = planBreath();
    expect(b.duration).toBe(4200);
    expect(b.iterations).toBe(3);
    expect(b.keyframes.map((k) => k.translate)).toEqual(['0 0px', '0 -1.5px', '0 0px']);
  });

  it('piscar: 140 ms, scaleY .12; intervalo 4–9 s', () => {
    const p = planBlink();
    expect(p.duration).toBe(140);
    expect(p.keyframes[1]?.transform).toBe('scaleY(0.12)');
    expect(blinkDelay(0)).toBe(4000);
    expect(blinkDelay(1)).toBe(9000);
    expect(blinkDelay(7)).toBe(9000);
  });

  it('entrada: 320 ms --ease-spring, opacity 0→1, y −8→0, scale .92→1', () => {
    const e = planEntrance();
    expect(e.duration).toBe(320);
    expect(e.easing).toBe(EASE_SPRING);
    expect(e.keyframes[0]).toMatchObject({ opacity: 0, transform: 'translateY(-8px) scale(0.92)' });
  });

  it('crossfade do movimento reduzido: 160 ms só com opacity', () => {
    const c = planCrossfade();
    expect(c.duration).toBe(160);
    expect(c.keyframes.every((k) => k.transform === undefined && k.opacity !== undefined)).toBe(
      true,
    );
  });

  it('thinking: 1,6 s linear em loop; olhos varrem ±1,5 px', () => {
    const t = planThinking({ x: 0, y: -1.5 });
    expect(t.tip.duration).toBe(1600);
    expect(t.tip.iterations).toBe(Number.POSITIVE_INFINITY);
    expect(t.tip.keyframes[1]?.transform).toBe('scale(1.15)');
    expect(t.eyes.keyframes[0]?.transform).toBe('translate(-1.5px, -1.5px)');
    expect(t.eyes.keyframes[1]?.transform).toBe('translate(1.5px, -1.5px)');
  });
});

describe('bezierProgress', () => {
  it('extremos e monotonia', () => {
    expect(bezierProgress([0.2, 0.8, 0.2, 1], 0)).toBe(0);
    expect(bezierProgress([0.2, 0.8, 0.2, 1], 1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 20; i += 1) {
      const v = bezierProgress([0.2, 0.8, 0.2, 1], i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('--ease é rápida no começo', () => {
    expect(bezierProgress([0.2, 0.8, 0.2, 1], 0.25)).toBeGreaterThan(0.5);
    expect(EASE).toContain('0.8');
  });

  it('clamp', () => {
    expect(clamp(1, 0, 3)).toBe(1);
    expect(clamp(1, 5, 3)).toBe(3);
  });
});
