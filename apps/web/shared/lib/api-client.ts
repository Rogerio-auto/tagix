/**
 * Cliente HTTP tipado para a API (@hm/api). Funciona em Server e Client
 * Components. Erros viram `ApiError` (com ref copiável quando o backend mandar).
 */

// No browser: vazio = mesma origem (o Next proxia /api e /auth → API), então o
// cookie de sessão é first-party e sempre enviado. No servidor (SSR/RSC) não há
// origem relativa, então vai direto na API.
const BASE_URL =
  process.env['NEXT_PUBLIC_API_URL'] ??
  (typeof window === 'undefined' ? 'http://localhost:3001' : '');

/** Issue de validação (shape do Zod) propagada pelo backend em 400. */
export interface ApiIssue {
  /** Caminho do campo (ex.: `['address', 'cep']`). */
  path: (string | number)[];
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly ref?: string,
    /** Issues de validação por campo (quando o backend manda `issues`). */
    readonly issues?: ApiIssue[],
    /**
     * Código estável do backend (`error` no corpo), ex.: `session_invalid`,
     * `invalid_current_password`. Distingue os 401 que NÃO são sessão morta.
     */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Ponto único de reação a 401 (F70-S28). TODA chamada que passa por aqui — queries,
 * mutations, a hidratação de `/api/me`, chamadas diretas — chega ao mesmo handler,
 * registrado pelo `makeQueryClient` no navegador. O cliente HTTP não sabe o que é
 * "sessão terminou" (isso é `shared/auth/session-expiry`); ele só avisa. Registro em
 * vez de import para não criar ciclo api-client ↔ session-expiry ↔ auth.store.
 */
type UnauthorizedListener = (error: ApiError) => void;
let unauthorizedListener: UnauthorizedListener | null = null;

/** Registra (ou remove, com `null`) o handler central de 401. Só no navegador. */
export function setUnauthorizedListener(listener: UnauthorizedListener | null): void {
  unauthorizedListener = listener;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `Falha na requisição (${res.status})`;
    let ref: string | undefined;
    let issues: ApiIssue[] | undefined;
    let code: string | undefined;
    try {
      const data = (await res.json()) as {
        message?: string;
        ref?: string;
        issues?: ApiIssue[];
        error?: unknown;
      };
      if (data.message) message = data.message;
      ref = data.ref;
      if (Array.isArray(data.issues) && data.issues.length > 0) issues = data.issues;
      if (typeof data.error === 'string') code = data.error;
    } catch {
      // resposta sem corpo JSON
    }
    const error = new ApiError(res.status, message, ref, issues, code);
    if (res.status === 401 && unauthorizedListener) {
      try {
        unauthorizedListener(error);
      } catch {
        // O handler nunca pode trocar o erro original por outro.
      }
    }
    throw error;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
