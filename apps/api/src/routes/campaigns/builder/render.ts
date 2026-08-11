/**
 * Prévia e resolução de variáveis de um modelo aprovado (F58-S06).
 *
 * O usuário escolhe um modelo e vê exatamente o que será enviado — por isso a
 * prévia é montada a partir dos componentes SINCRONIZADOS da Meta, nunca de um
 * texto digitado. Nada aqui interpreta HTML: o retorno é texto puro e estrutura,
 * e quem renderiza (F58-S09) não recebe markup para injetar.
 *
 * Função PURA: mesma entrada, mesma saída. É o mesmo cálculo que o runtime
 * (F58-S12) repete por destinatário — a diferença é só qual contato entra.
 *
 * Semântica de `index` no binding:
 *  - `header`/`body`: o número do placeholder `{{n}}` (1-based, como no modelo).
 *  - `button`: a POSIÇÃO do botão na lista (1-based). A Graph usa índice 0-based
 *    no componente, convertido só na saída.
 */
import type { TemplateBinding } from './contracts';

export interface ContactSample {
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly customFields: Readonly<Record<string, unknown>>;
}

type ComponentName = TemplateBinding['component'];

export type HeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION' | 'UNKNOWN';

export interface PreviewButton {
  /** Posição 1-based, igual à do binding. */
  readonly position: number;
  readonly kind: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'OTHER';
  readonly text: string;
  readonly url: string | null;
  readonly hasVariable: boolean;
}

export interface TemplateVariable {
  readonly component: ComponentName;
  readonly index: number;
  readonly source: TemplateBinding['source'];
  readonly value: string;
}

export interface OutboundTemplateComponent {
  readonly type: ComponentName;
  readonly sub_type?: string;
  readonly index?: string;
  readonly parameters: readonly { readonly type: 'text'; readonly text: string }[];
}

export interface SafeTemplatePreview {
  readonly header: { readonly format: HeaderFormat; readonly text: string | null } | null;
  readonly body: string;
  readonly footer: string | null;
  readonly buttons: readonly PreviewButton[];
  readonly variables: readonly TemplateVariable[];
  readonly outbound: {
    readonly kind: 'template';
    readonly templateName: string;
    readonly languageCode: string;
    readonly components: readonly OutboundTemplateComponent[];
  };
}

export type RenderIssueCode =
  | 'TEMPLATE_COMPONENTS_INVALID'
  | 'VARIABLE_MISSING'
  | 'VARIABLE_UNUSED';

export interface RenderIssue {
  readonly code: RenderIssueCode;
  readonly message: string;
  readonly component?: ComponentName;
  readonly index?: number;
}

export type RenderOutcome =
  | { readonly ok: true; readonly preview: SafeTemplatePreview }
  | { readonly ok: false; readonly issues: readonly RenderIssue[] };

const COMPONENT_LABEL: Readonly<Record<ComponentName, string>> = {
  header: 'cabeçalho',
  body: 'corpo da mensagem',
  button: 'botão',
};

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function headerFormat(value: unknown): HeaderFormat {
  const raw = asText(value)?.toUpperCase();
  return raw === 'TEXT' ||
    raw === 'IMAGE' ||
    raw === 'VIDEO' ||
    raw === 'DOCUMENT' ||
    raw === 'LOCATION'
    ? raw
    : 'UNKNOWN';
}

function buttonKind(value: unknown): PreviewButton['kind'] {
  const raw = asText(value)?.toUpperCase();
  return raw === 'QUICK_REPLY' || raw === 'URL' || raw === 'PHONE_NUMBER' ? raw : 'OTHER';
}

function resolveBinding(binding: TemplateBinding, contact: ContactSample | null): string {
  const source = binding.source;
  if (source.kind === 'fixed') return source.value;
  if (source.kind === 'contact') {
    const value = contact?.[source.field];
    return typeof value === 'string' && value.trim().length > 0 ? value : source.fallback;
  }
  const value = contact?.customFields[source.key];
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return source.fallback;
}

const VARIABLE_RE = /\{\{\s*(\d+)\s*\}\}/gu;

function variableIndexes(text: string): readonly number[] {
  const indexes = new Set<number>();
  for (const match of text.matchAll(VARIABLE_RE)) {
    const index = Number(match[1]);
    if (Number.isInteger(index) && index > 0) indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b);
}

function replaceVariables(text: string, values: ReadonlyMap<number, string>): string {
  return text.replace(VARIABLE_RE, (whole, raw: string) => values.get(Number(raw)) ?? whole);
}

interface ParsedTemplate {
  readonly header: { readonly format: HeaderFormat; readonly text: string | null } | null;
  readonly body: string;
  readonly footer: string | null;
  readonly buttons: readonly PreviewButton[];
}

