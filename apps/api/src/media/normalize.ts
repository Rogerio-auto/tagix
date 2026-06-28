/**
 * Normalização de mídia outbound (F45-S01).
 *
 * O WhatsApp Cloud API impõe formatos duros para duas modalidades novas:
 *  - **nota de voz nativa (PTT)** → `audio/ogg` com codec OPUS (mono, 48kHz).
 *    O `MediaRecorder` do navegador gera `audio/webm;codecs=opus` (Chrome) ou
 *    `audio/mp4` (Safari) — nenhum serve. ⇒ transcode server-side via ffmpeg.
 *  - **sticker** → `image/webp` 512×512, estático ≤100 KB. ⇒ sharp.
 *
 * SEGURANÇA (este módulo é [SEC]):
 *  - **Command injection**: ffmpeg é invocado via `spawn` com args em ARRAY e
 *    `shell:false` (default). Nenhum byte do usuário entra na linha de comando —
 *    o binário trafega por `pipe:0`/`pipe:1` (stdin/stdout), nunca por path.
 *  - **DoS**: timeout duro + teto de bytes na saída do ffmpeg (mata o processo no
 *    estouro); `limitInputPixels` no sharp barra decompression bombs de imagem.
 *  - **Magic-bytes**: o container/formato real é validado pelos bytes do input,
 *    não pelo `Content-Type` declarado (que o cliente controla).
 */
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

/** Mídia cujo formato não é aceito para a modalidade pedida → HTTP 415. */
export class MediaUnsupportedError extends Error {
  readonly status = 415 as const;
  constructor(message = 'Tipo de mídia não suportado para esta modalidade.') {
    super(message);
    this.name = 'MediaUnsupportedError';
  }
}

/** Falha ao transformar a mídia (ffmpeg/sharp) → HTTP 422. */
export class MediaTranscodeError extends Error {
  readonly status = 422 as const;
  constructor(message = 'Não foi possível processar a mídia.') {
    super(message);
    this.name = 'MediaTranscodeError';
  }
}

// --- Limites de segurança (DoS) -------------------------------------------------

/** Tempo máximo de um processo ffmpeg antes do SIGKILL. */
const FFMPEG_TIMEOUT_MS = 20_000;
/** Teto de bytes lidos do stdout do ffmpeg — nota de voz é pequena; corta runaways. */
const FFMPEG_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
/** Teto de pixels que o sharp decodifica — barra decompression bombs. */
const SHARP_MAX_INPUT_PIXELS = 50_000_000;

// --- Sticker --------------------------------------------------------------------

const STICKER_SIZE = 512;
const STICKER_MAX_BYTES = 100 * 1024;
/** Degradação progressiva de qualidade até caber no teto de 100 KB. */
const STICKER_QUALITY_LADDER = [92, 85, 75, 65, 55, 45, 35] as const;

// --- Detecção por magic-bytes ---------------------------------------------------

type AudioContainer = 'webm' | 'ogg' | 'mp4' | 'wav';
type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif';

/** Reconhece os containers de áudio que o `MediaRecorder`/uploads podem gerar. */
export function detectAudioContainer(buf: Buffer): AudioContainer | null {
  if (buf.length < 12) return null;
  // EBML header (Matroska/WebM): 1A 45 DF A3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  // OGG: "OggS"
  if (buf.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  // ISO-BMFF (MP4/M4A): "ftyp" no offset 4
  if (buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  // WAV: "RIFF"...."WAVE"
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') {
    return 'wav';
  }
  return null;
}

/** Reconhece os formatos de imagem aceitos como base de sticker. */
export function detectImageFormat(buf: Buffer): ImageFormat | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  // WEBP: "RIFF"...."WEBP"
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  // GIF: "GIF8"
  if (buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  return null;
}

// --- ffmpeg (args em ARRAY, sem shell) ------------------------------------------

/**
 * Executa o ffmpeg lendo o input cru do stdin e devolvendo o output do stdout.
 * `spawn` (não `exec`) com args em array e `shell` desligado ⇒ impossível injeção
 * via nome de arquivo/conteúdo. Aplica timeout e teto de bytes na saída.
 */
function runFfmpeg(args: readonly string[], input: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn('ffmpeg', [...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });

    const chunks: Buffer[] = [];
    let outBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new MediaTranscodeError('Tempo de processamento de áudio excedido.')));
    }, FFMPEG_TIMEOUT_MS);

    function finish(action: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    }

    // Falha ao spawnar (ex.: ffmpeg ausente / ENOENT).
    child.on('error', () => {
      finish(() => reject(new MediaTranscodeError('Falha ao iniciar o processamento de áudio.')));
    });

    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > FFMPEG_MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(() => reject(new MediaTranscodeError('Áudio resultante excede o limite.')));
        return;
      }
      chunks.push(chunk);
    });

    // Drena o stderr para não bloquear o processo (buffer cheio trava o ffmpeg).
    child.stderr.on('data', () => {});

    child.on('close', (code: number | null) => {
      finish(() => {
        if (code === 0 && outBytes > 0) {
          resolve(Buffer.concat(chunks));
          return;
        }
        reject(new MediaTranscodeError('Falha ao transcodificar o áudio.'));
      });
    });

    // EPIPE se o ffmpeg fechar o stdin cedo — não deve derrubar o processo Node.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/**
 * Transcodifica um áudio (webm/mp4/ogg/wav) para `audio/ogg;codecs=opus`,
 * mono, 48 kHz — o formato exato que o WhatsApp exige para nota de voz nativa.
 */
export async function transcodeToOpusOgg(input: Buffer): Promise<Buffer> {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    throw new MediaUnsupportedError('Áudio vazio.');
  }
  if (detectAudioContainer(input) === null) {
    throw new MediaUnsupportedError('Formato de áudio não suportado para nota de voz.');
  }
  return runFfmpeg(
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-i',
      'pipe:0',
      '-vn',
      '-map_metadata',
      '-1',
      '-ac',
      '1',
      '-ar',
      '48000',
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      '-f',
      'ogg',
      'pipe:1',
    ],
    input,
  );
}

// --- sharp (sticker) ------------------------------------------------------------

function encodeStickerWebp(input: Buffer, quality: number): Promise<Buffer> {
  return sharp(input, { limitInputPixels: SHARP_MAX_INPUT_PIXELS, animated: false })
    .resize(STICKER_SIZE, STICKER_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality, effort: 4, alphaQuality: 100 })
    .toBuffer();
}

/**
 * Converte uma imagem (png/jpeg/webp/gif) em sticker `image/webp` 512×512,
 * fundo transparente (`fit:contain`), degradando a qualidade até caber em 100 KB.
 */
export async function toStickerWebp(input: Buffer): Promise<Buffer> {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    throw new MediaUnsupportedError('Imagem vazia.');
  }
  if (detectImageFormat(input) === null) {
    throw new MediaUnsupportedError('Formato de imagem não suportado para sticker.');
  }

  let last: Buffer | null = null;
  for (const quality of STICKER_QUALITY_LADDER) {
    try {
      last = await encodeStickerWebp(input, quality);
    } catch {
      throw new MediaTranscodeError('Falha ao converter a imagem em sticker.');
    }
    if (last.length <= STICKER_MAX_BYTES) return last;
  }
  throw new MediaTranscodeError('Imagem grande demais para virar sticker (≤100 KB).');
}
