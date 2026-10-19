import { ARRIVAL_BUBBLE, CONTEXT_BUBBLE, GREETED_STORAGE_KEY } from './copy';
import type {
  AuthStep,
  CompanionSignal,
  CompanionStation,
  MascotLook,
  MascotState,
} from './contract';
import { INITIAL_MODEL, reduce } from './machine';
import type { MachineEvent, MachineModel } from './machine';

/**
 * Diretor do companheiro (F76-S11): traduz foco e sinais dos formulários em
 * `{ posto, estado, olhar, balão }`.
 *
 * PRIVACIDADE (ADR-006 §9, SPEC §7) — regra dura, coberta por teste:
 * - Escuta SÓ `focusin`/`focusout` (e `pointerdown`, que não lê nada do evento) na raiz.
 * - Do alvo lê apenas `tagName`, `type`, `isContentEditable` e, depois, a posição via
 *   `getBoundingClientRect()` (feita pela figura). NUNCA `.value`, `.checked`, `.files`,
 *   seleção, nem `input`/`keydown`/`keyup`/`beforeinput`.
 * - Não existe `lastKeyAt`: para pausar a respiração "enquanto digita" o motor usa um
 *   sinal ainda mais grosseiro e sem teclado, "há um campo editável focado" (`typing`).
 *   Zero listeners de teclado; o ADR permite esta alternativa.
 * - Zero rede, zero telemetria. A única coisa guardada é `GREETED_STORAGE_KEY`.
 */

export interface DirectorSnapshot {
  readonly station: CompanionStation;
  readonly state: MascotState;
  readonly look: MascotLook;
  /** `celebrate` e a tela de sucesso fica (pose final). */
  readonly final: boolean;
  /** Texto do balão visível, ou `null`. */
  readonly bubble: string | null;
  /** Muda a cada balão novo (reinicia a animação mesmo com o mesmo texto). */
  readonly bubbleSeq: number;
  /** Incrementa a cada foco em campo (o `perch` desliza até ele). */
  readonly focusRev: number;
  /** Incrementa quando o resultado chega com sucesso (a "prova" da ponta). */
  readonly proofRev: number;
  /** Há um voo em andamento ou pendente. */
  readonly moving: boolean;
  /** Um campo editável tem o foco (pausa a respiração). */
  readonly typing: boolean;
  /** Teclado virtual aberto: esconde o balão e congela a respiração. */
  readonly keyboardOpen: boolean;
}

export interface Director {
  getSnapshot(): DirectorSnapshot;
  subscribe(listener: () => void): () => void;
  /** Liga `focusin`/`focusout`/`pointerdown` na raiz. Devolve o desligamento. */
  attach(root: HTMLElement): () => void;
  signal(s: CompanionSignal): void;
  setStep(step: AuthStep): void;
  setDesktop(desktop: boolean): void;
  setKeyboardOpen(open: boolean): void;
  /** A figura foi montada (voos passam a existir). */
  setFigureReady(ready: boolean): void;
  /** A animação de entrada terminou (libera o balão de chegada). */
  entered(): void;
  /** O voo (ou reposição) terminou. */
  landed(): void;
  /** A figura terminou a animação do estado `s`. */
  stateEnded(s: MascotState): void;
  /** Último campo editável focado (a figura mede a posição dele). Nunca o valor. */
  getFocusTarget(): Element | null;
  destroy(): void;
}

