/**
 * Rotas que abrem SEM sessão (F70-S28 centraliza o que vivia só no `middleware.ts`).
 *
 * Uma lista, três consumidores: o middleware (redirect de servidor), o handler
 * central de 401 (nunca manda ao login quem já está numa tela pública — é o que
 * impede o laço login → 401 → login) e o `SocketProvider` (não abre socket
 * autenticado onde não há sessão).
 *
 * `/privacidade`, `/termos` e `/exclusao-de-dados` (F69-S01) abrem sem login por
 * exigência da Meta: o revisor do App Review e quem pediu exclusão de dados não têm
 * conta aqui.
 *
 * Edge-safe: sem import de Node nem de React (roda no middleware).
 */
export const PUBLIC_PREFIXES = [
  '/login',
  '/reset-password',
  '/signup',
  '/verify',
  '/privacidade',
  '/termos',
  '/exclusao-de-dados',
] as const;

/**
 * `true` quando o caminho é uma tela pública. Casa o segmento inteiro: `/login` e
 * `/login/…` são públicos, `/loginx` não — um prefixo solto abriria qualquer rota
 * futura que por acaso começasse com o mesmo texto.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
