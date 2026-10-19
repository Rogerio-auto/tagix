// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GREETED_STORAGE_KEY } from './copy';
import {
  BUBBLE_ARRIVAL_DELAY_MS,
  BUBBLE_CONTEXT_DELAY_MS,
  BUBBLE_LIFETIME_MS,
  THINKING_DELAY_MS,
  createDirector,
  describeTarget,
} from './director';
import type { Director, DirectorOptions } from './director';

function memoryStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

/** Elemento cujo `.value` LANÇA: qualquer leitura de valor derruba o teste. */
function poisoned<T extends HTMLElement>(el: T): T {
  for (const prop of ['value', 'valueAsNumber', 'selectionStart', 'selectionEnd', 'checked']) {
    Object.defineProperty(el, prop, {
      configurable: true,
      get() {
        throw new Error(`[privacidade] o diretor leu .${prop}`);
      },
    });
  }
  return el;
}

function field(type: string, tag: 'input' | 'textarea' = 'input'): HTMLElement {
  const el = document.createElement(tag);
  if (tag === 'input') (el as HTMLInputElement).type = type;
  return poisoned(el);
}

const focusIn = (el: Element): void => {
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
};
const focusOut = (el: Element, related: Element | null = null): void => {
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: related }));
};

let root: HTMLElement;
let detach: (() => void) | null = null;
let director: Director;

function setup(options: DirectorOptions = {}): Director {
  director = createDirector({ desktop: true, storage: memoryStorage(), ...options });
  detach = director.attach(root);
  return director;
}

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  document.body.appendChild(root);
  director = createDirector({ desktop: true, storage: memoryStorage() });
});

afterEach(() => {
  detach?.();
  detach = null;
  director.destroy();
  root.remove();
  vi.useRealTimers();
});

describe('privacidade: o diretor nunca lê valor, tecla nem força de senha', () => {
  it('describeTarget com um Proxy que LANÇA em .value lê só tagName, type e isContentEditable', () => {
    const accessed = new Set<string>();
    const stub = { tagName: 'INPUT', type: 'password', isContentEditable: false };
    const proxy = new Proxy(stub, {
      get(target, prop, receiver) {
        if (prop === 'value') throw new Error('[privacidade] leu .value');
        accessed.add(String(prop));
        return Reflect.get(target, prop, receiver);
      },
    });

    expect(describeTarget(proxy)).toEqual({ editable: true, password: true });
    expect([...accessed].sort()).toEqual(['tagName', 'type']);
  });

  it('describeTarget de contenteditable lê isContentEditable e nada mais', () => {
    const accessed: string[] = [];
    const proxy = new Proxy(
      { tagName: 'DIV', isContentEditable: true },
      {
        get(t, p, r) {
          if (p === 'value') throw new Error('leu .value');
          accessed.push(String(p));
          return Reflect.get(t, p, r);
        },
      },
    );
    expect(describeTarget(proxy)).toEqual({ editable: true, password: false });
    expect(accessed).toEqual(['tagName', 'isContentEditable']);
  });

  it('o foco de ponta a ponta numa senha cujo value/checked/seleção lançam não derruba nada', () => {
    setup();
    const pass = field('password');
    root.appendChild(pass);
    expect(() => focusIn(pass)).not.toThrow();
    expect(() => focusOut(pass)).not.toThrow();
    director.signal({ type: 'error', kind: 'validation' });
    director.signal({ type: 'error', kind: 'credentials' });
    director.signal({ type: 'success', final: false });
  });

  it('escuta só focusin, focusout e pointerdown (nunca input, keydown, keyup, beforeinput)', () => {
    const added: string[] = [];
    const spy = vi.spyOn(root, 'addEventListener').mockImplementation((type: string) => {
      added.push(type);
    });
    setup();
    spy.mockRestore();
    expect(added.sort()).toEqual(['focusin', 'focusout', 'pointerdown']);
    for (const banned of ['input', 'keydown', 'keyup', 'keypress', 'beforeinput', 'change']) {
      expect(added).not.toContain(banned);
    }
  });

  it('digitar não muda nada: eventos de teclado e input são ignorados', () => {
    setup();
    const text = field('text');
    root.appendChild(text);
    focusIn(text);
    const before = director.getSnapshot();
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    text.dispatchEvent(new Event('input', { bubbles: true }));
    expect(director.getSnapshot()).toBe(before);
  });

  it('só guarda a chave de saudação no sessionStorage', () => {
    const calls: string[] = [];
    const storage = {
      getItem: () => null,
      setItem: (k: string) => {
        calls.push(k);
      },
    };
    setup({ storage });
    director.setFigureReady(true);
    director.setStep('login');
    director.entered();
    vi.advanceTimersByTime(BUBBLE_ARRIVAL_DELAY_MS);
    expect(calls).toEqual([GREETED_STORAGE_KEY]);
  });
});

