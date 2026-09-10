/**
 * Prévia honesta do público antes de importar (F58-S08).
 *
 * ## Por que a prévia precisa existir
 *
 * Sem ela, o cliente cola uma lista, aperta importar, e descobre o tamanho real
 * do público **depois** — às vezes só quando a campanha já saiu para menos gente
 * do que ele achava, ou para mais. A prévia troca uma surpresa cara por uma
 * conferência barata.
 *
 * ## Cinco categorias, porque são cinco decisões diferentes
 *
 * | Categoria | O que o cliente faz com isso |
 * |---|---|
 * | válido | nada, vai receber |
 * | telefone inválido | corrige a planilha |
 * | repetido no arquivo | ignora, já está contado uma vez |
 * | já está na campanha | nada, reimportar não duplica |
 * | sem consentimento | decide se registra a origem ou tira da lista |
 *
 * Juntar "inválido" com "repetido" pouparia uma linha de código e custaria a
 * decisão: são erros de naturezas diferentes, e só um é problema do arquivo.
 */

/** Mesma regra do servidor (`isE164` em `routes/campaigns/recipients.ts`). */
const E164 = /^\+[1-9]\d{6,14}$/;

export function isE164(phone: string): boolean {
  return E164.test(phone.trim());
}

/**
 * Tamanho do número NACIONAL (sem DDI) por país.
 *
 * Brasil: DDD (2) + assinante (8 fixo ou 9 celular). EUA/Canadá: NPA + NXX +
 * linha (10).
 *
 * Este comprimento não é decoração: sem ele, `5551234` — um número local
 * americano de sete dígitos — passaria como se já tivesse DDI brasileiro, porque
 * começa com "55" e tem sete dígitos, o bastante para o formato E.164 aceitar.
 * O resultado seria um "+5551234" que parece válido, entra no público, e falha
 * (ou pior, entrega para outra pessoa) só na hora do envio.
 */
const TAMANHO_NACIONAL: Readonly<Record<'55' | '1', readonly number[]>> = {
  '55': [10, 11],
  '1': [10],
};

/**
 * Tenta transformar um número digitado por humano em E.164.
 *
 * Deliberadamente conservador: só normaliza o que dá para afirmar. `(66)
 * 99934-2444` num workspace brasileiro é claramente +55; `5551234` não é nada, e
 * chutar um DDI transformaria um erro visível num envio para o número errado —
 * que custa dinheiro e reputação de remetente.
 */
export function normalizePhone(bruto: string, defaultCountry: '55' | '1'): string | null {
  const limpo = bruto.trim();
  if (limpo === '') return null;
  // Já veio em E.164 explícito (com `+`): confiar no que o cliente afirmou, mesmo
  // que seja de outro país — uma lista pode ter contatos fora do mercado do
  // workspace, e recusá-los aqui seria pior que aceitá-los.
  if (limpo.startsWith('+') && isE164(limpo)) return limpo;

  const digitos = limpo.replace(/[^0-9]/g, '');
  if (digitos === '') return null;

  const nacionais = TAMANHO_NACIONAL[defaultCountry];

  // Veio com o DDI, só sem o `+`. Exige que o RESTO tenha tamanho de número
  // nacional — senão qualquer sequência começando com o DDI viraria telefone.
  if (digitos.startsWith(defaultCountry)) {
    const resto = digitos.slice(defaultCountry.length);
    const candidato = `+${digitos}`;
    if (nacionais.includes(resto.length) && isE164(candidato)) return candidato;
  }

  // Número nacional puro, sem DDI.
  if (nacionais.includes(digitos.length)) {
    const candidato = `+${defaultCountry}${digitos}`;
    if (isE164(candidato)) return candidato;
  }

  return null;
}

export type RowVerdict =
  | 'valido'
  | 'telefone_invalido'
  | 'repetido_no_arquivo'
  | 'ja_na_campanha'
  | 'sem_consentimento';

export interface ClassifiedRow {
  /** Como veio no arquivo — é o que o cliente procura na planilha dele. */
  readonly original: string;
  /** E.164 quando deu para normalizar. */
  readonly phone: string | null;
  readonly name: string | null;
  readonly verdict: RowVerdict;
}

export interface AudiencePreview {
  readonly rows: readonly ClassifiedRow[];
  readonly counts: Readonly<Record<RowVerdict, number>>;
  /** Quantos de fato vão receber. É o número que decide o envio. */
  readonly willReceive: number;
}

export interface ClassifyInput {
  /** Linhas já lidas do CSV: telefone bruto, nome e consentimento declarado. */
  readonly rows: ReadonlyArray<{ phone: string; name?: string; consent?: boolean }>;
  readonly defaultCountry: '55' | '1';
  /** Telefones já vinculados a esta campanha. */
  readonly alreadyInCampaign?: ReadonlySet<string>;
  /**
   * Exigir consentimento registrado.
   *
   * Vem do market pack (`getOutboundPolicy`): nos EUA marketing exige
   * consentimento prévio; no Brasil, em canais já em uso, não. Fixar `true` aqui
   * bloquearia o cliente brasileiro sem base legal; fixar `false` deixaria o
   * cliente americano exposto.
   */
  readonly requireConsent: boolean;
}

const VAZIO: Record<RowVerdict, number> = {
  valido: 0,
  telefone_invalido: 0,
  repetido_no_arquivo: 0,
  ja_na_campanha: 0,
  sem_consentimento: 0,
};

export function classifyAudience(input: ClassifyInput): AudiencePreview {
  const vistos = new Set<string>();
  const contagem: Record<RowVerdict, number> = { ...VAZIO };
  const rows: ClassifiedRow[] = [];

  for (const bruta of input.rows) {
    const original = bruta.phone.trim();
    const phone = normalizePhone(original, input.defaultCountry);
    const name = bruta.name?.trim() ?? null;

    let verdict: RowVerdict;
    if (phone === null) {
      verdict = 'telefone_invalido';
    } else if (vistos.has(phone)) {
      verdict = 'repetido_no_arquivo';
    } else if (input.alreadyInCampaign?.has(phone) === true) {
      vistos.add(phone);
      verdict = 'ja_na_campanha';
    } else if (input.requireConsent && bruta.consent !== true) {
      vistos.add(phone);
      verdict = 'sem_consentimento';
    } else {
      vistos.add(phone);
      verdict = 'valido';
    }

    contagem[verdict] += 1;
    rows.push({ original, phone, name: name === '' ? null : name, verdict });
  }

  return { rows, counts: contagem, willReceive: contagem.valido };
}

/** Rótulo de cada categoria, em linguagem de dono. */
export const VERDICT_LABEL: Readonly<Record<RowVerdict, string>> = {
  valido: 'Vão receber',
  telefone_invalido: 'Telefone inválido',
  repetido_no_arquivo: 'Repetido no arquivo',
  ja_na_campanha: 'Já estavam nesta campanha',
  sem_consentimento: 'Sem consentimento registrado',
};

/** O que fazer a respeito — um estado sem próxima ação é um beco sem saída. */
export const VERDICT_HINT: Readonly<Record<RowVerdict, string>> = {
  valido: '',
  telefone_invalido: 'Confira o número na sua planilha e importe de novo.',
  repetido_no_arquivo: 'Contamos uma vez só. Não precisa fazer nada.',
  ja_na_campanha: 'Reimportar não duplica ninguém. Não precisa fazer nada.',
  sem_consentimento:
    'Registre de onde veio o consentimento, ou tire estas pessoas da lista antes de enviar.',
};
