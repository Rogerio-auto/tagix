/**
 * Parsing por provider + extração de dicas de roteamento (F1-S04).
 *
 * O parse propriamente dito mora em `@hm/channels` (parsers WA/WAHA puros). Para
 * não acoplar o worker à construção de adapters (que exigem credencial e, logo,
 * resolução prévia de canal — circular), a `InboundParserPort` recebe as funções
 * de parse **injetadas** no composition root. A impl. default (`ChannelInboundParser`)
 * só roteia por provider e aplica o placeholder logged-warn de Instagram.
 *
 * A extração de routing hints é PURA (navega o raw por colchetes, sem `any`) e
 * não depende de `@hm/channels`.
 */
import type { ChannelProvider } from '@hm/shared';
import type { InboundEvent } from '@hm/channels';
import type { Logger } from '@hm/logger';
import type { InboundParserPort, RoutingHints } from './ports';

/** Assinatura dos parsers puros de `@hm/channels` (WA/WAHA). */
export type ProviderParser = (payload: unknown) => InboundEvent[];

/** Parsers injetáveis por provider (default wired no composition root). */
export interface ProviderParsers {
  readonly metaWhatsApp: ProviderParser;
  readonly waha: ProviderParser;
}

// --- Helpers de narrowing (sem `any`) ---

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Parser default: roteia por provider. WA/WAHA delegam aos parsers de
 * `@hm/channels`; IG é placeholder (logged-warn → `[]`, impl. real em F1.5).
 */
export class ChannelInboundParser implements InboundParserPort {
  constructor(
    private readonly parsers: ProviderParsers,
    private readonly logger: Logger,
  ) {}

  parse(provider: ChannelProvider, raw: unknown): InboundEvent[] {
    switch (provider) {
      case 'meta_whatsapp':
        return this.parsers.metaWhatsApp(raw);
      case 'waha':
        return this.parsers.waha(raw);
      case 'meta_instagram':
        // Placeholder F1.5 (INSTAGRAM.md §5): não derruba o pipeline.
        this.logger.warn('inbound: parsing Instagram ainda não implementado (F1.5)', {
          provider,
        });
        return [];
      default:
        return assertNever(provider);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Provider inbound não tratado: ${JSON.stringify(value)}`);
}

/**
 * Extrai do raw o identificador estável do canal de destino, por provider. O
 * consumer DB-owner usa isso para resolver channel→workspace (a borda do
 * webhook publica com workspace NIL — `UNRESOLVED_WORKSPACE_ID`).
 */
export function extractRoutingHints(provider: ChannelProvider, raw: unknown): RoutingHints {
  switch (provider) {
    case 'meta_whatsapp':
      return extractWhatsAppRouting(raw);
    case 'meta_instagram':
      return extractInstagramRouting(raw);
    case 'waha':
      return extractWahaRouting(raw);
    default:
      return assertNever(provider);
  }
}

/** WA: `entry[].changes[].value.metadata.phone_number_id`. */
function extractWhatsAppRouting(raw: unknown): RoutingHints {
  if (!isRecord(raw)) return {};
  for (const entry of asArray(raw['entry'])) {
    if (!isRecord(entry)) continue;
    for (const change of asArray(entry['changes'])) {
      if (!isRecord(change)) continue;
      const value = change['value'];
      if (!isRecord(value)) continue;
      const metadata = value['metadata'];
      const phoneNumberId = isRecord(metadata) ? asString(metadata['phone_number_id']) : undefined;
      if (phoneNumberId !== undefined) return { phoneNumberId };
    }
  }
  return {};
}

/** IG: `entry[].id` é o ig user id do canal de destino. */
function extractInstagramRouting(raw: unknown): RoutingHints {
  if (!isRecord(raw)) return {};
  for (const entry of asArray(raw['entry'])) {
    if (!isRecord(entry)) continue;
    const igUserId = asString(entry['id']);
    if (igUserId !== undefined) return { igUserId };
  }
  return {};
}

/** WAHA: `session` mapeia 1:1 para um canal. */
function extractWahaRouting(raw: unknown): RoutingHints {
  if (!isRecord(raw)) return {};
  const wahaSession = asString(raw['session']);
  return wahaSession !== undefined ? { wahaSession } : {};
}
