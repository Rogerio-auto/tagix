/**
 * F69-S03 — processamento do lead, sem rede e sem banco.
 *
 * Protege as três promessas que o cliente sente: lead repetido não duplica, falha
 * transitória tenta de novo, e falha definitiva fica registrada com motivo.
 */
import { describe, expect, it, vi } from 'vitest';
import { MetaError, type ParsedLead } from '@hm/channels';
import type { ResolvedLeadSource } from '@hm/db';
import { PageAccessError } from './graph-source';
import { consentEvidence, isPermanentFailure, processLeadgenJob } from './process';
import type { LeadgenDeps, LeadgenJob, LeadStore, PersistLeadInput } from './ports';
import { reconcileSince } from './reconcile';

const JOB: LeadgenJob = { leadgenId: 'lg1', pageId: 'pg1', formId: 'f1', adId: 'ad1', origin: 'webhook' };
const FONTE: ResolvedLeadSource = { workspaceId: 'ws1', sourceId: 's1', connectionId: 'c1' };
const LEAD: ParsedLead = {
  leadgenId: 'lg1',
  createdTime: '2026-09-15T12:00:00+0000',
  adId: 'ad1',
  formId: 'f1',
  answers: { full_name: ['Ana'], phone_number: ['+13055550142'] },
  consent: [{ checkboxKey: 'optin_sms', isChecked: true }],
};

function silencioso() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Store em memória que imita a reserva idempotente do banco. */
function memoria(opts: { token?: string | null; fontes?: ResolvedLeadSource[] } = {}) {
  const processados = new Set<string>();
  const falhas: string[] = [];
  const gravacoes: PersistLeadInput[] = [];
  const store: LeadStore = {
    resolveSources: async () => opts.fontes ?? [FONTE],
    claim: async (fonte, job) => ({
      submissionId: `${fonte.workspaceId}:${job.leadgenId}`,
      alreadyProcessed: processados.has(`${fonte.workspaceId}:${job.leadgenId}`),
      connectionToken: opts.token === undefined ? 'tok' : opts.token,
    }),
    persist: async (input) => {
      gravacoes.push(input);
      processados.add(input.submissionId);
      return {
        created: true,
        contactId: 'ct1',
        conversationId: 'cv1',
        dealId: 'd1',
        message: { id: 'm1', externalId: 'leadgen:lg1', content: 'resumo' },
      };
    },
    fail: async (_f, _id, error) => {
      falhas.push(error);
    },
  };
  return { store, falhas, gravacoes };
}

function deps(store: LeadStore, fetchLead: LeadgenDeps['source']['fetchLead']): LeadgenDeps & {
  socket: { emitMessageNew: ReturnType<typeof vi.fn> };
} {
  return {
    store,
    source: { fetchLead, fetchDisclaimer: async () => null },
    socket: { emitMessageNew: vi.fn(async () => undefined) },
    logger: silencioso(),
  };
}