/** Lê os componentes sincronizados da Meta (`{type:'BODY', text}`, `{type:'BUTTONS', buttons}`). */
export function parseTemplateComponents(components: unknown): ParsedTemplate | null {
  if (!Array.isArray(components)) return null;

  let header: ParsedTemplate['header'] = null;
  let body = '';
  let footer: string | null = null;
  const buttons: PreviewButton[] = [];

  for (const raw of components) {
    const component = asRecord(raw);
    if (!component) continue;
    const type = asText(component['type'])?.toUpperCase();
    const text = asText(component['text']);
    if (type === 'HEADER') {
      header = { format: headerFormat(component['format'] ?? 'TEXT'), text };
    } else if (type === 'BODY' && text !== null) {
      body = text;
    } else if (type === 'FOOTER' && text !== null) {
      footer = text;
    } else if (type === 'BUTTONS' && Array.isArray(component['buttons'])) {
      component['buttons'].forEach((rawButton, position) => {
        const button = asRecord(rawButton);
        if (!button) return;
        const url = asText(button['url']);
        buttons.push({
          position: position + 1,
          kind: buttonKind(button['type']),
          text: asText(button['text']) ?? '',
          url,
          hasVariable: url !== null && variableIndexes(url).length > 0,
        });
      });
    }
  }
  return { header, body, footer, buttons };
}

/** Chaves `component:index` que o modelo exige — a base do "variável sem valor". */
export function requiredVariableKeys(parsed: ParsedTemplate): ReadonlySet<string> {
  const required = new Set<string>();
  for (const index of variableIndexes(parsed.header?.text ?? '')) required.add(`header:${index}`);
  for (const index of variableIndexes(parsed.body)) required.add(`body:${index}`);
  for (const button of parsed.buttons) {
    if (button.hasVariable) required.add(`button:${button.position}`);
  }
  return required;
}

function describe(component: ComponentName, index: number): string {
  return component === 'button'
    ? `botão ${index}`
    : `variável ${index} do ${COMPONENT_LABEL[component]}`;
}

export function renderTemplate(args: {
  readonly name: string;
  readonly language: string;
  readonly components: unknown;
  readonly bindings: readonly TemplateBinding[];
  readonly contact: ContactSample | null;
}): RenderOutcome {
  const parsed = parseTemplateComponents(args.components);
  if (parsed === null) {
    return {
      ok: false,
      issues: [
        {
          code: 'TEMPLATE_COMPONENTS_INVALID',
          message: 'O modelo sincronizado está inválido. Sincronize os modelos novamente.',
        },
      ],
    };
  }

  const required = requiredVariableKeys(parsed);
  const resolved = args.bindings.map((binding) => ({
    ...binding,
    value: resolveBinding(binding, args.contact),
  }));
  const provided = new Map(resolved.map((item) => [`${item.component}:${item.index}`, item]));

  // Todas as pendências de uma vez: o formulário mostra tudo o que falta, em vez
  // de revelar um erro por vez a cada tentativa.
  const issues: RenderIssue[] = [];
  for (const key of required) {
    if (provided.has(key)) continue;
    const [component, index] = key.split(':') as [ComponentName, string];
    issues.push({
      code: 'VARIABLE_MISSING',
      message: `Defina o valor para ${describe(component, Number(index))}.`,
      component,
      index: Number(index),
    });
  }
  for (const [key, item] of provided) {
    if (required.has(key)) continue;
    issues.push({
      code: 'VARIABLE_UNUSED',
      message: `Este modelo não usa ${describe(item.component, item.index)}.`,
      component: item.component,
      index: item.index,
    });
  }
  if (issues.length > 0) return { ok: false, issues };

  const valuesFor = (component: ComponentName): Map<number, string> =>
    new Map(resolved.filter((item) => item.component === component).map((i) => [i.index, i.value]));

  const headerValues = valuesFor('header');
  const buttonValues = valuesFor('button');
  const renderedHeader =
    parsed.header === null
      ? null
      : {
          format: parsed.header.format,
          text: parsed.header.text === null ? null : replaceVariables(parsed.header.text, headerValues),
        };
  const renderedButtons = parsed.buttons.map((button) => ({
    ...button,
    url: button.url === null ? null : replaceVariables(button.url, new Map([[1, buttonValues.get(button.position) ?? '']])),
  }));

  const textComponents = (['header', 'body'] as const)
    .map((component) => ({
      type: component,
      parameters: resolved
        .filter((item) => item.component === component)
        .sort((a, b) => a.index - b.index)
        .map((item) => ({ type: 'text' as const, text: item.value })),
    }))
    .filter((component) => component.parameters.length > 0);

  // Cada botão vira um componente próprio com `sub_type` + `index` 0-based, como
  // a Graph exige. Preservar esses campos até o adapter é contrato do F58-S12.
  const buttonComponents: OutboundTemplateComponent[] = resolved
    .filter((item) => item.component === 'button')
    .sort((a, b) => a.index - b.index)
    .map((item) => {
      const button = parsed.buttons.find((candidate) => candidate.position === item.index);
      return {
        type: 'button' as const,
        sub_type: (button?.kind === 'URL' ? 'url' : 'quick_reply') as string,
        index: String(item.index - 1),
        parameters: [{ type: 'text' as const, text: item.value }],
      };
    });

  return {
    ok: true,
    preview: {
      header: renderedHeader,
      body: replaceVariables(parsed.body, valuesFor('body')),
      footer: parsed.footer,
      buttons: renderedButtons,
      variables: resolved,
      outbound: {
        kind: 'template',
        templateName: args.name,
        languageCode: args.language,
        components: [...textComponents, ...buttonComponents],
      },
    },
  };
}
