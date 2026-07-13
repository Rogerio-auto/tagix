/**
 * Núcleo PURO da ativação de canal Meta (F56-S05 — UX-01/UX-12).
 *
 * Duas responsabilidades, ambas sem DOM e sem SDK (testáveis em `node`):
 *
 *  1. **Configuração** — o Embedded Signup só existe se o build tiver
 *     `NEXT_PUBLIC_META_APP_ID` + `NEXT_PUBLIC_META_CONFIG_ID`. Sem elas, o popup
 *     da Meta NUNCA abre e, portanto, o `authorization code` (single-use, emitido
 *     só pelo popup) é **impossível** de obter. Pedir esse campo é pedir um input
 *     que o usuário não tem como preencher — o antipadrão que a auditoria pegou.
 *     A UI usa `getMetaSignupConfig()` para degradar de forma visível.
 *
 *  2. **Falhas** — toda falha do signup vira uma `MetaSignupError` com `reason`
 *     tipada; `describeSignupFailure()` traduz para as 3 partes obrigatórias de um
 *     erro (o quê / por quê / o que fazer — UX §2.11) e diz à UI o que oferecer
 *     (retry do popup e/ou entrada manual).
 *
 * As envs são lidas por acesso literal (`process.env['NEXT_PUBLIC_…']`) porque o
 * Next só inlineia essa forma no bundle do browser — passar `process.env` adiante
 * como objeto quebraria em produção.
 */

export type MetaEnvKey = 'NEXT_PUBLIC_META_APP_ID' | 'NEXT_PUBLIC_META_CONFIG_ID';

export interface MetaSignupConfig {
  /** `true` quando o Embedded Signup pode ser aberto neste build. */
  readonly configured: boolean;
  /** Envs ausentes — exibidas como detalhe técnico para abrir chamado no suporte. */
  readonly missing: readonly MetaEnvKey[];
}

/** Núcleo puro da detecção (o caller injeta os valores — testável). */
export function describeMetaSignupConfig(
  appId: string | undefined,
  configId: string | undefined,
): MetaSignupConfig {
  const missing: MetaEnvKey[] = [];
  if (typeof appId !== 'string' || appId.trim() === '') missing.push('NEXT_PUBLIC_META_APP_ID');
  if (typeof configId !== 'string' || configId.trim() === '') {
    missing.push('NEXT_PUBLIC_META_CONFIG_ID');
  }
  return { configured: missing.length === 0, missing };
}

/**
 * Configuração efetiva deste build. Estável entre servidor e cliente (não olha
 * `window`), então pode ser usada na primeira renderização sem risco de mismatch
 * de hidratação.
 */
export function getMetaSignupConfig(): MetaSignupConfig {
  return describeMetaSignupConfig(
    process.env['NEXT_PUBLIC_META_APP_ID'],
    process.env['NEXT_PUBLIC_META_CONFIG_ID'],
  );
}

/** Atalho de leitura para a UI. */
export function isMetaSignupConfigured(): boolean {
  return getMetaSignupConfig().configured;
}

// ---------------------------------------------------------------------------
// Falhas do signup
// ---------------------------------------------------------------------------

/**
 * Por que o signup não completou:
 * - `not_configured` — envs ausentes (o popup nem chega a abrir).
 * - `sdk_load_failed` — script da Meta bloqueado/offline.
 * - `cancelled` — usuário fechou o popup ou negou a permissão.
 * - `timeout` — silêncio total da janela da Meta (popup bloqueado, aba perdida).
 * - `incomplete` — voltou o `code` mas não os ids (`phone_number_id`/`waba_id`).
 * - `meta_error` — a própria Meta reportou erro no fluxo.
 */
export type SignupFailureReason =
  | 'not_configured'
  | 'sdk_load_failed'
  | 'cancelled'
  | 'timeout'
  | 'incomplete'
  | 'meta_error'
  | 'unknown';

export class MetaSignupError extends Error {
  readonly reason: SignupFailureReason;

  constructor(reason: SignupFailureReason, message: string) {
    super(message);
    this.name = 'MetaSignupError';
    this.reason = reason;
  }
}

