/**
 * Workspace de demonstração do App Review da Meta (F69-S10).
 *
 * O revisor da Meta e os screencasts usam uma conta criada pelo cadastro normal do app
 * (nunca por aqui: o seed não toca o provedor de autenticação). Este seed só dá contexto
 * àquele workspace — contatos, etiquetas e um funil com negócios — para a inbox e o funil
 * não aparecerem vazios na gravação. Conversas e leads de verdade chegam durante a
 * gravação, pelos eventos de teste da Meta; por isso **nenhum canal** é criado aqui (um
 * canal falso apareceria como "conectado" e mentiria no vídeo).
 *
 * Nenhum dado real, por construção:
 *  - telefones com DDD `00`, que não existe no Brasil — nunca batem com uma pessoa;
 *  - e-mails em `example.com` (RFC 2606, reservado para exemplo);
 *  - nomes e empresas inventados.
 * Tudo leva `source = 'demo_app_review'` (contatos e negócios) para ser achado e apagado.
 *
 * Idempotente: ids derivados do workspace (UUIDv5) + `onConflictDoNothing`. Rodar de novo
 * não duplica nem sobrescreve o que o usuário mudou na mão.
 */
import { createHash } from 'node:crypto';
import type { DbTx } from '../client';
import { contactTags, contacts, deals, pipelines, stages, tags } from '../schema';

export const APP_REVIEW_DEMO_SOURCE = 'demo_app_review';

/** Namespace fixo do seed (não muda nunca: muda todos os ids). */
const DEMO_NS = '6f1d2c3b-9a8e-4b7c-8d6e-5f4a3b2c1d0e';

