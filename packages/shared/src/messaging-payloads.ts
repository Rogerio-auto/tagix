/**
 * Payloads de mensagens "ricas" outbound (F45 — RICH_COMPOSER.md §1–§2):
 * localização, contato e reação. Fonte única de verdade dos schemas Zod
 * consumidos pela rota HTTP (`POST /api/conversations/:id/messages`), pelo job
 * outbound (`apps/workers`) e — indiretamente — pelos serializers da borda Meta.
 *
 * Toda input externa é validada AQUI (lat/long em range, telefone, emoji único).
 * Os schemas granulares (`latitudeSchema` etc.) são reexportados para o job
 * outbound compor a sua `discriminatedUnion` sem redefinir as regras.
 */
import { z } from 'zod';

// --- Limites (anti-abuso; alinhados às restrições da WhatsApp Cloud API) ---
const NAME_MAX = 512;
const ADDRESS_MAX = 1024;
const PHONE_MIN = 4;
const PHONE_MAX = 20;
const MAX_PHONES_PER_CONTACT = 10;
const MAX_EMAILS_PER_CONTACT = 10;
const MAX_CONTACTS = 10;
const EMOJI_MAX_CODEPOINTS = 12;
const EMOJI_MAX_LEN = 64;

// --- Localização ---

/** Latitude válida (graus decimais). */
export const latitudeSchema = z.number().min(-90).max(90);
/** Longitude válida (graus decimais). */
export const longitudeSchema = z.number().min(-180).max(180);

/**
 * Localização enviável: `{ longitude, latitude, name?, address? }` (shape Graph).
 * `name`/`address` são opcionais e apenas decorativos.
 */
export const locationPayloadSchema = z
  .object({
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    name: z.string().trim().min(1).max(NAME_MAX).optional(),
    address: z.string().trim().min(1).max(ADDRESS_MAX).optional(),
  })
  .strip();

export type LocationPayload = z.infer<typeof locationPayloadSchema>;

// --- Contato ---

/**
 * Telefone de um cartão de contato. Formato lenient (a Graph aceita números
 * formatados), mas exige começar com `+`/dígito e conter só dígitos/separadores.
 */
export const contactPhoneSchema = z
  .string()
  .trim()
  .min(PHONE_MIN)
  .max(PHONE_MAX)
  .regex(/^[+\d][\d\s().-]*$/u, 'Telefone inválido.');

/** Um cartão de contato (`{ name, phones[], emails? }`). */
export const contactCardSchema = z
  .object({
    name: z.string().trim().min(1).max(NAME_MAX),
    phones: z.array(contactPhoneSchema).min(1).max(MAX_PHONES_PER_CONTACT),
    emails: z.array(z.string().trim().email().max(NAME_MAX)).max(MAX_EMAILS_PER_CONTACT).optional(),
  })
  .strip();

export type ContactCard = z.infer<typeof contactCardSchema>;

/** Payload de envio de contato(s): `{ contacts:[…] }`. */
export const contactsPayloadSchema = z
  .object({
    contacts: z.array(contactCardSchema).min(1).max(MAX_CONTACTS),
  })
  .strip();

export type ContactsPayload = z.infer<typeof contactsPayloadSchema>;

// --- Reação ---

/**
 * Aceita string vazia (`''` remove a reação) OU um único emoji — incluindo
 * sequências ZWJ (família), bandeiras (regional indicators) e skin-tone
 * modifiers. Rejeita texto comum, espaços e cadeias longas.
 */
function isReactionEmoji(value: string): boolean {
  if (value === '') return true; // remove a reação
  if (/\s/u.test(value)) return false;
  if (/[A-Za-z0-9]/u.test(value)) return false;
  const codepoints = [...value];
  if (codepoints.length === 0 || codepoints.length > EMOJI_MAX_CODEPOINTS) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value);
}

/** Emoji de reação: único, ou `''` para remover. */
export const reactionEmojiSchema = z
  .string()
  .max(EMOJI_MAX_LEN)
  .refine(isReactionEmoji, {
    message: 'Emoji inválido (envie um único emoji ou string vazia para remover).',
  });

/**
 * Reação a uma mensagem-alvo. `targetMessageId` é o id INTERNO (uuid) da
 * mensagem na timeline — a rota resolve o `external_id` correspondente sob RLS
 * (nunca aceita o `external_id` direto do cliente, evitando vazamento cross-tenant).
 */
export const reactionPayloadSchema = z
  .object({
    targetMessageId: z.string().uuid(),
    emoji: reactionEmojiSchema,
  })
  .strip();

export type ReactionPayload = z.infer<typeof reactionPayloadSchema>;