describe('foco, posto e estado', () => {
  it('foco num campo de texto leva ao perch, olhando para o formulário', () => {
    setup();
    expect(director.getSnapshot()).toMatchObject({ station: 'heading', look: 'none' });
    const text = field('email');
    root.appendChild(text);
    focusIn(text);
    expect(director.getSnapshot()).toMatchObject({ station: 'perch', look: 'left', typing: true });
    expect(director.getFocusTarget()).toBe(text);
  });

  it('focusin em type=password ⇒ avert; volta a idle no focusout', () => {
    setup();
    const pass = field('password');
    root.appendChild(pass);
    focusIn(pass);
    expect(director.getSnapshot()).toMatchObject({ state: 'avert', look: 'right' });
    focusOut(pass);
    expect(director.getSnapshot().state).toBe('idle');
    expect(director.getSnapshot().typing).toBe(false);
  });

  it('de senha para e-mail: sai do avert; de e-mail para senha: entra sem passar por idle', () => {
    setup();
    const email = field('email');
    const pass = field('password');
    root.append(email, pass);
    focusIn(email);
    focusOut(email, pass);
    focusIn(pass);
    expect(director.getSnapshot().state).toBe('avert');
    focusOut(pass, email);
    focusIn(email);
    expect(director.getSnapshot().state).toBe('idle');
  });

  it('botões, links e checkboxes não são campo: não voam para o perch', () => {
    setup();
    for (const type of ['submit', 'button', 'checkbox', 'radio']) {
      const el = field(type);
      root.appendChild(el);
      focusIn(el);
    }
    const link = document.createElement('a');
    root.appendChild(link);
    focusIn(link);
    expect(director.getSnapshot().station).toBe('heading');
    expect(director.getSnapshot().typing).toBe(false);
  });

  it('textarea e contenteditable contam como campo', () => {
    setup();
    const area = field('', 'textarea');
    root.appendChild(area);
    focusIn(area);
    expect(director.getSnapshot().station).toBe('perch');
  });

  it('no celular o posto é sempre inline e nunca há voo', () => {
    setup({ desktop: false });
    const text = field('text');
    root.appendChild(text);
    director.setFigureReady(true);
    focusIn(text);
    expect(director.getSnapshot()).toMatchObject({
      station: 'inline',
      look: 'none',
      moving: false,
    });
    const pass = field('password');
    root.appendChild(pass);
    focusIn(pass);
    expect(director.getSnapshot().state).toBe('avert');
  });

  it('troca de etapa leva de volta ao título', () => {
    setup();
    director.setStep('signup');
    const text = field('text');
    root.appendChild(text);
    focusIn(text);
    expect(director.getSnapshot().station).toBe('perch');
    director.setStep('signup-sent');
    expect(director.getSnapshot().station).toBe('heading');
  });

  it('voo só existe com a figura montada; o plano de moving termina em landed()', () => {
    setup();
    const text = field('text');
    root.appendChild(text);
    focusIn(text);
    expect(director.getSnapshot().moving).toBe(false);
    director.setFigureReady(true);
    director.setStep('login');
    director.setStep('signup'); // estando em perch seria voo; aqui já está no título
    focusOut(text);
    focusIn(text);
    director.setStep('signup-sent');
    expect(director.getSnapshot().moving).toBe(true);
    director.landed();
    expect(director.getSnapshot().moving).toBe(false);
  });

  it('se ninguém avisar o pouso, o fallback libera o estado', () => {
    setup();
    director.setFigureReady(true);
    director.setStep('login');
    const text = field('text');
    root.appendChild(text);
    focusIn(text);
    expect(director.getSnapshot().moving).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(director.getSnapshot().moving).toBe(false);
  });
});

