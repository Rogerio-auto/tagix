/**
 * F60-S10 — política do anexo de e-mail e ingestão no storage (sem rede, sem banco).
 */
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { AttachmentFetcher } from './email-attachment-fetch';
import {
  EMAIL_ATTACHMENT_LIMITS,
  classifyAttachment,
  ingestEmailAttachments,
  inspectAttachmentBytes,
  type IncomingEmailAttachment,
} from './email-attachments';

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);
const SVG = Buffer.from('<?xml version="1.0"?><svg onload="alert(1)"></svg>');

function inline(filename: string, contentType: string, bytes: Buffer): IncomingEmailAttachment {
  return {
    kind: 'inline',
    filename,
    contentType,
    contentId: null,
    contentBase64: bytes.toString('base64'),
    sizeBytes: bytes.length,
  };
}

function storage() {
  const uploads: { key: string; body: Buffer; contentType: string }[] = [];
  return {
    uploads,
    port: {
      upload: vi.fn(async (input: { key: string; body: Buffer; contentType: string }) => {
        uploads.push(input);
      }),
      publicUrl: vi.fn(async (key: string) => `https://r2.test/${key}?sig=x`),
    },
  };
}

const semRede: AttachmentFetcher = async () => {
  throw new Error('não deveria buscar');
};

describe('classifyAttachment — lista de permissão', () => {
  it.each([
    ['orcamento.pdf', 'application/pdf', 'document'],
    ['foto.JPG', 'image/jpeg', 'image'],
    ['foto.jpeg', 'image/jpeg', 'image'],
    [
      'planilha.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'document',
    ],
    ['nota.txt', 'text/plain; charset=utf-8', 'document'],
    ['audio.mp3', 'audio/mpeg', 'audio'],
    ['video.mp4', 'video/mp4', 'video'],
    // octet-stream: o tipo sai da extensão.
    ['contrato.pdf', 'application/octet-stream', 'document'],
  ])('%s (%s) entra como %s', (nome, tipo, esperado) => {
    const r = classifyAttachment(nome, tipo);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.type.messageType).toBe(esperado);
  });

  it.each([
    ['setup.exe', 'application/octet-stream'],
    ['fatura.pdf.exe', 'application/pdf'],
    ['boleto.exe.pdf', 'application/pdf'],
    ['logo.svg', 'image/svg+xml'],
    ['pagina.html', 'text/html'],
    ['macro.docm', 'application/vnd.ms-word.document.macroEnabled.12'],
    ['script.js', 'text/plain'],
    ['atalho.lnk', 'application/octet-stream'],
  ])('%s é bloqueado', (nome, tipo) => {
    expect(classifyAttachment(nome, tipo)).toEqual({ ok: false, reason: 'blocked_type' });
  });

  it.each([
    ['arquivo.zip', 'application/zip'],
    ['desconhecido', 'application/octet-stream'],
    ['x.bin', 'application/x-msdownload'],
    // Extensão e tipo discordam: um dos dois mente.
    ['foto.jpg', 'application/pdf'],
  ])('%s (%s) não é suportado', (nome, tipo) => {
    expect(classifyAttachment(nome, tipo)).toEqual({ ok: false, reason: 'unsupported_type' });
  });
});

describe('inspectAttachmentBytes — os bytes decidem', () => {
  const tipo = (nome: string, ct: string) => {
    const c = classifyAttachment(nome, ct);
    if (!c.ok) throw new Error('classificação inesperada');
    return c.type;
  };

  it('PDF de verdade passa; PDF que é executável não', () => {
    expect(inspectAttachmentBytes(PDF, tipo('a.pdf', 'application/pdf'))).toEqual({ ok: true });
    expect(inspectAttachmentBytes(EXE, tipo('a.pdf', 'application/pdf'))).toEqual({
      ok: false,
      reason: 'content_mismatch',
    });
  });

  it('"imagem" que é SVG é recusada (XSS armazenado se renderizada)', () => {
    expect(inspectAttachmentBytes(SVG, tipo('a.png', 'image/png'))).toEqual({
      ok: false,
      reason: 'content_mismatch',
    });
  });

  it('PNG declarado como JPEG é recusado', () => {
    expect(inspectAttachmentBytes(PNG, tipo('a.jpg', 'image/jpeg'))).toEqual({
      ok: false,
      reason: 'content_mismatch',
    });
    expect(inspectAttachmentBytes(JPEG, tipo('a.jpg', 'image/jpeg'))).toEqual({ ok: true });
  });

  it('".txt" com HTML dentro é recusado', () => {
    const html = Buffer.from('<!DOCTYPE html><script>fetch("/api")</script>');
    expect(inspectAttachmentBytes(html, tipo('a.txt', 'text/plain'))).toEqual({
      ok: false,
      reason: 'content_mismatch',
    });
  });

  it('vazio é recusado', () => {
    expect(inspectAttachmentBytes(Buffer.alloc(0), tipo('a.pdf', 'application/pdf'))).toEqual({
      ok: false,
      reason: 'empty',
    });
  });
});

