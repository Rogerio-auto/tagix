/**
 * Fuso da janela de horário comercial do nó `condition` (F72-S07, regra F59-S08).
 *
 * Nenhum fuso literal: o padrão é o do NAVEGADOR (quem monta o flow costuma estar no fuso do
 * negócio) e, se o runtime não informar um válido, o padrão do market pack — o mesmo
 * critério do editor de campanhas (`browserTimeZone(MARKET_DEFAULT_TIMEZONE)`). A lista do
 * seletor vem do próprio runtime (`Intl.supportedValuesOf`), não de um catálogo escrito à mão.
 *
 * Módulo puro (só `Intl`), testado isolado.
 */
import { getMarketPack } from '@hm/shared';
import { uiLocale } from '@/shared/lib/locale';

/** Fuso padrão do mercado quando o navegador não informa um válido. */
export const MARKET_DEFAULT_TIMEZONE = getMarketPack('BR').defaultTimezone;

/** `true` se o runtime reconhece o identificador IANA. */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Fuso do navegador, ou `fallback` quando o runtime não informa um válido. */
export function browserTimeZone(fallback: string): string {
  try {
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimeZone(tz) ? tz : fallback;
  } catch {
    return fallback;
  }
}

/** Fuso efetivo da janela: o salvo no nó (se válido) ou o padrão do navegador/mercado. */
export function effectiveTimeZone(saved: string | undefined): string {
  return saved && isValidTimeZone(saved) ? saved : browserTimeZone(MARKET_DEFAULT_TIMEZONE);
}

/** Todos os fusos IANA do runtime (vazio se o runtime não listar). */
export function allTimeZones(): readonly string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

/** Deslocamento em vigor agora ("GMT-3"), no idioma da interface. */
export function offsetLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat(uiLocale(), { timeZone, timeZoneName: 'shortOffset' }).formatToParts(at);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** "Sao Paulo (GMT-3)" — cidade-sede legível + deslocamento. */
export function timeZoneOptionLabel(timeZone: string, at: Date = new Date()): string {
  const city = (timeZone.split('/').pop() ?? timeZone).replace(/_/gu, ' ');
  const region = timeZone.includes('/') ? timeZone.split('/')[0] : undefined;
  const offset = offsetLabel(timeZone, at);
  const place = region && region !== city ? `${city} · ${region}` : city;
  return offset ? `${place} (${offset})` : place;
}

export interface TimeZoneOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Opções do seletor: o fuso atual e o sugerido (navegador/mercado) primeiro, depois todos
 * os do runtime, sem repetir. O atual entra mesmo se o runtime não o listar (dado legado).
 */
export function timeZoneOptions(current: string, at: Date = new Date()): {
  suggested: TimeZoneOption[];
  all: TimeZoneOption[];
} {
  const suggestedIds = [...new Set([current, browserTimeZone(MARKET_DEFAULT_TIMEZONE), MARKET_DEFAULT_TIMEZONE])];
  const suggested = suggestedIds.map((value) => ({ value, label: timeZoneOptionLabel(value, at) }));
  const seen = new Set(suggestedIds);
  const runtime = allTimeZones();
  // UTC fica disponível mesmo quando o runtime só lista fusos geográficos.
  const ids = runtime.includes('UTC') ? runtime : [...runtime, 'UTC'];
  const all = ids
    .filter((tz) => !seen.has(tz))
    .map((value) => ({ value, label: timeZoneOptionLabel(value, at) }));
  return { suggested, all };
}
