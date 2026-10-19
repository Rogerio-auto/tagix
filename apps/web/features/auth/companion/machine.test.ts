import { describe, expect, it } from 'vitest';
import { INITIAL_MODEL, isHeld, reduce } from './machine';
import type { MachineEvent, MachineModel } from './machine';
import type { MascotState } from './contract';

const run = (events: MachineEvent[], from: MachineModel = INITIAL_MODEL): MachineModel =>
  events.reduce(reduce, from);
const req = (state: MascotState, final?: boolean): MachineEvent => ({
  type: 'request',
  state,
  ...(final !== undefined && { final }),
});
const end = (state: MascotState): MachineEvent => ({ type: 'end', state });
const release = (state: MascotState): MachineEvent => ({ type: 'release', state });

describe('máquina de estados do companheiro', () => {
  it('começa em idle, sem fila', () => {
    expect(INITIAL_MODEL).toMatchObject({ current: 'idle', queued: null, final: false });
  });

  it('um pedido em idle toca na hora', () => {
    expect(run([req('avert')]).current).toBe('avert');
  });

  it('estado com fim volta a idle quando a figura avisa o fim', () => {
    const m = run([req('celebrate'), end('celebrate')]);
    expect(m.current).toBe('idle');
  });

  it('o aviso de fim de outro estado não encerra o atual', () => {
    expect(run([req('celebrate'), end('blink')]).current).toBe('celebrate');
  });

  it('fila de 1: o pedido enquanto algo toca espera e o novo substitui o antigo', () => {
    const m = run([req('confused'), req('celebrate'), req('avert')]);
    expect(m.current).toBe('confused');
    expect(m.queued).toBe('avert');
  });

  it('ao soltar o estado atual, o da fila entra; sem fila, volta a idle', () => {
    const m = run([req('confused'), req('avert'), release('confused')]);
    expect(m.current).toBe('avert');
    expect(m.queued).toBeNull();
    expect(run([req('avert'), release('avert')]).current).toBe('idle');
  });

  it('thinking interrompe qualquer estado e descarta a fila', () => {
    const m = run([req('celebrate'), req('avert'), req('thinking')]);
    expect(m.current).toBe('thinking');
    expect(m.queued).toBeNull();
  });

  it('thinking é seguro: não termina por end, só por release', () => {
    const m = run([req('thinking'), end('thinking')]);
    expect(m.current).toBe('thinking');
    expect(isHeld(m)).toBe(true);
    expect(run([req('thinking'), release('thinking')]).current).toBe('idle');
  });

  it('avert e confused seguram até o release', () => {
    expect(run([req('avert'), end('avert')]).current).toBe('avert');
    expect(run([req('confused'), end('confused')]).current).toBe('confused');
  });

  it('blink não entra na fila e cede a qualquer pedido', () => {
    expect(run([req('avert'), req('blink')]).queued).toBeNull();
    expect(run([req('blink'), req('avert')]).current).toBe('avert');
  });

  it('pedir o estado que já toca não muda nada', () => {
    const m = run([req('avert')]);
    expect(reduce(m, req('avert'))).toBe(m);
  });

  it('soltar o que está só na fila tira da fila', () => {
    const m = run([req('confused'), req('avert'), release('avert')]);
    expect(m.current).toBe('confused');
    expect(m.queued).toBeNull();
  });

  it('celebrate final segura para sempre; sem final volta a idle', () => {
    const fin = run([req('celebrate', true), end('celebrate')]);
    expect(fin.current).toBe('celebrate');
    expect(fin.final).toBe(true);
    expect(isHeld(fin)).toBe(true);
    expect(run([req('celebrate', false), end('celebrate')]).current).toBe('idle');
  });

  it('marcar final durante a celebração só marca que ela fica', () => {
    const m = run([req('celebrate'), req('celebrate', true), end('celebrate')]);
    expect(m.current).toBe('celebrate');
  });

  it('celebrate final na fila mantém a marca quando entra', () => {
    const m = run([req('confused'), req('celebrate', true), release('confused')]);
    expect(m).toMatchObject({ current: 'celebrate', final: true });
  });
});