/** Cópia de um erro recuperável, nas 3 partes obrigatórias (UX §2.11). */
export interface SignupFailureCopy {
  readonly reason: SignupFailureReason;
  /** O QUÊ aconteceu. */
  readonly title: string;
  /** POR QUÊ, em linguagem de gente. */
  readonly why: string;
  /** O QUE FAZER agora — sempre aponta para algo visível na tela. */
  readonly whatToDo: string;
  /** Vale reabrir o popup da Meta? */
  readonly canRetry: boolean;
  /** Vale abrir os campos manuais (code + ids)? */
  readonly canFallbackManual: boolean;
}

const FAILURE_COPY: Record<SignupFailureReason, Omit<SignupFailureCopy, 'reason'>> = {
  not_configured: {
    title: 'Conexão automática indisponível neste ambiente',
    why: 'O aplicativo da Meta não está configurado neste servidor, então a janela de autorização não abre.',
    whatToDo: 'Fale com o suporte para habilitar — ou conecte um número pelo WAHA, que não depende da Meta.',
    canRetry: false,
    canFallbackManual: false,
  },
  sdk_load_failed: {
    title: 'Não foi possível carregar a janela da Meta',
    why: 'O script da Meta não carregou — geralmente rede corporativa, bloqueador de anúncios ou extensão do navegador.',
    whatToDo: 'Desative bloqueadores nesta página e tente de novo. Se persistir, informe os dados manualmente abaixo.',
    canRetry: true,
    canFallbackManual: true,
  },
  cancelled: {
    title: 'Cadastro na Meta cancelado',
    why: 'A janela da Meta foi fechada ou a permissão não foi concedida.',
    whatToDo: 'Clique em "Tentar de novo" e conclua todos os passos na janela da Meta sem fechá-la.',
    canRetry: true,
    canFallbackManual: true,
  },
  timeout: {
    title: 'A janela da Meta não respondeu',
    why: 'Ficamos sem resposta da Meta — o popup pode ter sido bloqueado pelo navegador ou ficado em outra aba.',
    whatToDo:
      'Libere popups para este site e tente de novo. Se você já concluiu o cadastro na Meta, copie o código e os ids do painel da Meta e cole nos campos abaixo.',
    canRetry: true,
    canFallbackManual: true,
  },
  incomplete: {
    title: 'A Meta não devolveu o número e a conta',
    why: 'O cadastro autorizou o acesso, mas não veio o phone number id / WABA id — sem eles não dá para criar o canal.',
    whatToDo: 'Tente de novo ou cole o código e os ids do painel da Meta nos campos abaixo.',
    canRetry: true,
    canFallbackManual: true,
  },
  meta_error: {
    title: 'A Meta recusou o cadastro',
    why: 'A própria Meta reportou um erro durante o Embedded Signup.',
    whatToDo:
      'Confira no painel da Meta se a conta comercial está verificada e tente de novo; ou informe os dados manualmente abaixo.',
    canRetry: true,
    canFallbackManual: true,
  },
  unknown: {
    title: 'Não foi possível concluir o cadastro na Meta',
    why: 'A janela da Meta encerrou de um jeito inesperado.',
    whatToDo: 'Tente de novo. Se voltar a falhar, informe os dados manualmente abaixo.',
    canRetry: true,
    canFallbackManual: true,
  },
};

/** Cópia canônica de um motivo (fonte única — a UI não reescreve mensagens). */
export function signupFailureCopy(reason: SignupFailureReason): SignupFailureCopy {
  return { reason, ...FAILURE_COPY[reason] };
}

/**
 * Traduz qualquer erro do fluxo em cópia acionável. Um erro sem `reason`
 * (rede, bug) cai em `unknown` — mas o detalhe da Meta, quando existe, entra no
 * "por quê" para o usuário não ficar no escuro.
 */
export function describeSignupFailure(err: unknown): SignupFailureCopy {
  const reason: SignupFailureReason = err instanceof MetaSignupError ? err.reason : 'unknown';
  const base = FAILURE_COPY[reason];
  const detail = err instanceof MetaSignupError ? err.message.trim() : '';
  const useDetail = reason === 'meta_error' && detail.length > 0;
  return {
    reason,
    title: base.title,
    why: useDetail ? detail : base.why,
    whatToDo: base.whatToDo,
    canRetry: base.canRetry,
    canFallbackManual: base.canFallbackManual,
  };
}
