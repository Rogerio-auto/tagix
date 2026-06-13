/**
 * Teste da inspeção de payload IG na borda (F15-S02). Puro (sem DB/MQ):
 * reconhecimento do envelope `object:'instagram'` + sumarização por tipo,
 * incluindo skip de echoes/deletes. Garante que WA não é confundido com IG.
 */
import { describe, expect, it } from 'vitest';
import { isInstagramEnvelope, summarizeInstagramEnvelope } from './meta-instagram';

function igEnvelope(...messaging: Record<string, unknown>[]): Record<string, unknown> {
  return { object: 'instagram', entry: [{ id: 'IGUSER_1', time: 1, messaging }] };
}

describe('isInstagramEnvelope', () => {
  it('reconhece object instagram e rejeita WA', () => {
    expect(isInstagramEnvelope({ object: 'instagram', entry: [] })).toBe(true);
    expect(isInstagramEnvelope({ object: 'whatsapp_business_account', entry: [] })).toBe(false);
    expect(isInstagramEnvelope(null)).toBe(false);
  });
});

describe('summarizeInstagramEnvelope', () => {
  it('conta DM, story_mention, share e resolve igUserIds', () => {
    const summary = summarizeInstagramEnvelope(
      igEnvelope(
        { sender: { id: 'A' }, message: { mid: 'm1', text: 'oi' } },
        {
          sender: { id: 'B' },
          message: { mid: 'm2', attachments: [{ type: 'story_mention', payload: { url: 'u' } }] },
        },
        { sender: { id: 'C' }, message: { mid: 'm3', attachments: [{ type: 'share', payload: { url: 'u' } }] } },
      ),
    );
    expect(summary.igUserIds).toEqual(['IGUSER_1']);
    expect(summary.counts.dm).toBe(1);
    expect(summary.counts.story_mention).toBe(1);
    expect(summary.counts.share).toBe(1);
    expect(summary.total).toBe(3);
  });

  it('conta comments e mentions via changes', () => {
    const summary = summarizeInstagramEnvelope({
      object: 'instagram',
      entry: [
        {
          id: 'IGUSER_1',
          changes: [
            { field: 'comments', value: { id: 'c1', text: 'top' } },
            { field: 'mentions', value: { comment_id: 'c2', media_id: 'm' } },
          ],
        },
      ],
    });
    expect(summary.counts.comment).toBe(1);
    expect(summary.counts.mention).toBe(1);
    expect(summary.total).toBe(2);
  });

  it('ignora echoes e deletes', () => {
    const summary = summarizeInstagramEnvelope(
      igEnvelope(
        { sender: { id: 'A' }, message: { mid: 'e', text: 'eco', is_echo: true } },
        { sender: { id: 'A' }, message: { mid: 'd', is_deleted: true } },
      ),
    );
    expect(summary.total).toBe(0);
  });

  it('tolera envelope vazio', () => {
    expect(summarizeInstagramEnvelope(null).total).toBe(0);
    expect(summarizeInstagramEnvelope({ object: 'instagram', entry: [] }).total).toBe(0);
  });
});
