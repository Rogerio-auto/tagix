/**
 * Cliente HTTP tipado para a API (@hm/api). Funciona em Server e Client
 * Components. Erros viram `ApiError` (com ref copiável quando o backend mandar).
 */

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly ref?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
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
    try {
      const data = (await res.json()) as { message?: string; ref?: string };
      if (data.message) message = data.message;
      ref = data.ref;
    } catch {
      // resposta sem corpo JSON
    }
    throw new ApiError(res.status, message, ref);
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
