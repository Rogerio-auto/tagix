/**
 * F45-S01 — Normalização de mídia no upload.
 *
 * Cobre o módulo `media/normalize` (detecção por magic-bytes, sticker via sharp,
 * guardas de transcode) e a rota `POST /api/uploads` (intenção `as`, allowlist,
 * erros tipados 415/422 com `ref`).
 *
 * Auth e storage são mockados (sem DB/R2/Redis). O transcode de voz (ffmpeg) só é
 * exercido se o binário existir no host — caso contrário o caso é pulado (o DoD do
 * formato é validado em CI/imagem, que instala ffmpeg).
 */
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ffmpegAvailable = (() => {
  try {
    return spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0;
  } catch {
    return false;
  }
})();

interface StoredObject {
  key: string;
  body: Buffer;
  contentType: string;
}
const stored: StoredObject[] = [];

vi.mock('@hm/storage', () => ({
  createStorage: () => ({
    put: async (obj: StoredObject) => {
      stored.push(obj);
    },
    getSignedUrl: async (key: string) => ({ url: `https://signed.test/${key}`, expiresAt: 0 }),
  }),
}));

vi.mock('../middlewares/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.auth = { workspace: { id: 'ws-test' }, member: { id: 'm-test', role: 'OWNER' } } as never;
    next();
  },
  withRLS: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireRole:
    () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));

const { createUploadsRouter } = await import('./uploads');
const {
  detectAudioContainer,
  detectImageFormat,
  toStickerWebp,
  transcodeToOpusOgg,
  MediaUnsupportedError,
} = await import('../media');

const app = express();
app.use(createUploadsRouter());

/** PNG sólido NxN, gerado em memória (input de sticker realista). */
async function makePng(size: number): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 10, g: 200, b: 120, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

/** WAV PCM mono curtíssimo (input de áudio realista para o ffmpeg). */
function makeWav(): Buffer {
  const sampleRate = 8000;
  const samples = 800; // 0.1s
  const dataLen = samples * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples; i += 1) {
    buf.writeInt16LE(Math.round(Math.sin(i / 8) * 1000), 44 + i * 2);
  }
  return buf;
}

beforeEach(() => {
  stored.length = 0;
});

describe('media/normalize — detecção por magic-bytes', () => {
  it('reconhece containers de áudio', () => {
    expect(detectAudioContainer(makeWav())).toBe('wav');
    expect(detectAudioContainer(Buffer.from('OggS' + '\0'.repeat(20)))).toBe('ogg');
    expect(detectAudioContainer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      'webm',
    );
    expect(detectAudioContainer(Buffer.from('crap not audio at all'))).toBeNull();
  });

  it('reconhece formatos de imagem', async () => {
    expect(detectImageFormat(await makePng(8))).toBe('png');
    expect(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      'jpeg',
    );
    expect(detectImageFormat(Buffer.from('this is plainly text'))).toBeNull();
  });
});

describe('toStickerWebp', () => {
  it('produz webp 512×512 ≤100 KB a partir de um PNG', async () => {
    const out = await toStickerWebp(await makePng(900));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    expect(out.length).toBeLessThanOrEqual(100 * 1024);
  });

  it('rejeita input que não é imagem (415)', async () => {
    await expect(toStickerWebp(Buffer.from('definitely not an image'))).rejects.toBeInstanceOf(
      MediaUnsupportedError,
    );
  });
});

describe('transcodeToOpusOgg', () => {
  it('rejeita input que não é áudio (415) antes de tocar no ffmpeg', async () => {
    await expect(transcodeToOpusOgg(Buffer.from('not audio'))).rejects.toBeInstanceOf(
      MediaUnsupportedError,
    );
  });

  it.skipIf(!ffmpegAvailable)('transcodifica WAV → audio/ogg;codecs=opus', async () => {
    const out = await transcodeToOpusOgg(makeWav());
    expect(out.length).toBeGreaterThan(0);
    expect(out.toString('latin1', 0, 4)).toBe('OggS'); // container OGG
  });
});

describe('POST /api/uploads', () => {
  it('passthrough (as=auto) preserva mime e bytes', async () => {
    const png = await makePng(16);
    const res = await request(app)
      .post('/api/uploads?filename=foto.png')
      .set('Content-Type', 'image/png')
      .send(png);
    expect(res.status).toBe(200);
    expect(res.body.mime).toBe('image/png');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.body.length).toBe(png.length);
  });

  it('as=sticker converte imagem → image/webp 512²', async () => {
    const res = await request(app)
      .post('/api/uploads?filename=fig.png&as=sticker')
      .set('Content-Type', 'image/png')
      .send(await makePng(700));
    expect(res.status).toBe(200);
    expect(res.body.mime).toBe('image/webp');
    expect(res.body.key).toMatch(/\.webp$/);
    const meta = await sharp(stored[0]!.body).metadata();
    expect(meta.width).toBe(512);
    expect(stored[0]?.contentType).toBe('image/webp');
  });

  it('as=sticker com áudio → 415 com ref', async () => {
    const res = await request(app)
      .post('/api/uploads?filename=x&as=sticker')
      .set('Content-Type', 'audio/wav')
      .send(makeWav());
    expect(res.status).toBe(415);
    expect(res.body.ref).toMatch(/^hm_err_/);
    expect(res.headers['x-error-ref']).toMatch(/^hm_err_/);
  });

  it('as=voice com imagem → 415', async () => {
    const res = await request(app)
      .post('/api/uploads?filename=x&as=voice')
      .set('Content-Type', 'image/png')
      .send(await makePng(16));
    expect(res.status).toBe(415);
    expect(res.body.ref).toMatch(/^hm_err_/);
  });

  it('as=sticker com bytes de imagem inválidos → 422 com ref', async () => {
    // Content-Type image/* passa na allowlist, mas os bytes não são imagem real:
    // detectImageFormat → 415 (MediaUnsupportedError). Garante que não estoura 500.
    const res = await request(app)
      .post('/api/uploads?filename=x&as=sticker')
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not a real png at all, just text padding padding padding'));
    expect([415, 422]).toContain(res.status);
    expect(res.body.ref).toMatch(/^hm_err_/);
  });

  it('tipo não permitido → 415', async () => {
    const res = await request(app)
      .post('/api/uploads?filename=x')
      .set('Content-Type', 'application/zip')
      .send(Buffer.from('PKzipzip'));
    expect(res.status).toBe(415);
  });

  it('corpo vazio → 400', async () => {
    const res = await request(app)
      .post('/api/uploads?filename=x')
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(0));
    expect(res.status).toBe(400);
  });

  it.skipIf(!ffmpegAvailable)('as=voice transcodifica áudio → audio/ogg', async () => {
    const res = await request(app)
      .post('/api/uploads?filename=nota.wav&as=voice')
      .set('Content-Type', 'audio/wav')
      .send(makeWav());
    expect(res.status).toBe(200);
    expect(res.body.mime).toBe('audio/ogg');
    expect(res.body.key).toMatch(/\.ogg$/);
    expect(stored[0]?.body.toString('latin1', 0, 4)).toBe('OggS');
  });
});
