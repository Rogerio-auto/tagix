/**
 * voice-format — safeguard de formato de nota de voz (PTT) no outbound.
 *
 * O WhatsApp só renderiza `voice:true` (PTT, com a onda) quando o binário é
 * REALMENTE um container OGG/Opus. Quando o nó do flow declara mime `audio/ogg;
 * codecs=opus` mas o arquivo é mp3 (ou `application/octet-stream`), a Graph
 * baixa pelo `link`, detecta o tipo real e rejeita com o erro **131053**
 * ("Media upload error") → a mensagem fica `failed`. O serializer não consegue
 * saber sem olhar os bytes — então a checagem mora aqui, no dispatch (chokepoint
 * de toda mídia outbound).
 *
 * Estratégia: inspecionar os 4 primeiros bytes do binário (magic do container
 * OGG). Se NÃO for ogg, rebaixar para áudio comum — entrega como áudio (sem onda
 * PTT) em vez de falhar.
 *
 * Fail-safe: qualquer incerteza (URL vazia, erro de rede/timeout, leitura
 * curta) → mantém `voice`. Não queremos regredir voz válida por erro
 * transitório.
 */

/** Magic ASCII do container OGG: "OggS" (0x4F 0x67 0x67 0x53). */
const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53] as const;

/** Timeout padrão da leitura dos primeiros bytes (ms). */
export const VOICE_MAGIC_TIMEOUT_MS = 4000;

/**
 * Pura: os primeiros bytes correspondem à magic "OggS"? Recebe os bytes lidos
 * (idealmente >= 4); leitura mais curta → `false` (não dá pra afirmar OGG).
 */
export function isOggMagic(bytes: Uint8Array): boolean {
  if (bytes.length < OGG_MAGIC.length) return false;
  for (let i = 0; i < OGG_MAGIC.length; i += 1) {
    if (bytes[i] !== OGG_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Porta de leitura dos primeiros bytes do binário. Recebe a URL e um `signal`
 * de abort (timeout) e resolve com os bytes lidos. Em produção: GET com header
 * `Range: bytes=0-3` sobre a URL assinada do R2 (ver `dispatch.ts`). Injetável
 * para teste sem rede.
 */
export type VoiceMagicFetcher = (url: string, signal: AbortSignal) => Promise<Uint8Array>;

/**
 * Decide o `mediaKind` efetivo para um job que se declara `voice`. Retorna
 * `'audio'` SOMENTE quando confirmamos que o binário NÃO é ogg/opus; em
 * qualquer outro caso (é ogg de fato, ou não deu pra determinar) retorna
 * `'voice'` (fail-safe).
 */
export async function resolveVoiceMediaKind(
  url: string,
  fetcher: VoiceMagicFetcher,
  timeoutMs: number = VOICE_MAGIC_TIMEOUT_MS,
): Promise<'voice' | 'audio'> {
  if (url === '') return 'voice';
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const bytes = await fetcher(url, controller.signal);
    if (bytes.length < OGG_MAGIC.length) return 'voice';
    return isOggMagic(bytes) ? 'voice' : 'audio';
  } catch {
    return 'voice';
  } finally {
    clearTimeout(timer);
  }
}
