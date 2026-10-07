import { ApiError, api } from '@/shared/lib/api-client';
import { reconnectSocket } from '@/shared/realtime/reconnect';
import { parseMe, useAuthStore } from '@/shared/stores/auth.store';

/** O seletor só existe com 2+ empresas; com 1 é só o nome da empresa. */
export function canSwitchWorkspace(memberships: readonly unknown[]): boolean {
  return memberships.length >= 2;
}

export type SwitchErrorCode = 'not_found' | 'read_only_view' | 'failed';

export type SwitchResult = { ok: true } | { ok: false; code: SwitchErrorCode; message: string };

/** O que a troca precisa do React Query (fatia mínima — facilita o teste). */
export interface SwitchQueryClient {
  cancelQueries: () => Promise<unknown>;
  clear: () => void;
}

export interface SwitchWorkspaceDeps {
  workspaceId: string;
  queryClient: SwitchQueryClient;
  /** Vai para `/` (e pede dados novos ao servidor). */
  navigate: () => void;
  reconnect?: () => boolean;
}

const MESSAGES: Record<SwitchErrorCode, string> = {
  not_found: 'Você não tem mais acesso a essa empresa. Atualizamos a sua lista.',
  read_only_view: 'Saia do modo de visualização para trocar de empresa.',
  failed: 'Não conseguimos trocar de empresa. Verifique a conexão e tente de novo.',
};

/** Traduz o erro de `POST /api/me/workspace` na mensagem para a pessoa. */
export function classifySwitchError(error: unknown): SwitchErrorCode {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.code === 'workspace_not_found') return 'not_found';
    if (error.status === 403 && error.code === 'impersonation_read_only') return 'read_only_view';
  }
  return 'failed';
}

/**
 * Troca a empresa ativa (F71-S08). Ordem importa:
 *  1. `POST /api/me/workspace` — o servidor valida a membership e seta o cookie;
 *  2. cancela e LIMPA todo o cache do React Query (nenhum dado da empresa anterior
 *     pode sobreviver: o cache é por chave, não por empresa);
 *  3. aplica o `/api/me` novo no store (nome, papel, status de assinatura, lista);
 *  4. reconecta o socket (as rooms seguem a empresa do cookie, decididas no handshake);
 *  5. navega para `/`.
 * Se a validação do POST falhar, nada local muda: a pessoa continua onde estava.
 */
export async function performWorkspaceSwitch(deps: SwitchWorkspaceDeps): Promise<SwitchResult> {
  const { workspaceId, queryClient, navigate, reconnect = reconnectSocket } = deps;
  const store = useAuthStore.getState();

  let raw: unknown;
  try {
    raw = await api.post<unknown>('/api/me/workspace', { workspaceId });
  } catch (error) {
    const code = classifySwitchError(error);
    // Membership revogada: a lista local está velha — atualiza sem alarde.
    if (code === 'not_found') void store.hydrate();
    return { ok: false, code, message: MESSAGES[code] };
  }

  // Cookie já trocado. Daqui em diante o cache atual é da empresa ERRADA.
  await queryClient.cancelQueries();
  queryClient.clear();

  try {
    useAuthStore.getState().applyMe(parseMe(raw));
  } catch {
    // Resposta fora do contrato: o cookie já trocou, então relê o estado da sessão.
    await useAuthStore.getState().hydrate();
  }
  reconnect();
  navigate();
  return { ok: true };
}
