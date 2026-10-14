/**
 * Texto de espera da fila. "há 12 min" diz alguma coisa; "14:32" obriga a fazer a
 * conta. Os minutos vêm calculados do servidor: o relógio do celular pode estar errado
 * e é justamente este número que decide se alguém para o que está fazendo.
 *
 * Entre número e unidade vai um espaço inquebrável (U+00A0): numa coluna estreita a
 * unidade nunca fica órfã na linha de baixo ("15" numa linha, "min" na outra).
 */
const UNIT_SPACE = '\u00a0';

export function esperaEmTexto(minutos: number): string {
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos}${UNIT_SPACE}min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? `há 1${UNIT_SPACE}dia` : `há ${dias}${UNIT_SPACE}dias`;
}

/** Espera compacta para a coluna mono: "12 min", "2 h", "3 d". */
export function esperaCurta(minutos: number): string {
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `${minutos}${UNIT_SPACE}min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas}${UNIT_SPACE}h`;
  return `${Math.floor(horas / 24)}${UNIT_SPACE}d`;
}
