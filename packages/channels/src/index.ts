/**
 * @hm/channels — adapters de canais Meta (WhatsApp + Instagram) e WAHA.
 *
 * `IChannelAdapter` é a fronteira: o worker outbound roteia por provider e nunca
 * conhece detalhes da Meta Cloud API. Implementações: F1-S08 (WA), F1.5 (IG),
 * F1-S18 (WAHA).
 */

import type { ChannelProvider } from '@hm/shared';

export interface OutboundText {
  readonly to: string;
  readonly body: string;
}

export interface AdapterCapabilities {
  readonly text: boolean;
  readonly media: boolean;
  readonly template: boolean;
  readonly interactive: boolean;
}

export interface IChannelAdapter {
  readonly provider: ChannelProvider;
  readonly capabilities: AdapterCapabilities;
  sendText(input: OutboundText): Promise<{ providerMessageId: string }>;
}

export const CHANNELS_PKG = '@hm/channels' as const;
