/**
 * Público da campanha: importação em massa + registro de consentimento
 * (CAMPAIGNS.md 12.3, 13 · F58-S08).
 *
 * POST /api/campaigns/:id/recipients/bulk        (campaign.upload_recipients)
 * POST /api/campaigns/:id/recipients/bulk-opt-in (campaign.bulk_optin)
 *
 * ## Em lote, não linha a linha (F58-S08)
 *
 * A versão anterior fazia um SELECT e um INSERT **por linha**: mil contatos eram
 * mais de dois mil round-trips ao banco, dentro de uma transação. Numa lista de
 * verdade isso não é lentidão, é timeout — e timeout no meio da importação deixa
 * o público pela metade sem ninguém saber quais faltaram.
 *
 * Agora são poucas consultas, independentemente do tamanho: uma busca os contatos
 * que já existem, uma insere os novos, uma vincula todos à campanha.
 *
 * ## Consentimento exige ORIGEM
 *
 * `source` é obrigatório e não-vazio no registro de consentimento. Marcar mil
 * pessoas como "aceitaram receber" sem dizer onde elas aceitaram não é um
 * consentimento: é uma afirmação sem prova. No dia em que alguém reclamar — e nos
 * EUA isso vem com multa por mensagem —, a origem é a única coisa que sustenta a
 * defesa.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import { requireAuth, requireRole, withRLS } from '../../middlewares/auth';
import { param } from '../conversions/types';

const { contacts, campaigns, campaignRecipients } = schema;

const E164 = /^\+[1-9]\d{6,14}$/;
export function isE164(phone: string): boolean {
  return E164.test(phone.trim());
}

const rowSchema = z.object({
  phone: z.string().trim().min(1),
  name: z.string().trim().max(200).optional(),
  optIn: z.boolean().optional(),
});

const bulkSchema = z
  .object({
    rows: z.array(rowSchema).max(50000).optional(),
    csv: z.string().max(5000000).optional(),
    source: z.string().trim().max(200).optional(),
    optInOnImport: z.boolean().optional(),
  })
  .refine((d) => d.rows || d.csv, { message: 'rows ou csv e obrigatorio' })
  // Registrar consentimento na importação exige a mesma prova que registrá-lo
  // depois: sem origem, o `opt_in_source` viraria NULL e o registro não
  // sustentaria nada. O caminho continua aberto — só não em silêncio.
  .refine((d) => d.optInOnImport !== true || (d.source ?? '').trim().length >= 3, {
    message:
      'Para registrar consentimento na importação, diga de onde ele veio (ex.: formulário do site).',
    path: ['source'],
  });

interface ParsedRow {
  phone: string;
  name?: string;
  optIn?: boolean;
}

export function parseCsv(csv: string): ParsedRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = (lines[0] ?? '').split(',').map((h) => h.trim().toLowerCase());
  const phoneIdx = header.indexOf('phone');
  const nameIdx = header.indexOf('name');
  const optInIdx = header.findIndex((h) => h === 'opt_in' || h === 'optin');
  const out: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = (lines[i] ?? '').split(',').map((c) => c.trim());
    const phone = phoneIdx >= 0 ? cols[phoneIdx] ?? '' : cols[0] ?? '';
    if (!phone) continue;
    const row: ParsedRow = { phone };
    if (nameIdx >= 0 && cols[nameIdx]) row.name = cols[nameIdx];
    if (optInIdx >= 0) {
      const v = (cols[optInIdx] ?? '').toLowerCase();
      row.optIn = v === 'true' || v === '1' || v === 'sim' || v === 'yes';
    }
    out.push(row);
  }
  return out;
}

/**
 * Classificação de uma linha, para o relatório dizer o que aconteceu com ela.
 *
 * `duplicated` é separado de `reused` de propósito: "o mesmo telefone apareceu
 * duas vezes no SEU arquivo" e "este contato já existia aqui" são problemas
 * diferentes, e só o primeiro é um erro do arquivo.
 */
export interface BulkReportLine {
  phone: string;
  status: 'created' | 'reused' | 'duplicated' | 'skipped';
  reason?: string;
}

