'use client';

/**
 * Chime de notificação sintetizado via Web Audio API (F53-S06).
 *
 * Decisão: gerar o som no cliente (oscilador) em vez de empacotar um binário —
 * é local, minúsculo (zero bytes de asset), respeita volume (ganho) e não exige
 * fetch. Um arpejo curto de duas notas (≈220ms), discreto e intencional (§3.10).
 *
 * Autoplay policy: o `AudioContext` só inicia após um gesto do usuário. Como o
 * operador já interagiu com o app, costuma estar liberado; ainda assim toda
 * chamada é defensiva (try/catch) e degrada em silêncio se o navegador bloquear
 * — a notificação visual nunca depende do áudio.
 */

let ctx: AudioContext | null = null;

type WindowWithWebkitAudio = Window &
  typeof globalThis & { webkitAudioContext?: typeof AudioContext };

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const w = window as WindowWithWebkitAudio;
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/** Toca uma nota curta com envelope suave (ataque/decay) no volume dado. */
function tone(audio: AudioContext, freq: number, startAt: number, duration: number, gain: number): void {
  const osc = audio.createOscillator();
  const env = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startAt);
  env.gain.setValueAtTime(0, startAt);
  env.gain.linearRampToValueAtTime(gain, startAt + 0.015);
  env.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(env).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/**
 * Toca o chime no volume `volume` (0–1). Defensivo: nunca lança. Retorna `false`
 * quando o áudio não pôde ser iniciado (sem suporte/bloqueado), permitindo ao
 * chamador saber que só restou o canal visual.
 */
export function playChime(volume: number): boolean {
  const audio = getContext();
  if (!audio) return false;
  const v = Math.min(1, Math.max(0, volume));
  if (v <= 0) return true; // "tocou", mas mudo por escolha do usuário.
  try {
    // Alguns navegadores suspendem o contexto até um gesto; tentar retomar.
    if (audio.state === 'suspended') void audio.resume();
    const now = audio.currentTime;
    const peak = 0.18 * v; // teto baixo: alerta discreto, não estridente.
    tone(audio, 660, now, 0.12, peak); // E5
    tone(audio, 880, now + 0.1, 0.16, peak); // A5
    return true;
  } catch {
    return false;
  }
}
