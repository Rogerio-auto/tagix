'use client';

/**
 * SEAM de FB Login (Meta Embedded Signup) — IMPLEMENTAÇÃO REAL.
 *
 * Carrega o Facebook JS SDK sob demanda e orquestra o WhatsApp Embedded Signup
 * (popup de 1 clique). Este módulo é o ÚNICO ponto que o resto da feature
 * importa, mantendo a integração com a Meta isolada aqui.
 *
 * Contrato do fluxo real (WhatsApp Cloud / Tech Provider):
 *   1. Carregar o SDK (`https://connect.facebook.net/en_US/sdk.js`) e
 *      `FB.init({ appId, version: 'v23.0' })`.
 *   2. `FB.login(cb, { config_id, response_type: 'code', ... })` abre o popup do
 *      Embedded Signup. O `cb` recebe o **authorization code** em
 *      `response.authResponse.code`.
 *   3. Em paralelo, o iframe do Signup emite `postMessage` (`WA_EMBEDDED_SIGNUP`)
 *      com `phone_number_id` / `waba_id` (e o número, na coexistência).
 *   4. O backend (`POST /api/channels/whatsapp/connect`) troca o `code` por um
 *      token long-lived — o token NUNCA transita pelo client.
 *
 * Configuração via env build-time (NEXT_PUBLIC_*):
 *   - `NEXT_PUBLIC_META_APP_ID`     → `FB.init({ appId })`
 *   - `NEXT_PUBLIC_META_CONFIG_ID`  → `FB.login({ config_id })` (Embedded Signup)
 * Sem essas envs, `isFbSdkAvailable()` → false e o wizard mantém a entrada manual.
 */

const FB_SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';
const FB_GRAPH_VERSION = 'v23.0';

/** Origens confiáveis das mensagens `postMessage` do Embedded Signup. */
const TRUSTED_MESSAGE_ORIGINS = ['https://www.facebook.com', 'https://web.facebook.com'] as const;

const META_APP_ID = process.env['NEXT_PUBLIC_META_APP_ID'];
const META_CONFIG_ID = process.env['NEXT_PUBLIC_META_CONFIG_ID'];

// ---------------------------------------------------------------------------
// Tipos mínimos do SDK do Facebook (declarados localmente — zero `any`).
// ---------------------------------------------------------------------------

interface FbAuthResponse {
  /** Authorization code (quando `response_type: 'code'`). */
  code?: string;
  accessToken?: string;
  userID?: string;
}

interface FbLoginResponse {
  status: 'connected' | 'not_authorized' | 'unknown';
  authResponse: FbAuthResponse | null;
}

interface FbLoginOptions {
  config_id?: string;
  response_type?: 'code' | 'token';
  override_default_response_type?: boolean;
  scope?: string;
  extras?: Record<string, unknown>;
}

interface FbInitParams {
  appId: string;
  autoLogAppEvents?: boolean;
  xfbml?: boolean;
  version: string;
}

interface FbSdk {
  init(params: FbInitParams): void;
  login(callback: (response: FbLoginResponse) => void, options?: FbLoginOptions): void;
}

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

// ---------------------------------------------------------------------------
// Carregamento idempotente do SDK + init.
// ---------------------------------------------------------------------------

let sdkPromise: Promise<FbSdk> | null = null;

/** Indica se o Embedded Signup está configurado (envs presentes) e no browser. */
export function isFbSdkAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof META_APP_ID === 'string' &&
    META_APP_ID.length > 0 &&
    typeof META_CONFIG_ID === 'string' &&
    META_CONFIG_ID.length > 0
  );
}

/** Carrega o `<script>` do SDK uma única vez e resolve com `window.FB` já inicializado. */
function loadFbSdk(): Promise<FbSdk> {
  if (!isFbSdkAvailable() || typeof META_APP_ID !== 'string') {
    return Promise.reject(new Error('Meta App ID/Config ID não configurados.'));
  }
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    const init = (): void => {
      const fb = window.FB;
      if (!fb) {
        reject(new Error('SDK do Facebook não carregou.'));
        return;
      }
      fb.init({ appId: META_APP_ID, autoLogAppEvents: true, xfbml: false, version: FB_GRAPH_VERSION });
      resolve(fb);
    };

    // Já carregado (HMR / navegação prévia): apenas inicializa.
    if (window.FB) {
      init();
      return;
    }

    const existing = document.getElementById('facebook-jssdk');
    if (existing) {
      // Script presente mas ainda carregando: aguarda o hook do SDK.
      window.fbAsyncInit = init;
      return;
    }

    window.fbAsyncInit = init;
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = FB_SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error('Não foi possível carregar o SDK da Meta.'));
    };
    document.body.appendChild(script);
  });

  return sdkPromise;
}

// ---------------------------------------------------------------------------
// FB Login genérico (Instagram Messaging — fluxo baseado em token).
// ---------------------------------------------------------------------------

/** Escopos do FB Login para listar Páginas + contas IG vinculadas (Instagram). */
const IG_LOGIN_SCOPE =
  'pages_show_list,pages_manage_metadata,instagram_basic,instagram_manage_messages,business_management';

