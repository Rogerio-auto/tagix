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
  /**
   * `true` quando há nome de gente (sistema ou perfil). Sem nome, o avatar mostra o
   * ícone de pessoa — nunca um pedaço de número nem `#` (F72-S05).
   */
  named: boolean;
}

export function clean(value: string | null | undefined): string | null {
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

const NAME_PARTICLES = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);

/** Primeira + última palavra significativa (ignora de/da/do/dos/das/e). */
export function initialsOf(text: string): string {
  const words = text
    .replace(/^@/, '')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w !== '');
  const significant = words.filter((w) => !NAME_PARTICLES.has(w.toLocaleLowerCase('pt-BR')));
  const pool = significant.length > 0 ? significant : words;
  const first = pool[0];
  const last = pool[pool.length - 1];
  if (first === undefined || last === undefined) return '?';
  const chars = pool.length === 1 ? [first] : [first, last];
  return chars
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toLocaleUpperCase('pt-BR');
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
    return { label: system, source: 'system', secondary, initials: initialsOf(system), named: true };
  }
  const profile = clean(input.profileName);
  if (profile !== null) {
    return { label: profile, source: 'profile', secondary, initials: initialsOf(profile), named: true };
  }
  return {
    label: fallback,
    source: 'phone',
    secondary,
    // Sem nome, o avatar não mostra pedaço de número: '@' (Instagram), '?' (sem identificador) ou '#' (telefone).
    initials: instagram ? '@' : secondary === null ? '?' : '#',
    named: false,
  };
}

/**
 * Cor do avatar (F72-S05): determinística por contato, a partir de um conjunto fechado
 * de tokens semânticos (nunca hex). Mesma chave → mesma cor, em qualquer tela e sessão.
 * Classes literais para o Tailwind enxergar.
 *
 * Só tons NÃO semânticos: danger/warn/success são estado (erro, alerta, IA ativa) e
 * um avatar vermelho leria como "problema com este contato". Contraste das iniciais
 * (WCAG, calculado de tokens.css; tons /10 compostos sobre --surface e --surface-2):
 *   brand-text/10 — escuro 11,76/10,99 · claro 5,56/5,31
 *   violet/10     — escuro  6,10/5,74  · claro 4,89/4,67
 *   info-bg/info  — escuro  8,20       · claro 5,59
 *   surface-3/text-mid — escuro 10,01  · claro 7,49
 */
export const AVATAR_TONES = [
  'bg-brand-text/10 text-brand-text',
  'bg-violet/10 text-violet',
  'bg-info-bg text-info',
  'bg-surface-3 text-text-mid',
] as const;

export type AvatarTone = (typeof AVATAR_TONES)[number];

/** FNV-1a 32 bits — estável, sem dependência, bem distribuído em strings curtas. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function avatarTone(key: string): AvatarTone {
  const tone = AVATAR_TONES[fnv1a(key) % AVATAR_TONES.length];
  return tone ?? AVATAR_TONES[0];
}

/**
 * Chave da cor do avatar: o contato (id), e na falta dele o identificador no canal.
 * Um único lugar decide — lista, cabeçalho, thread mobile e cockpit pintam a mesma
 * pessoa com a mesma cor.
 */
export function avatarKeyOf(input: {
  contactId?: string | null;
  contact?: { id?: string | null } | null;
  remoteId?: string | null;
}): string {
  return clean(input.contactId) ?? clean(input.contact?.id) ?? clean(input.remoteId) ?? '';
}

export type ChannelFamily = 'whatsapp' | 'instagram';

/**
 * Família do canal de uma conversa, para o selo da lista e o rótulo do contato.
 * Fonte preferida: o provider (`meta_whatsapp` / `waha` / `meta_instagram`). Sem ele,
 * o `kind` só denuncia o canal em threads de comentário/story (sempre Instagram);
 * `direct`/`group` não dizem nada → `null` (nenhum selo; nunca um palpite).
 */
export function channelOf(input: {
  channelProvider?: string | null;
  kind?: string | null;
}): ChannelFamily | null {
  for (const raw of [input.channelProvider, input.kind]) {
    const v = typeof raw === 'string' ? raw.toLowerCase() : '';
    if (v === '') continue;
    if (v.includes('instagram') || v === 'comment_thread' || v === 'story_thread') return 'instagram';
    if (v.includes('whatsapp') || v === 'waha') return 'whatsapp';
  }
  return null;
}