describe('sinais dos formulários', () => {
  it('thinking só depois de 300 ms de envio pendente', () => {
    setup();
    director.signal({ type: 'submit' });
    vi.advanceTimersByTime(THINKING_DELAY_MS - 1);
    expect(director.getSnapshot().state).toBe('idle');
    vi.advanceTimersByTime(1);
    expect(director.getSnapshot().state).toBe('thinking');
  });

  it('resposta rápida cancela o thinking', () => {
    setup();
    director.signal({ type: 'submit' });
    vi.advanceTimersByTime(100);
    director.signal({ type: 'settled' });
    vi.advanceTimersByTime(1000);
    expect(director.getSnapshot().state).toBe('idle');
  });

  it('thinking sai na hora da resposta', () => {
    setup();
    director.signal({ type: 'submit' });
    vi.advanceTimersByTime(500);
    director.signal({ type: 'settled' });
    expect(director.getSnapshot().state).toBe('idle');
  });

  it('thinking interrompe o avert (foco ainda na senha)', () => {
    setup();
    const pass = field('password');
    root.appendChild(pass);
    focusIn(pass);
    director.signal({ type: 'submit' });
    vi.advanceTimersByTime(THINKING_DELAY_MS);
    expect(director.getSnapshot().state).toBe('thinking');
  });

  it('erro de credencial ou servidor ⇒ confused; fica até o próximo focusin', () => {
    setup();
    director.signal({ type: 'submit' });
    vi.advanceTimersByTime(400);
    director.signal({ type: 'error', kind: 'credentials' });
    expect(director.getSnapshot().state).toBe('confused');
    vi.advanceTimersByTime(5000);
    expect(director.getSnapshot().state).toBe('confused');
    const text = field('email');
    root.appendChild(text);
    focusIn(text);
    expect(director.getSnapshot().state).toBe('idle');
  });

  it('erro de validação não é confused: olha o 1º campo inválido', () => {
    setup();
    const a = field('email');
    const b = field('password');
    b.setAttribute('aria-invalid', 'true');
    root.append(a, b);
    const rev = director.getSnapshot().focusRev;
    director.signal({ type: 'error', kind: 'validation' });
    const snap = director.getSnapshot();
    expect(snap.state).toBe('idle');
    expect(snap.station).toBe('perch');
    expect(snap.focusRev).toBe(rev + 1);
    expect(director.getFocusTarget()).toBe(b);
  });

  it('sucesso ⇒ celebrate; final segura, não final volta a idle no fim', () => {
    setup();
    director.signal({ type: 'success', final: false });
    expect(director.getSnapshot()).toMatchObject({ state: 'celebrate', final: false });
    director.stateEnded('celebrate');
    expect(director.getSnapshot().state).toBe('idle');

    director.signal({ type: 'success', final: true });
    director.stateEnded('celebrate');
    expect(director.getSnapshot()).toMatchObject({ state: 'celebrate', final: true });
  });

  it('sucesso durante o voo espera o pouso para celebrar', () => {
    setup();
    director.setFigureReady(true);
    director.setStep('signup');
    const text = field('text');
    root.appendChild(text);
    focusIn(text);
    director.landed();
    director.setStep('signup-sent');
    expect(director.getSnapshot().moving).toBe(true);
    director.signal({ type: 'success', final: true });
    expect(director.getSnapshot().state).toBe('idle');
    director.landed();
    expect(director.getSnapshot()).toMatchObject({ state: 'celebrate', final: true });
  });

  it('etapas de sucesso final celebram sozinhas; verify-pending pensa; verify-invalid confunde', () => {
    setup();
    director.setStep('verify-pending');
    expect(director.getSnapshot().state).toBe('thinking');
    director.setStep('verify-done');
    expect(director.getSnapshot()).toMatchObject({ state: 'celebrate', final: true });

    const other = createDirector({ desktop: true, storage: memoryStorage() });
    other.setStep('verify-pending');
    other.setStep('verify-invalid');
    expect(other.getSnapshot().state).toBe('confused');
    other.destroy();
  });

  it('o resultado de sucesso dispara a "prova" da ponta', () => {
    setup();
    const before = director.getSnapshot().proofRev;
    director.signal({ type: 'success', final: false });
    expect(director.getSnapshot().proofRev).toBe(before + 1);
  });
});

