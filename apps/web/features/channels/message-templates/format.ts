import type {
  CreateTemplateDraft,
  CreateTemplateInput,
  MessageTemplate,
  MessageTemplateCategory,
  MessageTemplateStatus,
} from './types';

export interface TemplateStatusPresentation {
  label: string;
  tone: 'success' | 'warn' | 'danger' | 'neutral';
  guidance: string;
  canUse: boolean;
}

const STATUS: Record<MessageTemplateStatus, TemplateStatusPresentation> = {
  APPROVED: {
    label: 'Aprovado',
    tone: 'success',
    guidance: 'Este modelo já pode ser escolhido em uma campanha.',
    canUse: true,
  },
  PENDING: {
    label: 'Em análise',
    tone: 'warn',
    guidance: 'Aguarde a análise da Meta ou sincronize novamente mais tarde.',
    canUse: false,
  },
  REJECTED: {
    label: 'Precisa de ajustes',
    tone: 'danger',
    guidance: 'Confira o motivo e crie uma nova versão corrigida.',
    canUse: false,
  },
  PAUSED: {
    label: 'Pausado',
    tone: 'warn',
    guidance: 'Confira a orientação da Meta e escolha outro modelo enquanto isso.',
    canUse: false,
  },
  DISABLED: {
    label: 'Desativado',
    tone: 'neutral',
    guidance: 'Escolha outro modelo ou crie uma nova versão.',
    canUse: false,
  },
  IN_APPEAL: {
    label: 'Em reavaliação',
    tone: 'warn',
    guidance: 'Aguarde a reavaliação da Meta e sincronize novamente mais tarde.',
    canUse: false,
  },
  PENDING_DELETION: {
    label: 'Em remoção',
    tone: 'neutral',
    guidance: 'Escolha outro modelo para novas campanhas.',
    canUse: false,
  },
  UNKNOWN: {
    label: 'Status em atualização',
    tone: 'neutral',
    guidance: 'Sincronize novamente. Se persistir, escolha outro modelo.',
    canUse: false,
  },
};

const CATEGORY: Record<MessageTemplateCategory, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Serviço',
  AUTHENTICATION: 'Autenticação',
  UNKNOWN: 'Outra categoria',
};

const LANGUAGE: Record<string, string> = {
  pt_BR: 'Português (Brasil)',
  pt_PT: 'Português (Portugal)',
  en_US: 'Inglês (Estados Unidos)',
  es: 'Espanhol',
  es_ES: 'Espanhol (Espanha)',
};

function knownStatus(value: string): MessageTemplateStatus {
  return Object.prototype.hasOwnProperty.call(STATUS, value)
    ? (value as MessageTemplateStatus)
    : 'UNKNOWN';
}

function knownCategory(value: string): MessageTemplateCategory {
  return Object.prototype.hasOwnProperty.call(CATEGORY, value)
    ? (value as MessageTemplateCategory)
    : 'UNKNOWN';
}

export function templateStatus(template: Pick<MessageTemplate, 'status' | 'isAvailable'>): TemplateStatusPresentation {
  if (!template.isAvailable) {
    return {
      label: 'Não disponível',
      tone: 'neutral',
      guidance: 'Sincronize novamente ou substitua este modelo nas campanhas em rascunho.',
      canUse: false,
    };
  }
  return STATUS[knownStatus(template.status)];
}

export function categoryLabel(value: string): string {
  return CATEGORY[knownCategory(value)];
}

export function languageLabel(value: string): string {
  return LANGUAGE[value] ?? value.replace('_', '-');
}