export interface DirectorOptions {
  desktop?: boolean;
  /** Injetável em teste; padrão `window.sessionStorage` (com try/catch). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
}

export const THINKING_DELAY_MS = 300;
export const BUBBLE_ARRIVAL_DELAY_MS = 200;
export const BUBBLE_CONTEXT_DELAY_MS = 120;
export const BUBBLE_LIFETIME_MS = 7000;
const MOVING_FALLBACK_MS = 1600;
const CELEBRATE_MS = 900;

/* ----------------------------- leitura do alvo ----------------------------- */

export interface TargetInfo {
  readonly editable: boolean;
  readonly password: boolean;
}

const NON_TEXT_INPUT: ReadonlySet<string> = new Set([
  'button',
  'submit',
  'reset',
  'checkbox',
  'radio',
  'image',
  'file',
  'range',
  'color',
  'hidden',
]);

/**
 * Lê do alvo SÓ o que a política permite: `tagName`, `type` e `isContentEditable`.
 * Estrutural de propósito (sem `instanceof`) para o teste poder passar um Proxy que
 * LANÇA ao tocar `.value`. Devolve `null` se não é um elemento.
 */
export function describeTarget(target: unknown): TargetInfo | null {
  if (typeof target !== 'object' || target === null) return null;
  const el = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown };
  const tag = el.tagName;
  if (typeof tag !== 'string') return null;
  if (tag === 'INPUT') {
    const type = typeof el.type === 'string' ? el.type.toLowerCase() : 'text';
    return { editable: !NON_TEXT_INPUT.has(type), password: type === 'password' };
  }
  if (tag === 'TEXTAREA' || tag === 'SELECT') return { editable: true, password: false };
  return { editable: el.isContentEditable === true, password: false };
}

/* --------------------------------- diretor --------------------------------- */

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const SUCCESS_STEPS: ReadonlySet<AuthStep> = new Set(['verify-done', 'reset-done', 'invite-done']);