describe('ingestEmailAttachments', () => {
  it('sobe o aceito para o storage sob a key do workspace e devolve URL + sha', async () => {
    const s = storage();
    const r = await ingestEmailAttachments(
      'ws-1',
      [inline('orcamento.pdf', 'application/pdf', PDF)],
      {
        storage: s.port,
        fetchRemote: semRede,
        now: () => new Date('2026-10-07T12:00:00Z'),
      },
    );

    expect(r.rejected).toEqual([]);
    expect(r.stored).toHaveLength(1);
    const a = r.stored[0];
    expect(a?.key).toMatch(/^ws-1\/2026\/10\/07\/[0-9a-f-]{36}\.pdf$/);
    expect(a?.mediaUrl).toBe(`https://r2.test/${a?.key}?sig=x`);
    expect(a?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.uploads[0]?.body.equals(PDF)).toBe(true);
    expect(s.uploads[0]?.contentType).toBe('application/pdf');
  });

  it('recusado não sobe, mas fica registrado com motivo', async () => {
    const s = storage();
    const r = await ingestEmailAttachments(
      'ws-1',
      [
        inline('virus.exe', 'application/octet-stream', EXE),
        inline('ok.pdf', 'application/pdf', PDF),
      ],
      { storage: s.port, fetchRemote: semRede },
    );
    expect(r.rejected).toEqual([{ index: 0, filename: 'virus.exe', reason: 'blocked_type' }]);
    expect(r.stored.map((x) => x.filename)).toEqual(['ok.pdf']);
    expect(s.uploads).toHaveLength(1);
  });

  it('anexo remoto passa pela porta de busca; falha dela vira recusa', async () => {
    const s = storage();
    const fetchRemote = vi.fn<AttachmentFetcher>(async () => ({ ok: false, reason: 'unsafe_url' }));
    const r = await ingestEmailAttachments(
      'ws-1',
      [
        {
          kind: 'remote',
          filename: 'a.pdf',
          contentType: 'application/pdf',
          contentId: null,
          url: 'https://evil.example/a.pdf',
          sizeBytes: null,
        },
      ],
      { storage: s.port, fetchRemote },
    );
    expect(fetchRemote).toHaveBeenCalledWith('https://evil.example/a.pdf', {
      maxBytes: EMAIL_ATTACHMENT_LIMITS.maxBytes,
      timeoutMs: EMAIL_ATTACHMENT_LIMITS.fetchTimeoutMs,
    });
    expect(r.rejected).toEqual([{ index: 0, filename: 'a.pdf', reason: 'unsafe_url' }]);
    expect(s.uploads).toHaveLength(0);
  });

  it('tamanho anunciado acima do teto é recusado sem abrir conexão', async () => {
    const fetchRemote = vi.fn<AttachmentFetcher>();
    const r = await ingestEmailAttachments(
      'ws-1',
      [
        {
          kind: 'remote',
          filename: 'a.pdf',
          contentType: 'application/pdf',
          contentId: null,
          url: 'https://files.x/a.pdf',
          sizeBytes: EMAIL_ATTACHMENT_LIMITS.maxBytes + 1,
        },
      ],
      { storage: storage().port, fetchRemote },
    );
    expect(fetchRemote).not.toHaveBeenCalled();
    expect(r.rejected[0]?.reason).toBe('too_large');
  });

  it('acima da contagem máxima, o excedente é recusado', async () => {
    const lote = Array.from({ length: EMAIL_ATTACHMENT_LIMITS.maxCount + 2 }, (_, i) =>
      inline(`a${i}.pdf`, 'application/pdf', PDF),
    );
    const r = await ingestEmailAttachments('ws-1', lote, {
      storage: storage().port,
      fetchRemote: semRede,
    });
    expect(r.stored).toHaveLength(EMAIL_ATTACHMENT_LIMITS.maxCount);
    expect(r.rejected.map((x) => x.reason)).toEqual(['too_many', 'too_many']);
  });

  it('storage fora não derruba o e-mail: o anexo vira recusa `storage_error`', async () => {
    const r = await ingestEmailAttachments('ws-1', [inline('a.pdf', 'application/pdf', PDF)], {
      storage: {
        upload: async () => {
          throw new Error('AccessDenied');
        },
        publicUrl: async () => 'x',
      },
      fetchRemote: semRede,
    });
    expect(r.stored).toEqual([]);
    expect(r.rejected).toEqual([{ index: 0, filename: 'a.pdf', reason: 'storage_error' }]);
  });
});
