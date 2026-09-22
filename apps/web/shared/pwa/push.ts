/**
 * Lógica de assinatura de push (F61-S03) — pura, testável sem browser.
 */

/**
 * A chave VAPID viaja como base64url e o `PushManager` exige `Uint8Array`.
 *
 * Base64url troca `+/` por `-_` e omite o padding — passar a string direto para
 * `atob` falha com "InvalidCharacterError" em algumas chaves e, pior, funciona em
 * outras, produzindo um bug que só aparece com certas chaves geradas.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + padding).replaceAll('-', '+').replaceAll('_', '/');
  const bruto = atob(normal);
  // Sobre um `ArrayBuffer` explícito, e não `new Uint8Array(tamanho)`: desde o TS
  // 5.7 o array tipado carrega o buffer no tipo, e a variante `ArrayBufferLike`
  // (que admite `SharedArrayBuffer`) não satisfaz `BufferSource` — que é o que
  // `applicationServerKey` exige.
  const saida = new Uint8Array(new ArrayBuffer(bruto.length));
  for (let i = 0; i < bruto.length; i += 1) saida[i] = bruto.charCodeAt(i);
  return saida;
}

/** Estados possíveis do interruptor de avisos, do ponto de vista da UI. */
export type PushState =
  /** O navegador não faz push, ou o servidor não tem VAPID. Não mostrar nada. */
  | 'indisponivel'
  /** iOS numa aba: precisa instalar antes. Pedir permissão aqui é queimar a chance. */
  | 'precisa-instalar'
  /** Dá para pedir permissão. */
  | 'pode-ativar'
  /** Já ativo neste aparelho. */
  | 'ativo'
  /** O usuário negou. Só as configurações do navegador revertem — não insistir. */
  | 'bloqueado';

/**
 * Decide o que a UI mostra.
 *
 * A ordem importa e não é arbitrária:
 *
 * 1. **Indisponível vence tudo.** Sem suporte ou sem VAPID, não existe caminho —
 *    mostrar interruptor seria oferecer o que não funciona.
 * 2. **Bloqueado vem antes de "instalar".** Quem já negou não é convencido por um
 *    convite; a permissão negada só volta pelas configurações do navegador, e
 *    insistir é o caminho mais curto para o dono desinstalar o app.
 * 3. **Instalar vem antes de "pode ativar" no iOS.** O Safari só entrega push para
 *    app na tela de início. Pedir permissão numa aba do iOS **gasta a única
 *    chance**: o usuário nega, e a negativa é lembrada.
 */
export function decidePushState(input: {
  suportado: boolean;
  temChavePublica: boolean;
  permissao: NotificationPermission | null;
  jaAssinado: boolean;
  standalone: boolean;
  ios: boolean;
}): PushState {
  if (!input.suportado || !input.temChavePublica) return 'indisponivel';
  if (input.permissao === 'denied') return 'bloqueado';
  if (input.ios && !input.standalone) return 'precisa-instalar';
  if (input.jaAssinado && input.permissao === 'granted') return 'ativo';
  return 'pode-ativar';
}
