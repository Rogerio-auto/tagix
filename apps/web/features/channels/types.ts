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

/** Modo do connect WhatsApp server-side: número novo (Cloud API) × coexistência. */
export type WaConnectMode = 'cloud_api' | 'coexistence';

/**
 * Payload de POST /api/channels/whatsapp/connect (Embedded Signup server-side).
 * O backend (F39-S01) troca `code` por token long-lived, registra o número com
 * o `pin` e inscreve a WABA no app. Nenhum segredo transita de volta ao client.
 */
export interface WaConnectInput {
  /** `code` do Embedded Signup. Exatamente um entre `code` e `accessToken`. */
  code?: string;
  /** Conector manual: token de acesso já emitido (usuário do sistema). */
  accessToken?: string;
  /** Opcional: a coexistência não o devolve; o servidor resolve pela WABA. */
  phoneNumberId?: string;
  wabaId: string;
  /**
   * PIN de verificação em duas etapas do número (6 dígitos). Obrigatório SÓ na
   * coexistência (número existente). Número novo (cloud_api) não pede PIN.
   */
  pin?: string;
  mode: WaConnectMode;
  name: string;
  phoneNumber?: string;
  displayHandle?: string;
}

/** Conta IG candidata (Page+IGBA) retornada por POST /api/channels/instagram/accounts. */
export interface IgAccountCandidate {
  pageId: string;
  pageName?: string;
  igUserId: string;
  igUsername?: string;
  igAccountType?: 'business' | 'creator';
}

/** Payload de POST /api/channels/instagram/connect (wizard Embedded Signup). */
export interface IgConnectInput {
  /** Conexão Meta do workspace (F69-S02). O token da página é obtido no servidor. */
  connectionId: string;
  name: string;
  pageId: string;
  igUserId: string;
  igUsername?: string;
  igAccountType?: 'business' | 'creator';
  testRecipientIgsid?: string;
}
