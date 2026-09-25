/**
 * Reprocessa mídia recebida que não foi guardada (F70-S27).
 *
 * Uso típico, depois de trocar a credencial do storage (runbook
 * `docs/runbooks/storage-recusou-midia.md`). Local, da raiz do repositório:
 *
 *   # 1) ver o que seria feito (não grava nada, não mexe na DLQ)
 *   apps/workers/node_modules/.bin/tsx --env-file=.env scripts/reprocess-media.ts \
 *     --workspace <uuid> --since 2026-09-24 --dry-run
 *   # 2) executar
 *   apps/workers/node_modules/.bin/tsx --env-file=.env scripts/reprocess-media.ts \
 *     --workspace <uuid> --since 2026-09-24
 *
 * Em produção, de dentro do container dos workers (a imagem já roda com `tsx`):
 *
 *   docker exec -w /app/apps/workers <container> \
 *     node_modules/.bin/tsx ../../scripts/reprocess-media.ts --since 2026-09-24 --dry-run
 *
 * Por que TypeScript com `tsx` (e não SQL solto ou um script Python): o reprocesso
 * precisa exatamente dos contratos do worker — o schema Zod do job, o construtor da
 * outbox `inboundMediaJobOutbox` (envelope com o workspace real, que a 0091 exige), a
 * transação `withWorkspace` com RLS e o formato da DLQ. Reusá-los direto elimina a
 * chance de o script divergir do worker. `tsx` é o mesmo runtime da imagem dos workers
 * e dos seeds: nada a compilar, nada a instalar. A lógica mora em
 * `apps/workers/src/media/reprocess.ts` (testada lá); aqui fica só a linha de comando.
 *
 * O script importa por caminho relativo: as dependências (`@hm/db`, `@hm/shared`)
 * resolvem a partir de `apps/workers`, que as declara.
 *
 * Idempotente: rodar duas vezes não duplica (ver `reprocess.ts`). Saída: resumo legível
 * e, com `--json`, o relatório completo em JSON. Nada de segredo sai daqui: só ids,
 * provedor, datas e contagens.
 */
import { parseArgs } from 'node:util';
import {
  closeReprocessConnections,
  reprocessMedia,
  providerRecoveryWindowDays,
  type ReprocessReport,
} from '../apps/workers/src/media/reprocess';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HELP = `Reprocessa mídia recebida que não foi guardada no storage.

Opções:
  --since <data>        início da janela (ISO, ex.: 2026-09-24 ou 2026-09-24T12:00Z). Obrigatório.
  --until <data>        fim da janela (exclusivo). Default: agora.
  --workspace <uuid>    só este workspace (recomendado).
  --dry-run             só lista; não grava nada e devolve a DLQ intacta.
  --min-age <minutos>   ignora mensagens mais novas que isto (job ainda a caminho). Default 10.
  --max-age-days <n>    sobrescreve a janela de recuperação do provedor
                        (default: WhatsApp ${providerRecoveryWindowDays('meta_whatsapp')}d, Instagram ${providerRecoveryWindowDays('meta_instagram')}d, WAHA ${providerRecoveryWindowDays('waha')}d).
  --limit <n>           teto de mensagens avaliadas. Default 5000.
  --skip-dlq            não lê a DLQ (dispensa o RabbitMQ).
  --dlq-max <n>         teto de mensagens lidas da DLQ. Default 1000.
  --force               reenfileira mesmo com reprocessamento já pedido (job perdido).
  --json                imprime o relatório completo em JSON.
  --help                esta ajuda.`;

function fail(message: string): never {
  process.stderr.write(`erro: ${message}\n\n${HELP}\n`);
  process.exit(2);
}

function parseDate(raw: string | undefined, flag: string): Date | undefined {
  if (raw === undefined) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) fail(`${flag} inválido: ${raw}`);
  return d;
}

function parsePositive(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) fail(`${flag} precisa ser um número >= 0`);
  return n;
}

function printSummary(report: ReprocessReport): void {
  const c = report.counts;
  const lines = [
    report.dryRun ? '== DRY-RUN: nada foi gravado ==' : '== reprocessamento executado ==',
    `janela: ${report.window.since} → ${report.window.until}`,
    `avaliadas: ${report.scanned}`,
    report.dryRun
      ? `  seriam reenfileiradas:     ${c.would_enqueue}`
      : `  reenfileiradas:            ${c.enqueued}`,
    `  já a caminho (puladas):    ${c.already_queued}`,
    `  velhas demais p/ recuperar: ${c.too_old}${formatByProvider(report)}`,
    `  expiradas/indisponíveis no provedor: ${c.terminal}`,
    `  sem referência do arquivo: ${c.no_reference}`,
    `  já ingeridas:              ${c.already_ingested}`,
  ];
  if (report.dlq !== null) {
    const d = report.dlq;
    lines.push(
      `DLQ: lidas ${d.read}, de mídia ${d.media}, removidas ${d.removed}, devolvidas ${d.returned}, sem mensagem ${d.unmatched}`,
    );
  }
  if (report.dryRun) {
    lines.push('', 'mensagens:');
    for (const item of report.items.slice(0, 200)) {
      lines.push(
        `  ${item.action.padEnd(16)} ${item.messageId}  ws=${item.workspaceId}  ${item.provider ?? '-'}  ${item.createdAt}  origem=${item.source ?? '-'}`,
      );
    }
    if (report.items.length > 200) lines.push(`  … e mais ${report.items.length - 200} (use --json)`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function formatByProvider(report: ReprocessReport): string {
  const parts = Object.entries(report.tooOldByProvider).map(([p, n]) => `${p}=${n}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      since: { type: 'string' },
      until: { type: 'string' },
      workspace: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'min-age': { type: 'string' },
      'max-age-days': { type: 'string' },
      limit: { type: 'string' },
      'skip-dlq': { type: 'boolean', default: false },
      'dlq-max': { type: 'string' },
      force: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const since = parseDate(values.since, '--since') ?? fail('--since é obrigatório');
  const until = parseDate(values.until, '--until');
  if (values.workspace !== undefined && !UUID.test(values.workspace)) {
    fail('--workspace precisa ser um UUID');
  }

  try {
    const report = await reprocessMedia({
      workspaceId: values.workspace,
      since,
      until,
      dryRun: values['dry-run'],
      force: values.force,
      minAgeMinutes: parsePositive(values['min-age'], '--min-age'),
      maxAgeDays: parsePositive(values['max-age-days'], '--max-age-days'),
      limit: parsePositive(values.limit, '--limit'),
      includeDlq: !values['skip-dlq'],
      dlqMax: parsePositive(values['dlq-max'], '--dlq-max'),
    });
    if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printSummary(report);
  } finally {
    await closeReprocessConnections();
  }
}

main().catch((err: unknown) => {
  // Só o nome e a mensagem: nada de stack com URL de conexão.
  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, '<db-url>') : String(err);
  process.stderr.write(`falhou: ${name}: ${message}\n`);
  process.exit(1);
});