export function displayTemplateName(value: string): string {
  const words = value.replaceAll('_', ' ').trim();
  return words.length === 0 ? 'Modelo sem nome' : words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatDateTime(value: string | null): string {
  if (!value) return 'Ainda não sincronizado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Horário indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function variableNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function variableError(text: string, maxVariables?: number): string | undefined {
  const variables = variableNumbers(text);
  const residue = text.replace(/\{\{\d+\}\}/g, '');
  if (residue.includes('{{') || residue.includes('}}')) return 'Use variáveis no formato {{1}}, {{2}}.';
  if (variables.some((value, index) => value !== index + 1)) return 'Numere as variáveis em ordem, começando por {{1}}.';
  if (maxVariables !== undefined && variables.length > maxVariables) return `Use no máximo ${maxVariables} variável neste campo.`;
  return undefined;
}

export type DraftErrors = Partial<Record<'name' | 'language' | 'header' | 'headerExample' | 'body' | 'bodyExamples' | 'footer' | 'buttons', string>>;

export function validateDraft(draft: CreateTemplateDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!/^[a-z0-9_]{1,512}$/.test(draft.name)) errors.name = 'Use apenas letras minúsculas, números e sublinhado.';
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(draft.language)) errors.language = 'Informe um idioma válido, como pt_BR.';
  if (!draft.body.trim()) errors.body = 'Escreva a mensagem principal.';
  else if (draft.body.length > 1024) errors.body = 'A mensagem pode ter até 1.024 caracteres.';
  else errors.body = variableError(draft.body);
  if (draft.header.length > 60) errors.header = 'O cabeçalho pode ter até 60 caracteres.';
  else errors.header = variableError(draft.header, 1);
  if (draft.footer.length > 60) errors.footer = 'O rodapé pode ter até 60 caracteres.';
  else if (variableNumbers(draft.footer).length > 0) errors.footer = 'O rodapé não pode ter variáveis.';
  const headerVariables = variableNumbers(draft.header);
  if (headerVariables.length > 0 && !draft.headerExample.trim()) errors.headerExample = 'Dê um exemplo para a variável do cabeçalho.';
  const bodyVariables = variableNumbers(draft.body);
  if (bodyVariables.length > 0 && bodyVariables.some((_, index) => !draft.bodyExamples[index]?.trim())) {
    errors.bodyExamples = 'Preencha um exemplo para cada variável da mensagem.';
  }
  for (const button of draft.buttons) {
    if (!button.text.trim() || button.text.length > 25) {
      errors.buttons = 'Cada botão precisa de um texto com até 25 caracteres.';
      break;
    }
    if (button.type === 'URL') {
      const candidate = button.value.replace('{{1}}', 'exemplo');
      try {
        const url = new URL(candidate);
        if (url.protocol !== 'https:' || (button.value.includes('{{1}}') && !button.value.endsWith('{{1}}'))) {
          errors.buttons = 'Use uma URL HTTPS; a variável {{1}}, quando usada, deve ficar no final.';
        }
      } catch {
        errors.buttons = 'Informe uma URL HTTPS válida.';
      }
      if (button.value.includes('{{1}}') && !button.example.trim()) errors.buttons = 'Dê um exemplo para a variável da URL.';
    }
    if (button.type === 'PHONE_NUMBER' && !/^\+[1-9]\d{6,14}$/.test(button.value)) {
      errors.buttons = 'Informe o telefone do botão no formato internacional, como +5511999999999.';
    }
  }
  return Object.fromEntries(Object.entries(errors).filter(([, value]) => value !== undefined));
}

export function draftToInput(draft: CreateTemplateDraft): CreateTemplateInput {
  const components: Record<string, unknown>[] = [];
  if (draft.header.trim()) {
    const headerVariables = variableNumbers(draft.header);
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: draft.header.trim(),
      ...(headerVariables.length > 0 ? { example: { header_text: [draft.headerExample.trim()] } } : {}),
    });
  }
  const bodyVariables = variableNumbers(draft.body);
  components.push({
    type: 'BODY',
    text: draft.body.trim(),
    ...(bodyVariables.length > 0
      ? { example: { body_text: [draft.bodyExamples.slice(0, bodyVariables.length).map((value) => value.trim())] } }
      : {}),
  });
  if (draft.footer.trim()) components.push({ type: 'FOOTER', text: draft.footer.trim() });
  if (draft.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: draft.buttons.map((button) => ({
        type: button.type,
        text: button.text.trim(),
        ...(button.type === 'URL'
          ? { url: button.value.trim(), ...(button.value.includes('{{1}}') ? { example: [button.example.trim()] } : {}) }
          : {}),
        ...(button.type === 'PHONE_NUMBER' ? { phone_number: button.value.trim() } : {}),
      })),
    });
  }
  return {
    name: draft.name.trim(),
    language: draft.language.trim(),
    category: draft.category,
    components,
  };
}

export interface SafeComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS' | 'UNKNOWN';
  text?: string;
  format?: string;
  buttons?: { type: string; text: string; value?: string }[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function safeComponents(components: unknown[]): SafeComponent[] {
  return components.map((candidate) => {
    const value = record(candidate);
    if (!value) return { type: 'UNKNOWN' };
    const type = value['type'];
    if (type === 'HEADER' || type === 'BODY' || type === 'FOOTER') {
      return {
        type,
        ...(typeof value['text'] === 'string' ? { text: value['text'] } : {}),
        ...(typeof value['format'] === 'string' ? { format: value['format'] } : {}),
      };
    }
    if (type === 'BUTTONS' && Array.isArray(value['buttons'])) {
      const buttons = value['buttons'].flatMap((item) => {
        const button = record(item);
        if (!button || typeof button['text'] !== 'string') return [];
        const rawValue = button['url'] ?? button['phone_number'];
        return [{
          type: typeof button['type'] === 'string' ? button['type'] : 'BUTTON',
          text: button['text'],
          ...(typeof rawValue === 'string' ? { value: rawValue } : {}),
        }];
      });
      return { type: 'BUTTONS', buttons };
    }
    return { type: 'UNKNOWN' };
  });
}

export function previewText(text: string, examples: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (token, raw: string) => examples[Number(raw) - 1]?.trim() || token);
}