describe('balão', () => {
  function ready(options: DirectorOptions = {}): Director {
    const d = setup(options);
    d.setFigureReady(true);
    d.entered();
    return d;
  }

  it('chegada: uma vez por sessão, só no login e no cadastro', () => {
    const storage = memoryStorage();
    ready({ storage });
    director.setStep('login');
    expect(director.getSnapshot().bubble).toBeNull();
    vi.advanceTimersByTime(BUBBLE_ARRIVAL_DELAY_MS);
    expect(director.getSnapshot().bubble).toBe('Que bom que voltou.');
    expect(storage.getItem(GREETED_STORAGE_KEY)).toBe('1');

    detach?.();
    director.destroy();
    director = createDirector({ desktop: true, storage });
    detach = director.attach(root);
    director.setFigureReady(true);
    director.entered();
    director.setStep('login');
    vi.advanceTimersByTime(1000);
    expect(director.getSnapshot().bubble).toBeNull();
  });

  it('etapas sem saudação ficam sem balão', () => {
    ready();
    director.setStep('reset-request');
    vi.advanceTimersByTime(2000);
    expect(director.getSnapshot().bubble).toBeNull();
  });

  it('some em 7 s', () => {
    ready();
    director.setStep('signup');
    vi.advanceTimersByTime(BUBBLE_ARRIVAL_DELAY_MS);
    expect(director.getSnapshot().bubble).toBe('Leva poucos minutos.');
    vi.advanceTimersByTime(BUBBLE_LIFETIME_MS);
    expect(director.getSnapshot().bubble).toBeNull();
  });

  it('some no primeiro focusin e no pointerdown', () => {
    ready();
    director.setStep('signup');
    vi.advanceTimersByTime(BUBBLE_ARRIVAL_DELAY_MS);
    const text = field('text');
    root.appendChild(text);
    focusIn(text);
    expect(director.getSnapshot().bubble).toBeNull();

    director.setStep('signup-sent');
    director.landed();
    vi.advanceTimersByTime(BUBBLE_CONTEXT_DELAY_MS + 10);
    expect(director.getSnapshot().bubble).toBe('O link está no seu email.');
    root.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(director.getSnapshot().bubble).toBeNull();
  });

  it('momento contextual: depois do pouso e da celebração, com 120 ms de atraso', () => {
    ready();
    director.setStep('signup');
    const text = field('text');
    root.appendChild(text);
    focusIn(text);
    director.setStep('signup-sent');
    expect(director.getSnapshot().moving).toBe(true);
    vi.advanceTimersByTime(300);
    expect(director.getSnapshot().bubble).toBeNull();
    director.signal({ type: 'success', final: true });
    director.landed();
    vi.advanceTimersByTime(900 + BUBBLE_CONTEXT_DELAY_MS - 1);
    expect(director.getSnapshot().bubble).toBeNull();
    vi.advanceTimersByTime(2);
    expect(director.getSnapshot().bubble).toBe('O link está no seu email.');
  });

  it('teclado virtual aberto esconde o balão', () => {
    ready();
    director.setStep('signup');
    vi.advanceTimersByTime(BUBBLE_ARRIVAL_DELAY_MS);
    expect(director.getSnapshot().bubble).not.toBeNull();
    director.setKeyboardOpen(true);
    expect(director.getSnapshot()).toMatchObject({ bubble: null, keyboardOpen: true });
  });
});
