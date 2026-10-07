import { EMAIL_PROOF_TYPES, type EmailProof, type EmailProofType } from './types';

/** Mesmo alfabeto/limites que a API aceita antes de sequer ir à rede. */
const TOKEN_HASH_RE = /^[A-Za-z0-9_-]{8,256}$/;

function isProofType(v: string | null): v is EmailProofType {
  return v !== null && (EMAIL_PROOF_TYPES as readonly string[]).includes(v);
}

/** Subconjunto de `Window` que a leitura usa — permite testar sem DOM. */
export interface FragmentHost {
  location: { hash: string; pathname: string; search: string };
  history: { replaceState: (data: unknown, unused: string, url?: string | null) => void };
}

/**
 * Lê a prova de posse do email do FRAGMENTO (`#token_hash=…&type=invite|magiclink`),
 * e limpa a URL no mesmo instante: o fragmento sai da barra, do histórico e de um
 * "copiar URL". O valor devolvido vive só em memória (estado do componente).
 *
 * - Nunca lê da query string (a prova não deve ir a log de acesso).
 * - Remove também o `#access_token…` legado que o Supabase anexa — esse não é usado.
 * - NÃO verifica nada: antivírus de email abrem links, só o submit consome a prova.
 */
export function consumeProofFromFragment(host: FragmentHost): EmailProof | null {
  const raw = host.location.hash;
  if (raw.length <= 1) return null;

  const params = new URLSearchParams(raw.slice(1));
  const tokenHash = params.get('token_hash');
  const type = params.get('type');

  // Limpa SEMPRE que havia fragmento (prova, access_token legado ou lixo).
  host.history.replaceState(null, '', host.location.pathname + host.location.search);

  if (tokenHash === null || !TOKEN_HASH_RE.test(tokenHash) || !isProofType(type)) return null;
  return { tokenHash, type };
}
