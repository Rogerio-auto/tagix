/**
 * Rótulo de exibição do contato na inbox (F70-S37).
 *
 * Hierarquia: nome salvo no sistema → nome do perfil (WhatsApp/Instagram) → telefone
 * formatado. Nunca o id cru do canal. Função pura — um único lugar decide, a lista, o
 * cabeçalho e o cockpit só consomem.
 */

export type ContactLabelSource = 'system' | 'profile' | 'phone';

export interface ContactLabelInput {
  displayName?: string | null;
  profileName?: string | null;
  /** Identificador do contato no canal (telefone no WhatsApp, IGSID/@usuario no Instagram). */
  remoteId: string;
  /** `kind`/provider da conversa: 'whatsapp', 'instagram', 'meta_instagram'… */
  channel?: string | null;
}

export interface ContactLabel {
  /** Texto principal: nome ou, sem nome nenhum, o telefone formatado. */
  label: string;
  source: ContactLabelSource;
  /** Telefone/identificador legível para conferência (null quando não há como formatar). */
  secondary: string | null;
  /** Iniciais do avatar (até 2 letras). */
  initials: string;
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().replace(/\s+/g, ' ');
  return t === '' ? null : t;
}

function isInstagram(channel: string | null | undefined): boolean {
  return typeof channel === 'string' && channel.toLowerCase().includes('instagram');
}

/** `+55 (69) 99967-0030`; +1 → `+1 (305) 555-0142`; demais países: `+` + dígitos (E.164). */
export function formatPhoneIntl(raw: string | null | undefined): string | null {
  const bruto = clean(raw);
  if (bruto === null) return null;
  const d = bruto.replace(/\D/g, '');
  if (d === '') return null;

  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const nsn = d.slice(2);
    const ddd = nsn.slice(0, 2);
    const resto = nsn.slice(2);
    const corte = resto.length - 4;
    return `+55 (${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`;
  }
  if (d.startsWith('1') && d.length === 11) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  return `+${d}`;
}

function looksLikePhone(remoteId: string): boolean {
  const d = remoteId.replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 && /^[+\d\s().-]+$/.test(remoteId);
}

export function initialsOf(text: string): string {
  const words = text
    .replace(/^@/, '')
    .split(/\s+/)
    .map((w) => Array.from(w.replace(/[^\p{L}\p{N}]/gu, ''))[0])
    .filter((c): c is string => typeof c === 'string' && c !== '');
  if (words.length === 0) return '?';
  return words.slice(0, 2).join('').toLocaleUpperCase('pt-BR');
}

export function contactLabel(input: ContactLabelInput): ContactLabel {
  const remoteId = clean(input.remoteId) ?? '';
  const instagram = isInstagram(input.channel);

  let secondary: string | null;
  let fallback: string;
  if (instagram) {
    secondary = remoteId.startsWith('@') && remoteId.length > 1 ? remoteId : null;
    fallback = secondary ?? 'Contato do Instagram';
  } else {
    secondary = looksLikePhone(remoteId) ? formatPhoneIntl(remoteId) : null;
    fallback = secondary ?? 'Contato sem número';
  }

  const system = clean(input.displayName);
  if (system !== null) {
    return { label: system, source: 'system', secondary, initials: initialsOf(system) };
  }
  const profile = clean(input.profileName);
  if (profile !== null) {
    return { label: profile, source: 'profile', secondary, initials: initialsOf(profile) };
  }
  return {
    label: fallback,
    source: 'phone',
    secondary,
    // Sem nome, o avatar não mostra pedaço de número: ícone neutro via "?".
    initials: instagram ? '@' : secondary === null ? '?' : '#',
  };
}