export interface BulkResult {
  total: number;
  recipientsAdded: number;
  contactsCreated: number;
  contactsReused: number;
  invalid: number;
  duplicated: number;
  report: BulkReportLine[];
}

/** Teto do relatório devolvido. O resumo numérico sempre cobre o arquivo inteiro. */
const REPORT_LIMIT = 1_000;

/**
 * Importa o público em LOTE.
 *
 * Poucas consultas, independentemente do tamanho do arquivo:
 *  1. quais destes telefones já são contatos do workspace;
 *  2. insere os que faltam (um INSERT com N valores);
 *  3. vincula todos à campanha (idem, com `onConflictDoNothing`).
 *
 * Reimportar é idempotente: o índice único `(campaign_id, contact_id)` absorve o
 * repetido e **nada é removido** — quem já estava no público continua nele.
 */
export async function importRecipients(
  tx: DbTx,
  args: {
    workspaceId: string;
    campaignId: string;
    rows: ParsedRow[];
    source?: string;
    optInOnImport: boolean;
  },
): Promise<BulkResult> {
  const report: BulkReportLine[] = [];
  const empurrar = (linha: BulkReportLine): void => {
    if (report.length < REPORT_LIMIT) report.push(linha);
  };

  // 1. Normaliza e separa o que nem chega ao banco.
  const validas = new Map<string, ParsedRow>();
  let invalid = 0;
  let duplicated = 0;

  for (const row of args.rows) {
    const phone = row.phone.trim();
    if (!isE164(phone)) {
      invalid += 1;
      empurrar({ phone, status: 'skipped', reason: 'phone_nao_e_E164' });
      continue;
    }
    if (validas.has(phone)) {
      // O mesmo número duas vezes no arquivo do cliente. Contar como importado
      // inflaria o tamanho do público que ele vê antes de enviar.
      duplicated += 1;
      empurrar({ phone, status: 'duplicated' });
      continue;
    }
    validas.set(phone, { ...row, phone });
  }

  if (validas.size === 0) {
    return {
      total: args.rows.length,
      recipientsAdded: 0,
      contactsCreated: 0,
      contactsReused: 0,
      invalid,
      duplicated,
      report,
    };
  }

  const telefones = [...validas.keys()];

  // 2. Quem já existe (UMA consulta).
  const existentes = await tx
    .select({ id: contacts.id, phone: contacts.phone })
    .from(contacts)
    .where(and(inArray(contacts.phone, telefones), isNull(contacts.deletedAt)));

  const idPorTelefone = new Map<string, string>();
  for (const c of existentes) {
    if (c.phone !== null) idPorTelefone.set(c.phone, c.id);
  }

  const agora = new Date();
  const optIn = args.optInOnImport;
  const origem = args.source ?? null;

  const novos = telefones.filter((t) => !idPorTelefone.has(t));
  const novosSet = new Set(novos);
  const reaproveitados = telefones.filter((t) => !novosSet.has(t));

  // 3. Insere os que faltam (UM insert).
  let contactsCreated = 0;
  if (novos.length > 0) {
    const criados = await tx
      .insert(contacts)
      .values(
        novos.map((phone) => ({
          workspaceId: args.workspaceId,
          phone,
          displayName: validas.get(phone)?.name ?? null,
          source: 'campaign_import',
          marketingOptIn: optIn,
          optInMethod: optIn ? 'import' : null,
          optInSource: optIn ? origem : null,
          optInAt: optIn ? agora : null,
        })),
      )
      .returning({ id: contacts.id, phone: contacts.phone });
    for (const c of criados) {
      if (c.phone !== null) idPorTelefone.set(c.phone, c.id);
    }
    contactsCreated = criados.length;
  }

  // Contatos que já existiam e recebem consentimento agora (UM update).
  if (optIn && reaproveitados.length > 0) {
    const ids = reaproveitados
      .map((t) => idPorTelefone.get(t))
      .filter((id): id is string => id !== undefined);
    if (ids.length > 0) {
      await tx
        .update(contacts)
        .set({
          marketingOptIn: true,
          optInMethod: 'import',
          optInSource: origem,
          optInAt: agora,
          optOutAt: null,
          optOutReason: null,
          updatedAt: agora,
        })
        .where(inArray(contacts.id, ids));
    }
  }

  for (const phone of telefones) {
    empurrar({ phone, status: novosSet.has(phone) ? 'created' : 'reused' });
  }

  // 4. Vincula à campanha (UM insert idempotente).
  const contactIds = telefones
    .map((t) => idPorTelefone.get(t))
    .filter((id): id is string => id !== undefined);

  let recipientsAdded = 0;
  if (contactIds.length > 0) {
    const inseridos = await tx
      .insert(campaignRecipients)
      .values(
        contactIds.map((contactId) => ({
          workspaceId: args.workspaceId,
          campaignId: args.campaignId,
          contactId,
        })),
      )
      .onConflictDoNothing({
        target: [campaignRecipients.campaignId, campaignRecipients.contactId],
      })
      .returning({ id: campaignRecipients.id });
    recipientsAdded = inseridos.length;
  }

  return {
    total: args.rows.length,
    recipientsAdded,
    contactsCreated,
    contactsReused: reaproveitados.length,
    invalid,
    duplicated,
    report,
  };
}