describe('processLeadgenJob', () => {
  it('lead novo grava e emite message:new (que aciona o aviso de lead)', async () => {
    const m = memoria();
    const d = deps(m.store, async () => LEAD);
    const r = await processLeadgenJob(JOB, d);
    expect(r).toEqual([{ workspaceId: 'ws1', result: 'created', conversationId: 'cv1' }]);
    expect(d.socket.emitMessageNew).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws1', conversationId: 'cv1', messageId: 'm1' }),
    );
  });

  it('webhook repetido não grava de novo nem avisa de novo', async () => {
    const m = memoria();
    const d = deps(m.store, async () => LEAD);
    await processLeadgenJob(JOB, d);
    const segunda = await processLeadgenJob({ ...JOB, origin: 'reconciliation' }, d);
    expect(segunda[0]?.result).toBe('duplicate');
    expect(m.gravacoes).toHaveLength(1);
    expect(d.socket.emitMessageNew).toHaveBeenCalledTimes(1);
  });

  it('falha transitória na Meta registra o motivo e lança para a fila repetir', async () => {
    const m = memoria();
    const erro = new MetaError('Service unavailable', { httpStatus: 503, retryable: true });
    const d = deps(m.store, async () => {
      throw erro;
    });
    await expect(processLeadgenJob(JOB, d)).rejects.toBe(erro);
    expect(m.falhas).toHaveLength(1);
    expect(m.gravacoes).toHaveLength(0);
  });

  it('token revogado não adianta repetir: fica failed com motivo acionável', async () => {
    const m = memoria();
    const d = deps(m.store, async () => {
      throw new MetaError('Error validating access token', { httpStatus: 400, code: 190 });
    });
    const r = await processLeadgenJob(JOB, d);
    expect(r[0]?.result).toBe('failed');
    expect(m.falhas[0]).toContain('Reconecte a Meta');
  });

  it('conexão removida marca failed sem chamar a Meta', async () => {
    const m = memoria({ token: null });
    const fetchLead = vi.fn(async () => LEAD);
    const r = await processLeadgenJob(JOB, deps(m.store, fetchLead));
    expect(r[0]?.result).toBe('no_token');
    expect(fetchLead).not.toHaveBeenCalled();
  });

  it('falha transitória num workspace não impede o outro de receber', async () => {
    const outra: ResolvedLeadSource = { workspaceId: 'ws2', sourceId: 's2', connectionId: 'c2' };
    const m = memoria({ fontes: [FONTE, outra] });
    let chamadas = 0;
    const d = deps(m.store, async () => {
      chamadas += 1;
      if (chamadas === 1) throw new MetaError('timeout', { httpStatus: 0, retryable: true });
      return LEAD;
    });
    await expect(processLeadgenJob(JOB, d)).rejects.toBeInstanceOf(MetaError);
    expect(m.gravacoes.map((g) => g.source.workspaceId)).toEqual(['ws2']);
  });

  it('página sem fonte ativa: nada a fazer, sem erro', async () => {
    const m = memoria({ fontes: [] });
    expect(await processLeadgenJob(JOB, deps(m.store, async () => LEAD))).toEqual([]);
  });

  it('falha no aviso ao vivo não desfaz o lead gravado', async () => {
    const m = memoria();
    const d = deps(m.store, async () => LEAD);
    d.socket.emitMessageNew.mockRejectedValueOnce(new Error('broker fora'));
    const r = await processLeadgenJob(JOB, d);
    expect(r[0]?.result).toBe('created');
  });
});

describe('isPermanentFailure', () => {
  it('classifica', () => {
    expect(isPermanentFailure(new PageAccessError('pg'))).toBe(true);
    expect(isPermanentFailure(new MetaError('x', { httpStatus: 400, code: 100 }))).toBe(true);
    expect(isPermanentFailure(new MetaError('x', { httpStatus: 500, retryable: true }))).toBe(false);
    expect(isPermanentFailure(new MetaError('rede', { httpStatus: 0 }))).toBe(false);
    expect(isPermanentFailure(new Error('db caiu'))).toBe(false);
  });
});

describe('consentEvidence — o que a pessoa leu, copiado no momento do lead', () => {
  it('junta a caixa marcada com o texto do formulário', () => {
    const e = consentEvidence(LEAD, 'f1', {
      formName: 'Orçamento cozinha',
      title: 'Autorizações',
      body: 'Ao enviar, você concorda…',
      checkboxText: { optin_sms: 'Aceito receber SMS sobre meu orçamento' },
    });
    expect(e.checkboxes).toEqual([
      { checkboxKey: 'optin_sms', isChecked: true, text: 'Aceito receber SMS sobre meu orçamento' },
    ]);
    expect(e.formName).toBe('Orçamento cozinha');
    expect(e.submittedAt).toBe(LEAD.createdTime);
  });

  it('sem o cadastro do formulário, guarda a caixa com texto nulo — não inventa', () => {
    expect(consentEvidence(LEAD, 'f1', null).checkboxes[0]?.text).toBeNull();
  });
});

describe('reconcileSince', () => {
  const agora = new Date('2026-09-15T12:00:00Z');
  it('primeira conferência olha 24h', () => {
    expect(reconcileSince(null, agora).toISOString()).toBe('2026-09-14T12:00:00.000Z');
  });
  it('as seguintes voltam 10 minutos antes da última', () => {
    expect(reconcileSince(new Date('2026-09-15T11:45:00Z'), agora).toISOString()).toBe('2026-09-15T11:35:00.000Z');
  });
});