export interface FbLoginResult {
  /** Token de usuário (curta duração) — o backend troca/persiste com segurança. */
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
 * Dispara o FB Login clássico (token) para o Instagram Messaging. Resolve com o
 * `accessToken` do usuário; o caller usa-o para listar Páginas/contas IG.
 * Rejeita com mensagem clara em cancelamento → o caller cai no modo manual.
 */
export async function startFbLogin(
  provider: 'meta_whatsapp' | 'meta_instagram',
): Promise<FbLoginResult> {
  const fb = await loadFbSdk();

  return new Promise<FbLoginResult>((resolve, reject) => {
    fb.login(
      (response) => {
        const token = response.authResponse?.accessToken;
        if (response.status !== 'connected' || !token) {
          reject(new Error('Login da Meta cancelado ou não autorizado.'));
          return;
        }
        resolve({ accessToken: token });
      },
      provider === 'meta_instagram' ? { scope: IG_LOGIN_SCOPE } : undefined,
    );
  });
}

// ---------------------------------------------------------------------------
// Embedded Signup do WhatsApp.
// ---------------------------------------------------------------------------

/** Modo do connect WhatsApp server-side: número novo × coexistência. */
export type WaConnectMode = 'cloud_api' | 'coexistence';

/**
 * Retorno do Embedded Signup do WhatsApp.
 *
 * O `code` vem do callback de `FB.login`; os ids chegam via `postMessage`
 * (`WA_EMBEDDED_SIGNUP`). Combinamos os dois antes de resolver a Promise.
 *
 * SUPOSIÇÃO a validar com o popup real: os campos do `data` do `postMessage`
 * são `phone_number_id` / `waba_id` e, na coexistência, um campo de número
 * (`display_phone_number` / `phone_number`).
 */
export interface WaSignupResult {
  /** Authorization `code` — o backend troca por token long-lived. */
  code: string;
  /** `phone_number_id` (Graph) do número selecionado. */
  phoneNumberId: string;
  /** `waba_id` (Graph) da conta WhatsApp Business. */
  wabaId: string;
  /** Número em formato E.164, quando o Signup o expõe (coexistência). */
  phoneNumber?: string;
}

interface EmbeddedSignupPayload {
  phoneNumberId?: string;
  wabaId?: string;
  phoneNumber?: string;
}

/** Narrowing seguro do `data` do `postMessage` do Embedded Signup (`unknown`). */
function parseEmbeddedSignupMessage(raw: unknown): EmbeddedSignupPayload | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  if (record['type'] !== 'WA_EMBEDDED_SIGNUP') return null;

  const data = record['data'];
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;

  const phoneNumberId = typeof d['phone_number_id'] === 'string' ? d['phone_number_id'] : undefined;
  const wabaId = typeof d['waba_id'] === 'string' ? d['waba_id'] : undefined;
  const phoneNumberRaw = d['display_phone_number'] ?? d['phone_number'];
  const phoneNumber = typeof phoneNumberRaw === 'string' ? phoneNumberRaw : undefined;

  return { phoneNumberId, wabaId, phoneNumber };
}

/**
 * Dispara o Embedded Signup do WhatsApp para o `mode` escolhido. Abre o popup da
 * Meta via `FB.login`, captura o `code` (callback) + os ids (`postMessage`) e
 * resolve com `WaSignupResult`. Rejeita com mensagem clara em cancelamento/erro
 * — o caller cai no fallback manual.
 */
export async function startWhatsAppSignup(mode: WaConnectMode): Promise<WaSignupResult> {
  if (typeof META_CONFIG_ID !== 'string') {
    throw new Error('Embedded Signup não configurado (Config ID ausente).');
  }

  const fb = await loadFbSdk();

  return new Promise<WaSignupResult>((resolve, reject) => {
    let captured: EmbeddedSignupPayload = {};
    let settled = false;

    const cleanup = (): void => {
      window.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent): void => {
      if (!TRUSTED_MESSAGE_ORIGINS.includes(event.origin as (typeof TRUSTED_MESSAGE_ORIGINS)[number])) {
        return;
      }
      const payload = parseEmbeddedSignupMessage(event.data);
      if (!payload) return;
      captured = {
        phoneNumberId: payload.phoneNumberId ?? captured.phoneNumberId,
        wabaId: payload.wabaId ?? captured.wabaId,
        phoneNumber: payload.phoneNumber ?? captured.phoneNumber,
      };
    };

    window.addEventListener('message', onMessage);

    fb.login(
      (response) => {
        if (settled) return;
        settled = true;
        cleanup();

        const code = response.authResponse?.code;
        if (response.status !== 'connected' || !code) {
          reject(new Error('Login da Meta cancelado ou não autorizado.'));
          return;
        }
        if (!captured.phoneNumberId || !captured.wabaId) {
          reject(
            new Error(
              'Embedded Signup não retornou o número e a conta. Tente novamente ou informe os dados manualmente.',
            ),
          );
          return;
        }

        resolve({
          code,
          phoneNumberId: captured.phoneNumberId,
          wabaId: captured.wabaId,
          phoneNumber: captured.phoneNumber,
        });
      },
      {
        config_id: META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: mode === 'coexistence' ? 'whatsapp_business_app_onboarding' : '',
        },
      },
    );
  });
}
