/**
 * Leads de anúncios da Meta — leitura pura (F69-S03).
 *
 * Duas formas chegam da Meta, e as duas passam por aqui:
 *
 * 1. **A notificação do webhook** (`object: 'page'`, campo `leadgen`): diz *que* um
 *    lead existe — só identificadores, sem nenhuma resposta do formulário.
 * 2. **O lead**, buscado por `leadgen_id`: as respostas em `field_data`
 *    (`{ name, values[] }`) e as caixas de consentimento marcadas em
 *    `custom_disclaimer_responses` (`{ checkbox_key, is_checked }`).
 *
 * Formato verificado na documentação da Meta em 2026-09-15 (Lead Ads — Webhooks e
 * Retrieving). Nada aqui faz rede nem toca banco: é o que permite testar a leitura
 * inteira com os payloads da documentação.
 *
 * ## O que a Meta NÃO entrega, e por que isso importa
 *
 * O lead traz **se** a caixa foi marcada, mas não o **texto** que a pessoa leu ao
 * marcar. Por isso o consentimento vira evidência guardada junto do lead, e não um
 * consentimento de canal registrado automaticamente: registrar "aceitou receber
 * mensagens" sem o texto exibido seria uma afirmação sem prova.
 */

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function texto(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function numero(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return null;
}

/** A notificação: um lead existe. Sem respostas — elas vêm na busca por `leadgenId`. */
export interface LeadgenNotification {
  readonly leadgenId: string;
  readonly pageId: string;
  readonly formId: string | null;
  readonly adId: string | null;
  readonly adgroupId: string | null;
  /** Epoch em segundos, como a Meta envia. */
  readonly createdTime: number | null;
}

/**
 * Extrai as notificações de lead de um corpo de webhook já autenticado.
 *
 * Um mesmo envio pode trazer várias páginas e vários leads. Itens sem `leadgen_id`
 * ou sem página são descartados — sem os dois não há o que buscar nem onde.
 */
export function parseLeadgenWebhook(body: unknown): LeadgenNotification[] {
  if (!isRecord(body) || body['object'] !== 'page') return [];
  const saida: LeadgenNotification[] = [];
  const entradas = Array.isArray(body['entry']) ? body['entry'] : [];
  for (const entry of entradas) {
    if (!isRecord(entry)) continue;
    const mudancas = Array.isArray(entry['changes']) ? entry['changes'] : [];
    for (const change of mudancas) {
      if (!isRecord(change) || change['field'] !== 'leadgen') continue;
      const v = change['value'];
      if (!isRecord(v)) continue;
      const leadgenId = texto(v['leadgen_id']);
      const pageId = texto(v['page_id']) ?? texto(entry['id']);
      if (leadgenId === null || pageId === null) continue;
      saida.push({
        leadgenId,
        pageId,
        formId: texto(v['form_id']),
        adId: texto(v['ad_id']),
        adgroupId: texto(v['adgroup_id']),
        createdTime: numero(v['created_time']),
      });
    }
  }
  return saida;
}

/** Respostas do formulário: nome do campo → valores (a Meta sempre manda lista). */
export type LeadAnswers = Readonly<Record<string, readonly string[]>>;

export interface LeadConsentResponse {
  readonly checkboxKey: string;
  readonly isChecked: boolean;
}

export interface ParsedLead {
  readonly leadgenId: string;
  /** ISO 8601, como a Meta devolve na busca. */
  readonly createdTime: string | null;
  readonly adId: string | null;
  readonly formId: string | null;
  readonly answers: LeadAnswers;
  readonly consent: readonly LeadConsentResponse[];
}

/** Campos pedidos na busca do lead. Uma lista só, usada pelo worker e pela reconciliação. */
export const LEAD_FIELDS = 'id,created_time,ad_id,form_id,field_data,custom_disclaimer_responses' as const;

/** Lê a resposta de `GET /{leadgen_id}` (ou um item de `GET /{form_id}/leads`). */
export function parseLead(body: unknown): ParsedLead | null {
  if (!isRecord(body)) return null;
  const leadgenId = texto(body['id']);
  if (leadgenId === null) return null;

  const answers: Record<string, string[]> = {};
  const campos = Array.isArray(body['field_data']) ? body['field_data'] : [];
  for (const campo of campos) {
    if (!isRecord(campo)) continue;
    const nome = texto(campo['name']);
    if (nome === null) continue;
    const valores = (Array.isArray(campo['values']) ? campo['values'] : [])
      .map(texto)
      .filter((x): x is string => x !== null);
    if (valores.length > 0) answers[nome] = valores;
  }

  const consent: LeadConsentResponse[] = [];
  const respostas = Array.isArray(body['custom_disclaimer_responses'])
    ? body['custom_disclaimer_responses']
    : [];
  for (const r of respostas) {
    if (!isRecord(r)) continue;
    const checkboxKey = texto(r['checkbox_key']);
    if (checkboxKey === null) continue;
    const marcado = r['is_checked'];
    consent.push({ checkboxKey, isChecked: marcado === true || marcado === '1' || marcado === 1 });
  }

  return {
    leadgenId,
    createdTime: texto(body['created_time']),
    adId: texto(body['ad_id']),
    formId: texto(body['form_id']),
    answers,
    consent,
  };
}

/** Termo de consentimento do formulário, como a Meta devolve no cadastro dele. */
export interface FormDisclaimer {
  readonly formName: string | null;
  readonly title: string | null;
  readonly body: string | null;
  /** `checkbox_key` → texto exibido ao lado da caixa. */
  readonly checkboxText: Readonly<Record<string, string>>;
}

/** Campos pedidos no cadastro do formulário para guardar o termo como prova. */
export const FORM_DISCLAIMER_FIELDS =
  'name,legal_content{custom_disclaimer{title,body,checkboxes}}' as const;

/**
 * Lê `GET /{form_id}?fields=name,legal_content{custom_disclaimer{…}}`.
 *
 * A Meta documenta mal este nó: `body` já foi visto como texto e como
 * `{ text, url_entities }`. A leitura aceita os dois e, se não reconhecer, devolve
 * vazio — a falta do texto não pode derrubar a chegada do lead.
 */
export function parseFormDisclaimer(body: unknown): FormDisclaimer {
  const vazio: FormDisclaimer = { formName: null, title: null, body: null, checkboxText: {} };
  if (!isRecord(body)) return vazio;
  const formName = texto(body['name']);
  const legal = body['legal_content'];
  const custom = isRecord(legal) ? legal['custom_disclaimer'] : undefined;
  if (!isRecord(custom)) return { ...vazio, formName };

  const corpo = custom['body'];
  const bodyText = isRecord(corpo) ? texto(corpo['text']) : texto(corpo);

  const checkboxText: Record<string, string> = {};
  const caixas = Array.isArray(custom['checkboxes']) ? custom['checkboxes'] : [];
  for (const c of caixas) {
    if (!isRecord(c)) continue;
    const key = texto(c['key']);
    const t = texto(c['text']);
    if (key !== null && t !== null) checkboxText[key] = t;
  }
  return { formName, title: texto(custom['title']), body: bodyText, checkboxText };
}

/** Nomes padrão de campo dos formulários da Meta. */
const NOME_COMPLETO = ['full_name'];
const PRIMEIRO_NOME = ['first_name'];
const SOBRENOME = ['last_name'];
const EMAIL = ['email', 'work_email'];
const TELEFONE = ['phone_number', 'work_phone_number'];

function primeiro(answers: LeadAnswers, nomes: readonly string[]): string | null {
  for (const n of nomes) {
    const v = answers[n]?.[0];
    if (v !== undefined && v.trim() !== '') return v.trim();
  }
  return null;
}

/** Nome, e-mail e telefone brutos. A normalização do telefone é de quem chama (sabe o mercado). */
export function contactFieldsFrom(answers: LeadAnswers): {
  fullName: string | null;
  email: string | null;
  phone: string | null;
} {
  const completo = primeiro(answers, NOME_COMPLETO);
  const partes = [primeiro(answers, PRIMEIRO_NOME), primeiro(answers, SOBRENOME)].filter(
    (x): x is string => x !== null,
  );
  const email = primeiro(answers, EMAIL);
  return {
    fullName: completo ?? (partes.length > 0 ? partes.join(' ') : null),
    email: email !== null && email.includes('@') ? email.toLowerCase() : null,
    phone: primeiro(answers, TELEFONE),
  };
}

const PADRAO = new Set([...NOME_COMPLETO, ...PRIMEIRO_NOME, ...SOBRENOME, ...EMAIL, ...TELEFONE]);

const ROTULO_PADRAO: Readonly<Record<string, string>> = {
  full_name: 'Nome',
  first_name: 'Nome',
  last_name: 'Sobrenome',
  email: 'E-mail',
  work_email: 'E-mail',
  phone_number: 'Telefone',
  work_phone_number: 'Telefone',
};

/** `tipo_de_obra` → `Tipo de obra`. Legível sem precisar do cadastro do formulário. */
function rotuloDe(nome: string): string {
  const conhecido = ROTULO_PADRAO[nome];
  if (conhecido !== undefined) return conhecido;
  const limpo = nome.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return limpo === '' ? nome : limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/**
 * Resumo das respostas para a conversa na inbox.
 *
 * Campos padrão primeiro, na ordem em que o atendente precisa (quem é, como falar),
 * depois as perguntas do formulário na ordem em que vieram — que é a ordem em que
 * o cliente as montou.
 */
export function answersSummary(answers: LeadAnswers): string {
  const linhas: string[] = ['📝 Lead do formulário do anúncio'];
  const ordem = [...NOME_COMPLETO, ...PRIMEIRO_NOME, ...SOBRENOME, ...TELEFONE, ...EMAIL];
  for (const n of ordem) {
    const v = answers[n];
    if (v !== undefined && v.length > 0) linhas.push(`${rotuloDe(n)}: ${v.join(', ')}`);
  }
  for (const [n, v] of Object.entries(answers)) {
    if (PADRAO.has(n) || v.length === 0) continue;
    linhas.push(`${rotuloDe(n)}: ${v.join(', ')}`);
  }
  return linhas.join('\n');
}

/** Definição de campo do funil — espelha `CustomFieldDef` de `@hm/db` sem depender dele. */
export interface FunnelFieldDef {
  readonly key: string;
  readonly type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'boolean' | 'currency';
  readonly options?: readonly string[];
}

/** Normaliza para comparar chave de pergunta com chave de campo: sem acento, minúsculo, `_`. */
function chave(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function paraNumero(v: string): number | null {
  const limpo = v.replace(/[^\d,.-]/g, '');
  // "1.234,56" (pt-BR) e "1,234.56" (en-US): a vírgula depois do último ponto é decimal.
  const normal =
    limpo.lastIndexOf(',') > limpo.lastIndexOf('.')
      ? limpo.replace(/\./g, '').replace(',', '.')
      : limpo.replace(/,/g, '');
  const n = Number(normal);
  return normal !== '' && Number.isFinite(n) ? n : null;
}

function paraBooleano(v: string): boolean | null {
  const t = chave(v);
  if (['sim', 'yes', 'true', '1', 's', 'y'].includes(t)) return true;
  if (['nao', 'no', 'false', '0', 'n'].includes(t)) return false;
  return null;
}

/**
 * Preenche os campos do funil a partir das respostas, **só onde a chave casa**.
 *
 * O cliente que monta a pergunta `tipo_de_obra` no formulário e tem o campo
 * `tipo_de_obra` no funil vê o card já preenchido. Onde não casa, nada é inventado:
 * a resposta continua no resumo da conversa. Valor que não cabe no tipo do campo
 * (texto num campo numérico, opção fora da lista) é descartado em vez de gravado
 * torto — campo vazio é honesto, campo com lixo engana o funil.
 */
export function customFieldsFrom(
  answers: LeadAnswers,
  defs: readonly FunnelFieldDef[],
): Record<string, string | number | boolean | string[]> {
  const porChave = new Map<string, readonly string[]>();
  for (const [n, v] of Object.entries(answers)) porChave.set(chave(n), v);

  const saida: Record<string, string | number | boolean | string[]> = {};
  for (const def of defs) {
    const valores = porChave.get(chave(def.key));
    const bruto = valores?.[0];
    if (valores === undefined || bruto === undefined) continue;

    switch (def.type) {
      case 'number':
      case 'currency': {
        const n = paraNumero(bruto);
        if (n !== null) saida[def.key] = n;
        break;
      }
      case 'boolean': {
        const b = paraBooleano(bruto);
        if (b !== null) saida[def.key] = b;
        break;
      }
      case 'select': {
        const opcao = def.options?.find((o) => chave(o) === chave(bruto));
        if (opcao !== undefined) saida[def.key] = opcao;
        break;
      }
      case 'multiselect': {
        const escolhidas = valores
          .flatMap((v) => v.split(','))
          .map((v) => def.options?.find((o) => chave(o) === chave(v)))
          .filter((o): o is string => o !== undefined);
        if (escolhidas.length > 0) saida[def.key] = [...new Set(escolhidas)];
        break;
      }
      default:
        saida[def.key] = bruto;
    }
  }
  return saida;
}