function uuidv5(name: string, namespace: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(nsBytes).update(name, 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

interface DemoContact {
  key: string;
  displayName: string;
  /** DDD 00: inexistente no Brasil. */
  phone: string;
  email: string;
  tags: readonly string[];
}

interface DemoDeal {
  contactKey: string;
  title: string;
  stageKey: DemoStageKey;
  valueCents: number;
}

type DemoStageKey = 'novo' | 'qualificado' | 'proposta' | 'ganho' | 'perdido';

const DEMO_STAGES: ReadonlyArray<{
  key: DemoStageKey;
  name: string;
  isWon?: boolean;
  isLost?: boolean;
}> = [
  { key: 'novo', name: 'Novo lead' },
  { key: 'qualificado', name: 'Qualificado' },
  { key: 'proposta', name: 'Proposta enviada' },
  { key: 'ganho', name: 'Fechado', isWon: true },
  { key: 'perdido', name: 'Perdido', isLost: true },
];

export const DEMO_TAGS = ['anuncio-meta', 'instagram', 'whatsapp', 'retornar'] as const;

export const DEMO_CONTACTS: readonly DemoContact[] = [
  {
    key: 'ana',
    displayName: 'Ana Exemplo',
    phone: '+5500900000001',
    email: 'ana@example.com',
    tags: ['anuncio-meta'],
  },
  {
    key: 'bruno',
    displayName: 'Bruno Demonstração',
    phone: '+5500900000002',
    email: 'bruno@example.com',
    tags: ['instagram'],
  },
  {
    key: 'carla',
    displayName: 'Carla Fictícia',
    phone: '+5500900000003',
    email: 'carla@example.com',
    tags: ['whatsapp', 'retornar'],
  },
  {
    key: 'diego',
    displayName: 'Diego Teste',
    phone: '+5500900000004',
    email: 'diego@example.com',
    tags: ['anuncio-meta'],
  },
  {
    key: 'elisa',
    displayName: 'Elisa Modelo',
    phone: '+5500900000005',
    email: 'elisa@example.com',
    tags: ['instagram'],
  },
  {
    key: 'fabio',
    displayName: 'Fábio Amostra',
    phone: '+5500900000006',
    email: 'fabio@example.com',
    tags: ['whatsapp'],
  },
];

export const DEMO_DEALS: readonly DemoDeal[] = [
  { contactKey: 'ana', title: 'Clínica Exemplo — site', stageKey: 'novo', valueCents: 250_000 },
  {
    contactKey: 'bruno',
    title: 'Estúdio Demo — anúncios',
    stageKey: 'qualificado',
    valueCents: 100_000,
  },
  {
    contactKey: 'carla',
    title: 'Loja Fictícia — atendimento',
    stageKey: 'proposta',
    valueCents: 500_000,
  },
  { contactKey: 'diego', title: 'Escola Teste — captação', stageKey: 'ganho', valueCents: 250_000 },
  {
    contactKey: 'elisa',
    title: 'Ateliê Modelo — Instagram',
    stageKey: 'perdido',
    valueCents: 100_000,
  },
];

export const DEMO_PIPELINE_NAME = 'Demonstração — App Review';

export interface AppReviewDemoReport {
  pipelineId: string;
  /** Linhas inseridas nesta execução, por tabela. Tudo zero = já estava semeado. */
  inserted: { contacts: number; tags: number; contactTags: number; stages: number; deals: number };
}

export function appReviewDemoIds(workspaceId: string) {
  const id = (name: string) => uuidv5(`${workspaceId}:${name}`, DEMO_NS);
  return {
    pipeline: id('pipeline'),
    stage: (key: DemoStageKey) => id(`stage:${key}`),
    contact: (key: string) => id(`contact:${key}`),
    tag: (name: string) => id(`tag:${name}`),
    deal: (contactKey: string) => id(`deal:${contactKey}`),
  };
}

/**
 * Semeia o contexto de demonstração no workspace. Roda dentro de `withWorkspace` (RLS):
 * `withWorkspace(id, (tx) => seedAppReviewDemo(tx, id))`.
 */
export async function seedAppReviewDemo(
  tx: DbTx,
  workspaceId: string,
): Promise<AppReviewDemoReport> {
  const ids = appReviewDemoIds(workspaceId);

  const insertedContacts = await tx
    .insert(contacts)
    .values(
      DEMO_CONTACTS.map((c) => ({
        id: ids.contact(c.key),
        workspaceId,
        displayName: c.displayName,
        phone: c.phone,
        email: c.email,
        source: APP_REVIEW_DEMO_SOURCE,
        notes: 'Contato fictício da demonstração do App Review.',
      })),
    )
    .onConflictDoNothing()
    .returning({ id: contacts.id });

  // Etiqueta pode já existir com o mesmo nome (criada pelo usuário): o conflito é pelo
  // nome no workspace, e o vínculo usa o id que estiver lá.
  const insertedTags = await tx
    .insert(tags)
    .values(DEMO_TAGS.map((name) => ({ id: ids.tag(name), workspaceId, name })))
    .onConflictDoNothing()
    .returning({ id: tags.id });
  const tagRows = await tx.query.tags.findMany({
    where: (t, { and, eq, inArray }) =>
      and(eq(t.workspaceId, workspaceId), inArray(t.name, [...DEMO_TAGS])),
    columns: { id: true, name: true },
  });
  const tagIdByName = new Map(tagRows.map((t) => [t.name, t.id]));

  const links = DEMO_CONTACTS.flatMap((c) =>
    c.tags.flatMap((name) => {
      const tagId = tagIdByName.get(name);
      return tagId === undefined ? [] : [{ workspaceId, contactId: ids.contact(c.key), tagId }];
    }),
  );
  const insertedLinks =
    links.length === 0
      ? []
      : await tx.insert(contactTags).values(links).onConflictDoNothing().returning();

  await tx
    .insert(pipelines)
    .values({ id: ids.pipeline, workspaceId, name: DEMO_PIPELINE_NAME })
    .onConflictDoNothing();

  const insertedStages = await tx
    .insert(stages)
    .values(
      DEMO_STAGES.map((s, position) => ({
        id: ids.stage(s.key),
        workspaceId,
        pipelineId: ids.pipeline,
        name: s.name,
        position,
        isWon: s.isWon ?? false,
        isLost: s.isLost ?? false,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: stages.id });

  const insertedDeals = await tx
    .insert(deals)
    .values(
      DEMO_DEALS.map((d, position) => {
        const stage = DEMO_STAGES.find((s) => s.key === d.stageKey);
        const closed = stage?.isWon === true || stage?.isLost === true;
        return {
          id: ids.deal(d.contactKey),
          workspaceId,
          pipelineId: ids.pipeline,
          stageId: ids.stage(d.stageKey),
          contactId: ids.contact(d.contactKey),
          title: d.title,
          valueCents: d.valueCents,
          source: APP_REVIEW_DEMO_SOURCE,
          position,
          closedAt: closed ? new Date() : null,
          closedWon: closed ? stage?.isWon === true : null,
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ id: deals.id });

  return {
    pipelineId: ids.pipeline,
    inserted: {
      contacts: insertedContacts.length,
      tags: insertedTags.length,
      contactTags: insertedLinks.length,
      stages: insertedStages.length,
      deals: insertedDeals.length,
    },
  };
}
