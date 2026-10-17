/**
 * Variáveis de mensagem do Copiloto (F73-S09): um ÚNICO lugar renderiza o texto que sai para um
 * cliente.
 *
 * Regras (COPILOTO.md §8 R4 — exfiltração para fora):
 * - Allowlist fechada: `{primeiro_nome}`, `{hora}`, `{data}`, `{procedimento}`. Qualquer outra
 *   coisa entre chaves (inclusive `{{1}}` de modelo da Meta, `{telefone}`, `{email}`) é recusada
 *   na validação dos `args`: o modelo não consegue pedir um dado que a ferramenta não oferece.
 * - Cada valor vem do registro DO PRÓPRIO destinatário (nome do contato, compromisso dele). Não
 *   existe variável que leia outro contato: não há como um destinatário receber dado de outro.
 * - Substituição em UMA passada sobre o texto do modelo: um valor que contenha `{hora}` não é
 *   expandido de novo. Valores são saneados (sem caracteres de controle, sem chaves, espaço
 *   colapsado, tamanho limitado): o nome do contato (às vezes escrito pelo próprio contato no
 *   perfil do canal) não injeta quebra de linha nem placeholder.
 * - Variável sem valor para um destinatário NÃO vira texto com buraco: o render falha e o item é
 *   pulado (`skipped_policy`, "sem horário de avaliação").
 *
 * Puro: sem IO.
 */

export const MESSAGE_VARIABLES = ['primeiro_nome', 'hora', 'data', 'procedimento'] as const;
export type MessageVariable = (typeof MESSAGE_VARIABLES)[number];

/** Variáveis que dependem de um compromisso do destinatário. */
export const EVENT_VARIABLES: ReadonlySet<MessageVariable> = new Set([
  'hora',
  'data',
  'procedimento',
]);

/** Motivo legível (para a pessoa) de cada variável faltante. */
export const MISSING_VARIABLE_REASON: Readonly<Record<MessageVariable, string>> = {
  primeiro_nome: 'sem nome cadastrado',
  hora: 'sem horário de avaliação',
  data: 'sem data de compromisso',
  procedimento: 'sem procedimento agendado',
};

const VARIABLE_SET: ReadonlySet<string> = new Set(MESSAGE_VARIABLES);

/** Qualquer trecho entre chaves (sem chaves dentro). */
const BRACED_RE = /\{([^{}]*)\}/gu;
/** Teto de cada valor substituído. */
export const VARIABLE_VALUE_MAX = 80;

export function isMessageVariable(value: string): value is MessageVariable {
  return VARIABLE_SET.has(value);
}

export interface PlaceholderScan {
  /** Variáveis da allowlist usadas, sem repetição, na ordem em que aparecem. */
  readonly used: MessageVariable[];
  /** Trechos entre chaves fora da allowlist (recusados). */
  readonly unknown: string[];
  /** Chave solta (`{` ou `}` sem par): texto ambíguo, recusado. */
  readonly unbalanced: boolean;
}

/** Varre o texto escrito pelo modelo. */
export function scanPlaceholders(text: string): PlaceholderScan {
  const used: MessageVariable[] = [];
  const unknown: string[] = [];
  for (const match of text.matchAll(BRACED_RE)) {
    const name = (match[1] ?? '').trim();
    if (isMessageVariable(name)) {
      if (!used.includes(name)) used.push(name);
    } else {
      unknown.push(name.slice(0, 40));
    }
  }
  const leftover = text.replace(BRACED_RE, '');
  return { used, unknown, unbalanced: /[{}]/u.test(leftover) };
}

/** Saneia um valor vindo do banco antes de entrar na mensagem. `null` = vazio. */
export function sanitizeValue(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const clean = raw
    // Caracteres de controle (inclusive quebra de linha e tab) e chaves viram espaço.
    .replace(/[\p{Cc}\p{Cf}{}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (clean.length === 0) return null;
  return clean.length > VARIABLE_VALUE_MAX ? clean.slice(0, VARIABLE_VALUE_MAX).trim() : clean;
}

/** Primeiro nome a partir do nome de exibição ("Juliana Prado" → "Juliana"). */
export function firstNameOf(displayName: string | null | undefined): string | null {
  const clean = sanitizeValue(displayName);
  if (clean === null) return null;
  const first = clean.split(' ')[0] ?? '';
  return first.length > 0 ? first : null;
}

/** "09:00" no fuso e no idioma do workspace. */
export function formatHour(at: Date, timeZone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  }
}

/** "17/10" no fuso e no idioma do workspace. */
export function formatDay(at: Date, timeZone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, day: '2-digit', month: '2-digit' }).format(
      at,
    );
  } catch {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
    }).format(at);
  }
}

export type VariableValues = Partial<Record<MessageVariable, string | null>>;

export type RenderResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly missing: MessageVariable };

/**
 * Renderiza o texto do modelo com os valores DE UM destinatário, em uma passada. Falha na
 * primeira variável sem valor (o item é pulado; nunca sai mensagem com buraco).
 */
export function renderMessage(text: string, values: VariableValues): RenderResult {
  const found: { missing: MessageVariable | null } = { missing: null };
  const out = text.replace(BRACED_RE, (whole, raw: string) => {
    const name = raw.trim();
    if (!isMessageVariable(name)) return whole;
    const value = sanitizeValue(values[name] ?? null);
    if (value === null) {
      found.missing ??= name;
      return whole;
    }
    return value;
  });
  if (found.missing !== null) return { ok: false, missing: found.missing };
  return { ok: true, text: out };
}
