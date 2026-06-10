/** Tipos de canais no frontend (espelham o JSON público de @hm/api — sem segredos). */

import type { ChannelProvider } from '@hm/shared';

export type { ChannelProvider };

/** Canal como devolvido por GET /api/channels (PUBLIC_CHANNEL_COLUMNS). */
export interface Channel {
  id: string;
  provider: ChannelProvider;
  name: string;
  displayHandle: string | null;
  phoneNumber: string | null;
  igUsername: string | null;
  igAccountType: 'business' | 'creator' | null;
  wahaSessionId: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string | null;
}

/** Payload de POST /api/channels/connect — discriminado por provider. */
export type ConnectChannelInput =
  | {
      provider: 'meta_whatsapp';
      name: string;
      displayHandle?: string;
      phoneNumber?: string;
      phoneNumberId: string;
      wabaId: string;
      accessToken: string;
      appSecret?: string;
    }
  | {
      provider: 'meta_instagram';
      name: string;
      displayHandle?: string;
      igUserId: string;
      igUsername?: string;
      igAccountType?: 'business' | 'creator';
      fbPageId: string;
      accessToken: string;
      appSecret?: string;
    }
  | {
      provider: 'waha';
      name: string;
      displayHandle?: string;
      wahaSessionId: string;
      apiKey: string;
    };