export function createDirector(options: DirectorOptions = {}): Director {
  const now = options.now ?? (() => Date.now());
  const storage = options.storage === undefined ? safeStorage() : options.storage;

  let desktop = options.desktop ?? true;
  let perched = false;
  let model: MachineModel = INITIAL_MODEL;
  let focusEl: Element | null = null;
  let step: AuthStep | null = null;

  let figureReady = false;
  let isEntered = false;
  let moving = false;
  let bubble: string | null = null;
  let bubbleSeq = 0;
  let focusRev = 0;
  let proofRev = 0;
  let typing = false;
  let keyboardOpen = false;
  let celebrateUntil = 0;

  let pendingSuccess: { final: boolean } | null = null;
  let pendingArrival: string | null = null;
  let pendingContext: { step: AuthStep; text: string } | null = null;
  const contextShown = new Set<AuthStep>();

  let thinkingTimer: ReturnType<typeof setTimeout> | null = null;
  let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let movingTimer: ReturnType<typeof setTimeout> | null = null;

  const listeners = new Set<() => void>();
  let snap: DirectorSnapshot = build();

  function station(): CompanionStation {
    if (!desktop) return 'inline';
    return perched ? 'perch' : 'heading';
  }

  function build(): DirectorSnapshot {
    const state = model.current;
    return {
      station: station(),
      state,
      look: state === 'avert' ? 'right' : desktop && perched ? 'left' : 'none',
      final: model.final,
      bubble: keyboardOpen ? null : bubble,
      bubbleSeq,
      focusRev,
      proofRev,
      moving,
      typing,
      keyboardOpen,
    };
  }

  function commit(): void {
    const next = build();
    let changed = false;
    for (const key of Object.keys(next) as Array<keyof DirectorSnapshot>) {
      if (next[key] !== snap[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    snap = next;
    for (const fn of [...listeners]) fn();
  }

  function dispatch(event: MachineEvent): void {
    model = reduce(model, event);
  }

  function clear(t: ReturnType<typeof setTimeout> | null): null {
    if (t !== null) clearTimeout(t);
    return null;
  }

  /* ------------------------------ movimento ------------------------------ */

  function startMoving(): void {
    if (!figureReady || !desktop) return;
    moving = true;
    movingTimer = clear(movingTimer);
    movingTimer = setTimeout(() => api.landed(), MOVING_FALLBACK_MS);
  }

  function setPerched(next: boolean): void {
    if (perched === next) return;
    perched = next;
    startMoving();
  }

  /* -------------------------------- balão -------------------------------- */

  function hideBubble(): void {
    hideTimer = clear(hideTimer);
    bubble = null;
  }

  function showBubble(text: string): void {
    if (keyboardOpen) return;
    bubble = text;
    bubbleSeq += 1;
    hideTimer = clear(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hideBubble();
      commit();
    }, BUBBLE_LIFETIME_MS);
  }

  function markGreeted(): void {
    try {
      storage?.setItem(GREETED_STORAGE_KEY, '1');
    } catch {
      /* armazenamento indisponível: a saudação só pode repetir, nada quebra */
    }
  }

  function wasGreeted(): boolean {
    try {
      return storage?.getItem(GREETED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function scheduleBubble(): void {
    bubbleTimer = clear(bubbleTimer);
    if (moving || !figureReady || !isEntered) return;
    if (pendingArrival !== null) {
      const text = pendingArrival;
      bubbleTimer = setTimeout(() => {
        bubbleTimer = null;
        if (pendingArrival !== text) return;
        pendingArrival = null;
        markGreeted();
        showBubble(text);
        commit();
      }, BUBBLE_ARRIVAL_DELAY_MS);
      return;
    }
    if (pendingContext !== null) {
      const { step: forStep, text } = pendingContext;
      const wait = Math.max(0, celebrateUntil - now()) + BUBBLE_CONTEXT_DELAY_MS;
      bubbleTimer = setTimeout(() => {
        bubbleTimer = null;
        pendingContext = null;
        contextShown.add(forStep);
        showBubble(text);
        commit();
      }, wait);
    }
  }

  /* -------------------------------- sucesso ------------------------------- */

  function applySuccess(final: boolean): void {
    thinkingTimer = clear(thinkingTimer);
    dispatch({ type: 'release', state: 'thinking' });
    dispatch({ type: 'request', state: 'celebrate', final });
    celebrateUntil = now() + CELEBRATE_MS;
  }

  function onSuccess(final: boolean): void {
    proofRev += 1;
    if (moving) {
      pendingSuccess = { final };
      return;
    }
    applySuccess(final);
    scheduleBubble();
  }

  /* ------------------------------- sinais -------------------------------- */

  function onSignal(s: CompanionSignal): void {
    switch (s.type) {
      case 'submit': {
        thinkingTimer = clear(thinkingTimer);
        thinkingTimer = setTimeout(() => {
          thinkingTimer = null;
          dispatch({ type: 'request', state: 'thinking' });
          commit();
        }, THINKING_DELAY_MS);
        break;
      }
      case 'settled': {
        thinkingTimer = clear(thinkingTimer);
        dispatch({ type: 'release', state: 'thinking' });
        break;
      }
      case 'error': {
        thinkingTimer = clear(thinkingTimer);
        dispatch({ type: 'release', state: 'thinking' });
        if (s.kind === 'validation') {
          // Olha o 1º campo inválido: só lê o atributo `aria-invalid`, nunca o valor.
          const invalid = invalidField();
          if (invalid !== null && desktop) {
            focusEl = invalid;
            focusRev += 1;
            setPerched(true);
          }
        } else {
          dispatch({ type: 'request', state: 'confused' });
        }
        break;
      }
      case 'success':
        onSuccess(s.final);
        break;
    }
  }

  let rootRef: HTMLElement | null = null;
  function invalidField(): Element | null {
    return rootRef?.querySelector('[aria-invalid="true"]') ?? null;
  }

  /* -------------------------------- etapas -------------------------------- */

  function onStep(next: AuthStep): void {
    if (step === next) return;
    const previous = step;
    step = next;

    if (previous === 'verify-pending') dispatch({ type: 'release', state: 'thinking' });
    if (previous === 'verify-invalid') dispatch({ type: 'release', state: 'confused' });
    pendingSuccess = null;

    // Troca de etapa: de volta ao título (o voo é do posto, não do estado).
    if (previous !== null) {
      dispatch({ type: 'release', state: 'avert' });
      typing = false;
      setPerched(false);
    }

    if (previous === null) {
      const arrival = ARRIVAL_BUBBLE[next];
      pendingArrival = arrival !== undefined && !wasGreeted() ? arrival : null;
    }
    const context = CONTEXT_BUBBLE[next];
    pendingContext =
      context !== undefined && !contextShown.has(next) ? { step: next, text: context } : null;
    if (previous !== null) hideBubble();

    if (next === 'verify-pending') dispatch({ type: 'request', state: 'thinking' });
    else if (next === 'verify-invalid') dispatch({ type: 'request', state: 'confused' });
    else if (SUCCESS_STEPS.has(next)) onSuccess(true);

    scheduleBubble();
  }

  /* ---------------------------- eventos de foco --------------------------- */

  function onFocusIn(e: Event): void {
    dispatch({ type: 'release', state: 'confused' });
    hideBubble();
    pendingArrival = null;
    if (pendingContext === null) bubbleTimer = clear(bubbleTimer);

    const info = describeTarget(e.target);
    if (info !== null && info.editable) {
      focusEl = e.target as Element;
      typing = true;
      focusRev += 1;
      setPerched(desktop);
      if (info.password) dispatch({ type: 'request', state: 'avert' });
      else dispatch({ type: 'release', state: 'avert' });
    } else {
      typing = false;
      dispatch({ type: 'release', state: 'avert' });
    }
    commit();
  }

  function onFocusOut(e: Event): void {
    hideBubble();
    const next = describeTarget((e as FocusEvent).relatedTarget);
    if (next !== null && next.editable) {
      // O `focusin` seguinte decide `avert`; evita o vai-e-volta entre campos.
      if (!next.password) dispatch({ type: 'release', state: 'avert' });
    } else {
      typing = false;
      dispatch({ type: 'release', state: 'avert' });
    }
    commit();
  }

  function onPointerDown(): void {
    if (bubble === null) return;
    hideBubble();
    commit();
  }

  /* --------------------------------- API ---------------------------------- */

  const api: Director = {
    getSnapshot: () => snap,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    attach(root) {
      rootRef = root;
      root.addEventListener('focusin', onFocusIn);
      root.addEventListener('focusout', onFocusOut);
      root.addEventListener('pointerdown', onPointerDown);
      return () => {
        root.removeEventListener('focusin', onFocusIn);
        root.removeEventListener('focusout', onFocusOut);
        root.removeEventListener('pointerdown', onPointerDown);
        if (rootRef === root) rootRef = null;
      };
    },
    signal(s) {
      onSignal(s);
      commit();
    },
    setStep(next) {
      onStep(next);
      commit();
    },
    setDesktop(next) {
      if (desktop === next) return;
      desktop = next;
      if (!next) {
        perched = false;
        moving = false;
        movingTimer = clear(movingTimer);
      }
      commit();
    },
    setKeyboardOpen(open) {
      if (keyboardOpen === open) return;
      keyboardOpen = open;
      commit();
    },
    setFigureReady(ready) {
      figureReady = ready;
      if (!ready) {
        isEntered = false;
        moving = false;
      }
      commit();
    },
    entered() {
      isEntered = true;
      scheduleBubble();
      commit();
    },
    landed() {
      movingTimer = clear(movingTimer);
      if (!moving && pendingSuccess === null) return;
      moving = false;
      if (pendingSuccess !== null) {
        const { final } = pendingSuccess;
        pendingSuccess = null;
        applySuccess(final);
      }
      scheduleBubble();
      commit();
    },
    stateEnded(s) {
      dispatch({ type: 'end', state: s });
      commit();
    },
    getFocusTarget: () => focusEl,
    destroy() {
      thinkingTimer = clear(thinkingTimer);
      bubbleTimer = clear(bubbleTimer);
      hideTimer = clear(hideTimer);
      movingTimer = clear(movingTimer);
      listeners.clear();
    },
  };

  return api;
}