export function createCampaignRecipientsRouter(): Router {
  const router = Router();
  const uploadGuard = [requireAuth, withRLS, requireRole('campaign.upload_recipients')] as const;
  const bulkOptInGuard = [requireAuth, withRLS, requireRole('campaign.bulk_optin')] as const;

  router.post(
    '/api/campaigns/:id/recipients/bulk',
    ...uploadGuard,
    async (req: Request, res: Response) => {
      const parsed = bulkSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      const id = param(req, 'id');
      const workspaceId = req.auth!.workspace.id;
      const rows: ParsedRow[] = parsed.data.rows ?? parseCsv(parsed.data.csv ?? '');

      const outcome = await req.scoped!(async (tx) => {
        const [campaign] = await tx
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(eq(campaigns.id, id));
        if (!campaign) return null;
        return importRecipients(tx, {
          workspaceId,
          campaignId: id,
          rows,
          source: parsed.data.source,
          optInOnImport: parsed.data.optInOnImport ?? false,
        });
      });
      if (!outcome) {
        res.sendStatus(404);
        return;
      }
      res.status(201).json(outcome);
    },
  );

  router.post(
    '/api/campaigns/:id/recipients/bulk-opt-in',
    ...bulkOptInGuard,
    async (req: Request, res: Response) => {
      // `source` OBRIGATÓRIO e não-vazio (F58-S08). Marcar mil pessoas como
      // "aceitaram receber" sem dizer ONDE elas aceitaram não é consentimento: é
      // uma afirmação sem prova. No dia em que alguém reclamar — e nos EUA isso
      // vem com multa por mensagem — a origem é a única coisa que sustenta a
      // defesa. Antes este campo era opcional e virava NULL em silêncio.
      const schemaBody = z.object({
        source: z
          .string()
          .trim()
          .min(3, 'Diga de onde veio o consentimento (ex.: formulário do site, cadastro na loja).')
          .max(200),
      });
      const parsed = schemaBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'consent_source_required', issues: parsed.error.issues });
        return;
      }
      const source = parsed.data.source;
      const id = param(req, 'id');

      const outcome = await req.scoped!(async (tx) => {
        const recipients = await tx
          .select({ contactId: campaignRecipients.contactId })
          .from(campaignRecipients)
          .where(eq(campaignRecipients.campaignId, id));
        if (recipients.length === 0) return { updated: 0 };
        const ids = recipients.map((r) => r.contactId);
        const updated = await tx
          .update(contacts)
          .set({
            marketingOptIn: true,
            optInMethod: 'import',
            optInSource: source,
            optInAt: new Date(),
            optOutAt: null,
            optOutReason: null,
            updatedAt: new Date(),
          })
          .where(and(inArray(contacts.id, ids), isNull(contacts.deletedAt)))
          .returning({ id: contacts.id });
        return { updated: updated.length };
      });
      res.json(outcome);
    },
  );

  return router;
}
