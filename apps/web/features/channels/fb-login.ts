'use client';

/**
 * SEAM de FB Login (Meta Embedded Signup) — STUB.
 *
 * ⚠️ TODO(F1+): integrar o Facebook JS SDK (`window.FB.login`) + Embedded Signup
 * para WhatsApp/Instagram. O SDK **não está instalado** neste monorepo (nenhum
 * `@anthropic`-style pacote FB no package.json) — por design, não adicionamos a
 * dependência neste slot. Este módulo é o ÚNICO ponto que o resto da feature
 * importa, para que a troca de stub → SDK real seja localizada aqui.
 *
 * Contrato esperado do fluxo real:
 *   1. Carregar o SDK (`https://connect.facebook.net/.../sdk.js`) com o App ID.
 *   2. `FB.login({ config_id, response_type: 'code', ... })` → Embedded Signup.
 *   3. Trocar o `code` por um token de longa duração + obter
 *      phone_number_id / waba_id (WhatsApp) ou ig_user_id / fb_page_id (IG)
 *      via Graph API (idealmente no backend, nunca expondo o app secret).
 *
 * Enquanto o SDK não existe, o wizard cai num modo de entrada manual das
 * credenciais (o usuário cola token + ids obtidos no painel da Meta), que é o
 * mesmo contrato que o backend `POST /api/channels/connect` aceita.
 */

/** Indica se o SDK de FB Login está disponível no ambiente. Hoje: sempre false. */
export function isFbSdkAvailable(): boolean {
  return false;
}

export interface FbLoginResult {
  /** Token de longa duração para o backend cifrar. */
  accessToken: string;
  /** Específicos de WhatsApp Cloud. */
  phoneNumberId?: string;
  wabaId?: string;
  phoneNumber?: string;
  /** Específicos de Instagram Messaging. */
  igUserId?: string;
  igUsername?: string;
  fbPageId?: string;
}

/**
 * Dispara o FB Login. STUB: rejeita com instrução clara para o caller cair no
 * modo manual. Substituir pela chamada real ao `window.FB.login` quando o SDK
 * for adicionado.
 */
export async function startFbLogin(
  _provider: 'meta_whatsapp' | 'meta_instagram',
): Promise<FbLoginResult> {
  throw new Error(
    'FB Login indisponível: SDK não instalado. Use a entrada manual de credenciais.',
  );
}

/** Modo do connect WhatsApp server-side (F39): número novo × coexistência. */
export type WaConnectMode = 'cloud_api' | 'coexistence';

/**
 * Retorno do Embedded Signup do WhatsApp (server-side / Tech Provider).
 *
 * ⚠️ TODO(F39+): no fluxo real, `FB.login({ config_id, response_type: 'code' })`
 * devolve um `code` (authorization code) no callback `authResponse`, e os ids
 * (`phone_number_id`, `waba_id`) chegam via mensagem `postMessage` do iframe do
 * Embedded Signup (evento `WA_EMBEDDED_SIGNUP`). O backend (F39-S01) troca o
 * `code` por um token long-lived — o token NUNCA transita pelo client.
 *
 * SUPOSIÇÃO a validar: os nomes de campo do `postMessage` são
 * `phone_number_id` / `waba_id` (e, na coexistência, o `display_phone_number`).
 */
export interface WaSignupResult {
  /** Authorization `code` do FB Login — o backend troca por token long-lived. */
  code: string;
  /** `phone_number_id` (Graph) do número selecionado no Embedded Signup. */
  phoneNumberId: string;
  /** `waba_id` (Graph) da conta WhatsApp Business. */
  wabaId: string;
  /** Número em formato E.164, quando o Signup o expõe (coexistência). */
  phoneNumber?: string;
}

/**
 * Dispara o Embedded Signup do WhatsApp para o `mode` escolhido. STUB: rejeita
 * com instrução clara para o caller cair no modo manual (colar `code` + ids do
 * painel da Meta). Substituir pela orquestração real `FB.login` + `postMessage`
 * quando o SDK for adicionado.
 */
export async function startWhatsAppSignup(_mode: WaConnectMode): Promise<WaSignupResult> {
  throw new Error(
    'Embedded Signup indisponível: SDK da Meta não instalado. Informe os dados manualmente.',
  );
}
