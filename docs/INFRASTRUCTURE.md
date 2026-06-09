# INFRASTRUCTURE — Highermind v2

> **Documento:** Infraestrutura, runtime, deploy, observability
> **Versão:** 0.1 — 2026-06-06
> **Complementa:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — esse arquivo aprofunda operação e ops.

---

## 1. Topologia de produção

VPS Ubuntu 24.04 (host nome ainda a definir; alias `<vps-host>` nos comandos abaixo), atrás de Nginx (gerenciado via aaPanel). Domínio raiz placeholder `<domínio>` — substituir ao contratar.

### 1.1 Subdomínios e roteamento

> Domínio é placeholder — substituir `<domínio>` pelo real quando contratar a VPS nova e o registro DNS.

| Subdomínio | Serviço | Porta interna |
|---|---|---|
| `app.<domínio>` | container `web` (Next.js standalone) | 3000 |
| `api.<domínio>` | container `api` (Express + Socket.io) | 3001 |
| `api.<domínio>/webhooks/meta` | container `api` (webhook unificado WA + IG) | 3001 |
| `api.<domínio>/socket.io/` | container `api` (WebSocket upgrade) | 3001 |
| `waha.<domínio>` | container `waha` (admin UI) | 3000 |
| `mq.<domínio>` | container `rabbitmq` (Management UI) | 15672 |
| `grafana.<domínio>` | Grafana (futuro) | 3001 |

**Não expostos no Nginx (rede Docker interna apenas):**

| DNS interno | Serviço | Porta |
|---|---|---|
| `agent-runtime:8001` | Microsserviço Python (FastAPI + LangGraph + LangServe) | 8001 |

Nginx termina TLS (certbot/Let's Encrypt). Backend é HTTP local entre containers.

### 1.2 Containers Docker Compose

`infra/docker/docker-compose.prod.yml`:

```yaml
version: '3.8'
services:
  postgres:
    image: pgvector/pgvector:pg16
    restart: always
    environment:
      POSTGRES_DB: highermind
      POSTGRES_USER: ${PG_USER}
      POSTGRES_PASSWORD: ${PG_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "${PG_USER}"]
      interval: 10s

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD} --maxmemory 2gb --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s

  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    restart: always
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBIT_USER}
      RABBITMQ_DEFAULT_PASS: ${RABBIT_PASSWORD}
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
    ports:
      - "15672:15672"  # management UI

  waha:
    image: devlikeapro/waha:latest
    restart: always
    environment:
      WAHA_API_KEY: ${WAHA_API_KEY}
      WAHA_WEBHOOK_URL: http://api:3001/webhooks/waha
    volumes:
      - waha-data:/app/sessions

  api:
    image: ghcr.io/highermind/api:${IMAGE_TAG}
    restart: always
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      rabbitmq: { condition: service_started }
    env_file: .env.api
    ports:
      - "127.0.0.1:3001:3001"

  web:
    image: ghcr.io/highermind/web:${IMAGE_TAG}
    restart: always
    command: ["node", ".next/standalone/server.js"]
    depends_on:
      api: { condition: service_started }
    env_file: .env.web
    expose:
      - "3000"           # interno; Nginx faz reverse proxy de app.<domínio> → web:3000
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:3000/api/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3

  worker-inbound:
    image: ghcr.io/highermind/workers:${IMAGE_TAG}
    restart: always
    command: ["node", "dist/inbound/index.js"]
    depends_on: [postgres, redis, rabbitmq]
    env_file: .env.workers
    deploy: { replicas: 2 }

  worker-outbound:
    image: ghcr.io/highermind/workers:${IMAGE_TAG}
    restart: always
    command: ["node", "dist/outbound/index.js"]
    depends_on: [postgres, redis, rabbitmq]
    env_file: .env.workers
    deploy: { replicas: 2 }

  worker-media:
    image: ghcr.io/highermind/workers:${IMAGE_TAG}
    restart: always
    command: ["node", "dist/media/index.js"]
    depends_on: [postgres, redis, rabbitmq]
    env_file: .env.workers
    deploy: { replicas: 2 }

  worker-campaigns:
    image: ghcr.io/highermind/workers:${IMAGE_TAG}
    restart: always
    command: ["node", "dist/campaigns/index.js"]
    depends_on: [postgres, redis, rabbitmq]
    env_file: .env.workers

  worker-flows:
    image: ghcr.io/highermind/workers:${IMAGE_TAG}
    restart: always
    command: ["node", "dist/flows/index.js"]
    depends_on: [postgres, redis, rabbitmq]
    env_file: .env.workers
    deploy: { replicas: 2 }

  agent-runtime:
    image: ghcr.io/highermind/agent-runtime:${IMAGE_TAG}
    restart: always
    command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
    depends_on:
      postgres: { condition: service_healthy }
    env_file: .env.agent-runtime
    expose:
      - "8001"          # interno apenas; api Node fala via DNS Docker `agent-runtime:8001`
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8001/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
    deploy: { replicas: 2 }

  scheduler:
    image: ghcr.io/highermind/workers:${IMAGE_TAG}
    restart: always
    command: ["node", "dist/scheduler/index.js"]
    depends_on: [postgres, redis, rabbitmq]
    env_file: .env.workers

volumes:
  postgres-data:
  redis-data:
  rabbitmq-data:
  waha-data:
```

**Web app** é container Next.js (`output: 'standalone'`) rodando `node .next/standalone/server.js` na porta interna 3000. Nginx faz reverse proxy de `app.<domínio>` → `web:3000`. Não é build estático; Server Components + Server Actions exigem runtime Node.

### 1.3 Recursos esperados

| Componente | CPU | RAM | Disco |
|---|---|---|---|
| postgres | 2 cores | 8GB | 100GB (cresce com mensagens + checkpoints LangGraph) |
| redis | 1 core | 2GB | 5GB |
| rabbitmq | 1 core | 1GB | 5GB |
| waha | 1 core | 1GB | 20GB (sessions whatsapp web) |
| api | 1 core | 1GB | — |
| **web (Next.js standalone)** | **0.5 core** | **512MB** | **—** |
| worker (cada) | 0.5 core | 512MB | — |
| **agent-runtime (cada réplica, Python)** | **0.5 core** | **768MB** | **—** |
| scheduler | 0.25 core | 256MB | — |
| **Total VPS** | **~10 cores** | **~19GB** | **~150GB** |

Hetzner CCX23 ou similar (8 vCPU, 16GB RAM, 240GB SSD) é confortável; em uso pesado de agentes (≥ 200 conversas IA/dia) considerar CCX33 (16 vCPU, 32GB).

---

## 2. RabbitMQ

### 2.1 Exchanges e queues

Vide [`ARCHITECTURE.md`](./ARCHITECTURE.md) §6.1. Resumo:

- `hm.app` (topic) — eventos da aplicação
- `hm.channels` (topic) — vindos de canais externos
- `hm.dlx` (topic) — dead letter

Queues principais:
- `hm.q.inbound.message` (worker-inbound)
- `hm.q.inbound.media` (worker-media)
- `hm.q.outbound.request` (worker-outbound)
- `hm.q.outbound.retry.10s` (TTL)
- `hm.q.outbound.dlq` (manual inspection)
- `hm.q.socket.relay` (api server)
- `hm.q.campaign.followup` (worker-campaigns)
- `hm.q.flow.execution` (worker-flows)
- `hm.q.webhook.dispatch` (worker-webhooks ou outbound)

### 2.2 Setup topologia

`packages/shared/src/queue/topology.ts` exporta `setupTopology(channel)`. Cada worker no startup chama uma vez — idempotente (assertQueue/Exchange).

### 2.3 Padrão envelope

```ts
type Envelope<T> = {
  schemaVersion: 1;
  type: string;
  workspaceId: string;
  correlationId: string;
  causationId?: string;
  publishedAt: string;
  attempt: number;
  payload: T;
};
```

`correlationId` propaga em logs (Pino) e tracing (OTel).

### 2.4 Retry e DLQ

- Mensagem que falha (`nack`) vai pro DLX com routing key `outbound.retry`.
- Cai em `hm.q.outbound.retry.10s` (TTL 10s).
- Ao expirar TTL, mensagem volta pro `hm.app` com routing key `outbound.retry` → re-roteado pra `hm.q.outbound.request`.
- Contador `attempt` no envelope incrementa.
- Após `MAX_ATTEMPTS=3`, vai pra `hm.q.outbound.dlq` (manual).

DLQ inspecionável em `/admin/infrastructure/queues/dlq` (UI lista payloads + permite requeue ou descartar).

### 2.5 Backpressure

`channel.prefetch(20)` por worker. Se queue acumula muito (lag > 1000), alerta no Grafana dispara.

---

## 3. Redis

### 3.1 Configuração

`redis-server --requirepass X --maxmemory 2gb --maxmemory-policy allkeys-lru`. LRU eviction = cache; chaves críticas (locks) usam TTL explícito + check antes de operar.

### 3.2 Key namespaces

Todas as chaves começam com prefixo `hm:`:

```
hm:auth:{sha256(token)}             # auth cache, TTL 300s
hm:conv:{id}                         # conversation snapshot, TTL 30s
hm:conv:v:{id}                       # version counter (sem TTL, incrementa em writes)
hm:conv:list:{workspaceId}:{hashFilters}  # list cache, TTL 120s
hm:msg:{convId}:{cursor}             # messages page cache, TTL 60s
hm:msg:set:{convId}                  # SET de keys de msg pra invalidar
hm:contact:{id}                      # contact snapshot, TTL 60s
hm:contact:lookup:{channelId}:{remoteId}  # lookup, TTL 120s
hm:lock:outbound:{convId}            # FIFO lock per conversation, TTL 90s
hm:lock:singleton:{workerType}       # PID lock dos workers, TTL 60s (heartbeat 15s)
hm:lock:cron:{jobKey}                # idempotency lock pros cron jobs
hm:avatar:{workspaceId}:{remoteId}   # avatar cached URL, TTL 86400s
```

### 3.3 Cache key versioning (vs invalidação direta do v1)

Lição v1: 16+ keys por conversa, invalidação manual frágil.

Solução v2:

```ts
// version per workspace ou per conversa
async function bumpConversationVersion(convId: string) {
  await redis.incr(k.conversationVersion(convId));
}

// list cache inclui version no key
async function getConversationListCacheKey(workspaceId: string, filters: ListFilters) {
  const wsVersion = await redis.get(`hm:ws:v:${workspaceId}`) ?? '0';
  return `hm:conv:list:${workspaceId}:v${wsVersion}:${hashFilters(filters)}`;
}

// invalidar é trivial: bump version, keys ficam órfãs (LRU limpa depois)
```

Trade-off: cache miss aumenta após bump (todas as queries re-fazem). Mitigado por: `staleTime` no TanStack Query (frontend re-fetch silencioso), single-flight via Redlock.

### 3.4 Locks distribuídos

- `redlock` para idempotência de cron (`hm:lock:cron:daily_consolidation`, etc.).
- Per-chat lock (FX-007): `runWithDistributedLock('hm:lock:outbound:' + convId, { ttl: 90_000 }, fn)`.
- PID lock workers: `ensureSingleWorkerInstance(type)` registra `hm:lock:singleton:{type}` com heartbeat.

---

## 4. Storage (Cloudflare R2)

### 4.1 Setup

- Conta Cloudflare → R2 → bucket `highermind-media` (private, sem ACL pública).
- Worker token API com permissions: Object Read + Write.
- Custom domain `media.<domínio>` apontando pro bucket (opcional, só se quiser URLs públicas pra mídia pública).

### 4.2 Driver

`packages/storage/src/r2-driver.ts`:

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class R2Driver implements IStorageDriver {
  private s3: S3Client;
  constructor(private cfg: R2Config) {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretKey },
    });
  }

  async upload(input: UploadInput) {
    const sha256 = createHash('sha256').update(input.buffer).digest('hex');
    await this.s3.send(new PutObjectCommand({
      Bucket: this.cfg.bucket,
      Key: input.key,
      Body: input.buffer,
      ContentType: input.contentType,
      Metadata: { sha256, workspaceId: input.workspaceId },
    }));
    return { key: input.key, sha256, publicUrl: undefined };
  }

  async getSignedUrl(key: string, opts: { expiresIn: number; download?: boolean }) {
    const cmd = new GetObjectCommand({
      Bucket: this.cfg.bucket,
      Key: key,
      ResponseContentDisposition: opts.download ? 'attachment' : 'inline',
    });
    return getSignedUrl(this.s3, cmd, { expiresIn: opts.expiresIn });
  }

  // ... delete, exists
}
```

### 4.3 Path layout

`{workspaceId}/{year}/{month}/{day}/{uuid}.{ext}`

Razões: facilita per-workspace cleanup; previne hot partition (não usa hash inicial); legível para debug.

### 4.4 Signed URLs

- **Visualização inline:** TTL 1h (suficiente pra um chat aberto).
- **Download pela API pública:** TTL 7 dias.
- **Upload direto do frontend** (futuro, fase 2): TTL 5min, com size limit pre-signed.

### 4.5 Cleanup

- Cron `monthly`: delete objetos R2 de `messages` que foram soft-deletadas há > 30 dias.
- Cron `monthly`: delete `webhook_events.raw_payload` com > 90 dias (mantém metadata).

---

## 5. Postgres

### 5.1 Configuração

`postgresql.conf` (custom via env do container):

```
shared_buffers = 2GB
work_mem = 32MB
maintenance_work_mem = 512MB
effective_cache_size = 6GB
checkpoint_timeout = 15min
max_connections = 200
random_page_cost = 1.1            # SSD
default_statistics_target = 200
log_min_duration_statement = 100  # slow query > 100ms
```

### 5.2 Extensions

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;          -- pgvector
CREATE EXTENSION IF NOT EXISTS unaccent;        -- buscas portuguese
```

### 5.3 Pool

`packages/db/src/connection.ts`:

```ts
import postgres from 'postgres';

export const sql = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: false,                 // necessário pra Drizzle prepared statements
  onnotice: () => {},
  transform: { undefined: null },
});

export const db = drizzle(sql, { schema });
```

### 5.4 RLS aplicação

Middleware Express:

```ts
// apps/api/src/middlewares/withRLS.ts
export async function withRLS(req: Request, _res: Response, next: NextFunction) {
  // executa todo o request dentro de uma transaction com workspace_id seteado
  const wsId = req.auth.workspaceId;
  await db.execute(sql.raw(`SET LOCAL app.workspace_id = '${wsId}'`));
  next();
}
```

(Em produção, usar pool por workspace ou request com `db.transaction` envolvendo todo o handler. Detalhe de implementação.)

### 5.5 Backup

Job cron `daily 03:00 BRT`:

1. `pg_dump --format=custom --compress=9 highermind > /tmp/dump.pgcustom`
2. Encrypt com `openssl aes-256-cbc -salt -in dump -out dump.enc -k $BACKUP_KEY`
3. Upload pra R2 bucket `highermind-backups/{year}/{month}/{day}/dump-{timestamp}.enc`
4. Delete local
5. Retention 30 dias (cron `monthly` apaga >30d)

Restore testado mensalmente em ambiente staging.

---

## 6. Workers

### 6.1 Composition

Cada worker em `apps/workers/src/<name>/index.ts`:

```ts
// apps/workers/src/inbound/index.ts
import { connectRabbit } from '@hm/shared/queue';
import { setupTopology } from '@hm/shared/queue/topology';
import { ensureSingleWorkerInstance } from '@hm/shared/locks/singleton';
import { processInboundMessage } from './handler';
import { logger } from '@hm/logger';

async function main() {
  await ensureSingleWorkerInstance('inbound');
  const channel = await connectRabbit();
  await setupTopology(channel);

  await channel.prefetch(env.INBOUND_PREFETCH ?? 10);
  await channel.consume('hm.q.inbound.message', async (msg) => {
    if (!msg) return;
    const envelope = JSON.parse(msg.content.toString());
    try {
      await processInboundMessage(envelope);
      channel.ack(msg);
    } catch (err) {
      logger.error({ err, envelope }, 'inbound.error');
      channel.nack(msg, false, false);  // vai pra DLX
    }
  });

  logger.info('worker-inbound ready');
  installSignalHandlers(channel);
}

main().catch((err) => {
  logger.fatal({ err }, 'worker-inbound failed to start');
  process.exit(1);
});
```

### 6.2 Singleton lock (Redis PID)

```ts
// packages/shared/src/locks/singleton.ts
export async function ensureSingleWorkerInstance(type: string) {
  const key = `hm:lock:singleton:${type}`;
  const token = `${hostname()}-${process.pid}-${Date.now()}`;
  const acquired = await redis.set(key, token, 'PX', 60_000, 'NX');
  if (!acquired) {
    // checar se o lock atual é nosso (recovery após restart)
    const existing = await redis.get(key);
    if (existing?.startsWith(`${hostname()}-${process.pid}-`)) {
      // é nosso, OK
    } else {
      logger.warn({ type, existing }, 'singleton.locked_by_other');
      process.exit(1);
    }
  }
  // heartbeat
  setInterval(async () => {
    await redis.set(key, token, 'PX', 60_000);
  }, 15_000).unref();
  // cleanup on shutdown
  process.on('SIGTERM', async () => {
    await releaseLockIfOwner(key, token);
    process.exit(0);
  });
}
```

### 6.3 Distributed lock per resource

```ts
// packages/shared/src/locks/distributed.ts
import Redlock from 'redlock';

const redlock = new Redlock([redis], { retryCount: 0 });

export async function runWithDistributedLock<T>(
  resource: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts: { skipIfLocked?: boolean } = {},
): Promise<T | null> {
  try {
    const lock = await redlock.acquire([resource], ttlMs);
    try {
      return await fn();
    } finally {
      await lock.release();
    }
  } catch (err) {
    if (opts.skipIfLocked) return null;
    throw err;
  }
}
```

Aplicado em outbound (per-chat FIFO), cron (idempotency), agent execution (per-conversation, opcional).

---

## 7. Scheduler

Processo separado `scheduler` que registra jobs cron e adquire lock distribuído para garantir single-execution.

```ts
// apps/workers/src/scheduler/index.ts
import cron from 'node-cron';
import { runWithDistributedLock } from '@hm/shared/locks/distributed';

const TZ = 'America/Sao_Paulo';

// daily consolidation 02:00 BRT
cron.schedule('0 2 * * *', async () => {
  await runWithDistributedLock(
    'hm:lock:cron:daily_consolidation',
    300_000,
    () => dailyConsolidationJob(),
    { skipIfLocked: true },
  );
}, { timezone: TZ });

// flow wake-up 1min
cron.schedule('* * * * *', async () => {
  await runWithDistributedLock(
    'hm:lock:cron:flow_wakeup',
    50_000,
    () => flowWakeupJob(),
    { skipIfLocked: true },
  );
}, { timezone: TZ });

// auto follow-up 5min
cron.schedule('*/5 * * * *', async () => {
  await runWithDistributedLock(
    'hm:lock:cron:agent_followup',
    280_000,
    () => agentFollowupJob(),
    { skipIfLocked: true },
  );
}, { timezone: TZ });

// campanha tick 1min
cron.schedule('* * * * *', async () => {
  await runWithDistributedLock(
    'hm:lock:cron:campaign_tick',
    50_000,
    () => campaignTickJob(),
    { skipIfLocked: true },
  );
}, { timezone: TZ });

// daily reset (00:00 BRT por workspace.timezone — futuro mais granular)
cron.schedule('5 0 * * *', async () => {
  await runWithDistributedLock(
    'hm:lock:cron:daily_reset',
    300_000,
    () => resetDailyCountersJob(),
    { skipIfLocked: true },
  );
}, { timezone: TZ });

// backup 03:00
cron.schedule('0 3 * * *', async () => {
  await runWithDistributedLock(
    'hm:lock:cron:backup',
    1800_000,
    () => runBackupJob(),
    { skipIfLocked: true },
  );
}, { timezone: TZ });

// weekly OpenAI sync 03:00 SUN
cron.schedule('0 3 * * 0', async () => {
  await runWithDistributedLock(
    'hm:lock:cron:openai_sync',
    600_000,
    () => syncOpenAIUsageJob(),
    { skipIfLocked: true },
  );
}, { timezone: TZ });

// monthly material view refresh
cron.schedule('15 * * * *', async () => {
  await runWithDistributedLock(
    'hm:lock:cron:refresh_mv',
    300_000,
    () => refreshMaterializedViewsJob(),
    { skipIfLocked: true },
  );
}, { timezone: TZ });
```

---

## 8. Observability

### 8.1 Logging (Pino)

`packages/logger/src/index.ts`:

```ts
import pino from 'pino';

export const logger = pino({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { service: env.SERVICE_NAME, env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.secret',
      '*.api_key',
      '*.access_token',
      '*.refresh_token',
      '*.email',
      '*.phone',
    ],
    censor: '[REDACTED]',
  },
});
```

Convenção em log calls:

```ts
logger.info({ event: 'message.persisted', conversationId, durationMs }, 'message persisted');
logger.warn({ event: 'campaign.quality_warning', campaignId, qualityRating }, 'quality rating dropped');
logger.error({ err, event: 'outbound.failed', envelope }, 'outbound failed');
```

### 8.2 Tracing (OpenTelemetry)

`apps/api/src/telemetry.ts` (executado antes de tudo):

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  serviceName: 'hm-api',
  traceExporter: new OTLPTraceExporter({ url: env.OTEL_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

Manual spans em pontos críticos:

```ts
import { trace } from '@opentelemetry/api';
const tracer = trace.getTracer('hm-api');

async function runAgent(input: RunAgentInput) {
  const span = tracer.startSpan('agent.run', { attributes: { agentId: input.agentId } });
  try {
    // ... lógica
    return result;
  } finally {
    span.end();
  }
}
```

Backend coletor: pode ser Honeycomb, Tempo, Jaeger, ou simplesmente console. Configurável via `OTEL_ENDPOINT`.

### 8.3 Metrics

OpenTelemetry metrics: counters de eventos, histograms de latência.

```ts
import { metrics } from '@opentelemetry/api';
const meter = metrics.getMeter('hm-api');

const messageSentCounter = meter.createCounter('hm.messages.sent', { description: 'Outbound messages sent' });
const agentLatencyHist = meter.createHistogram('hm.agent.latency_ms', { description: 'Agent invocation latency' });

// uso:
messageSentCounter.add(1, { provider: 'meta_cloud', workspace_id: wsId });
agentLatencyHist.record(latencyMs, { agent_id: agentId, model });
```

### 8.4 Errors (Sentry opcional)

```ts
import * as Sentry from '@sentry/node';

if (env.SENTRY_DSN) {
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1 });
}
```

Sem Sentry: logger.error é o suficiente.

### 8.5 Painel Infrastructure (admin)

Rota `/admin/infrastructure` mostra:

- **Postgres:** size das tables principais, connections ativas, slow queries top 10, tamanho do schema `langgraph_*` (checkpoints).
- **Redis:** hit rate, memory usage, key count por namespace.
- **RabbitMQ:** queue lengths, consumer counts, message rate.
- **Workers:** heartbeats (PID locks com TTL renovado), backlog atendido.
- **agent-runtime (Python):** health, latência média por endpoint, taxa de erros, throughput.
- **R2:** size do bucket, requests/dia.
- **OpenRouter:** spend hoje/mês (consolidado do `llm_usage_logs`), top modelos consumidos, error rate (429/503).

Cada métrica é endpoint backend que consulta o serviço respectivo via cliente apropriado (pg_stat, INFO redis, RabbitMQ Management API, `GET agent-runtime:8001/healthz` + custom metrics endpoint).

---

## 9. Auth

Detalhe completo em [`ARCHITECTURE.md`](./ARCHITECTURE.md) §8. Resumo:

- Supabase Auth como provider via `IAuthProvider` interface.
- JWT em cookie HttpOnly + SameSite=Lax + Secure em prod.
- Auth cache Redis (`hm:auth:{sha256}`, TTL 300s).
- API key auth para `/api/v1/*`: SHA-256 hash em `api_keys`, scopes verificados.
- Roles: OWNER/ADMIN/SUPERVISOR/AGENT/READONLY + flag `is_platform_admin`.
- RLS Postgres por `workspace_id`.

---

## 10. Encryption

### 10.0 Platform secrets (super-admin)

Tabela `platform_secrets` (vide DATA_MODEL §7.12) guarda secrets compartilhados por toda a plataforma, cifrados com AES-256-GCM. Carregados no boot da API Node em cache em-memória (`PlatformSecretsCache`) com refresh a cada 60s ou em mutação.

#### Como o agent-runtime Python recebe a OPENROUTER_API_KEY

**Decisão (ADR-022 complemento):** env var direta injetada no container `agent-runtime` no deploy. Mecanismo:

1. Script de deploy (`infra/scripts/deploy.sh`) lê `openrouter_api_key` decifrada via API Node interna (`GET api:3001/internal/platform-secrets/openrouter --header X-Internal-Token`).
2. Exporta no `.env.agent-runtime` antes de `docker compose up`.
3. Container Python lê via `pydantic-settings` (`Settings.OPENROUTER_API_KEY`).

**Rotação:** super-admin atualiza secret no painel → próximo deploy puxa novo valor. **Restart do container `agent-runtime` é necessário** (perda mínima: execuções em voo são interrompidas, LangGraph checkpointer retoma do último checkpoint persistido). Pra rotação sem downtime, fazer rolling restart das 2 réplicas com `docker compose restart agent-runtime` espaçado.

Alternativas avaliadas e descartadas:
- (B) HTTP runtime fetch — adiciona dependência circular (Python precisa da API Node antes de servir)
- (C) Redis com TTL — complica boot e adiciona ponto de falha

#### Como o agent-runtime Python valida `workspace_id`

O Node API é a **fonte de verdade** do workspace_id. Fluxo na invocação de agente:

1. Member faz request autenticado pro API Node.
2. Middleware Express extrai `workspace_id` da sessão Supabase (cookie).
3. Node monta `RunAgentRequest { workspace_id, agent_id, policy_snapshot, ... }`.
4. Node faz `POST agent-runtime:8001/agents/{agent_id}/run` com header `Authorization: Bearer ${AGENT_RUNTIME_TOKEN}`.
5. **Python valida apenas o token compartilhado**. Não tenta verificar workspace_id contra DB — confia que o Node fez a validação.
6. Python aplica `SET LOCAL app.workspace_id = $1` no início de toda transaction asyncpg dentro do grafo, usando o valor recebido.

Defesa em profundidade adicional (opcional, fase 2): Node assina o payload completo com HMAC + chave secreta; Python verifica HMAC antes de aceitar. No MVP, token bearer compartilhado + isolamento de rede Docker são suficientes.

Secrets típicos:

| Key | Uso |
|---|---|
| `openrouter_api_key` | API key da plataforma para chamadas OpenRouter (chat completion). Passada via env para `agent-runtime` no boot. |
| `meta_app_id` | Meta App ID compartilhado WhatsApp + Instagram |
| `meta_app_secret` | App Secret para HMAC do webhook unificado |
| `meta_webhook_verify_token` | Token único do verify GET no `/webhooks/meta` |
| `openai_api_key` | OpenAI direto para embeddings/transcription/vision |
| `encryption_key_active_version` | Versão ativa da chave AES (rotação) |

Rotação documentada em `docs/runbooks/rotate-openrouter-key.md` e `docs/runbooks/rotate-meta-app-secret.md`.

### 10.1 Secrets em DB (por-canal)

Cifra com AES-256-GCM. `packages/shared/src/crypto/secret.ts`:

```ts
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(version: number): Buffer {
  // suporta múltiplas versões pra rotação
  return parseKey(env[`ENCRYPTION_KEY_V${version}`]);
}

export function encryptSecret(plain: string, version = CURRENT_VERSION): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(version), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${version}:${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(packed: string): string {
  const [versionTag, body] = packed.split(':');
  const version = parseInt(versionTag.slice(1));
  const [ivB, tagB, encB] = body.split('.');
  const decipher = createDecipheriv(ALGO, getKey(version), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
}
```

`channel_secrets.access_token_enc`, `outbound_webhooks.secret_enc`, `agents.api_token_hash` (esse é hash, não cifra).

### 10.2 Rotação de chave

1. Adicionar `ENCRYPTION_KEY_V2` no `.env`.
2. Setar `CURRENT_ENCRYPTION_KEY_VERSION=2` no env.
3. Cron `rotate_secrets` lê todas as colunas `_enc` com `v1:` → decifra → recifra com v2.
4. Após migração 100%: remove `ENCRYPTION_KEY_V1` do env.

### 10.3 Mídia

R2 já criptografa at rest. Não duplicar com app-level cipher (overhead).

Exceção: se `messages.is_sensitive=true` (flag opcional), aplicar cipher no buffer antes do upload R2. Tradeoff: zero CDN possível. Usar com parcimônia.

### 10.4 TLS

- Nginx termina TLS 1.3 (renegotiation off, HSTS on).
- Certificados Let's Encrypt (renovação automática via certbot).
- HTTP Strict Transport Security 1 ano.

---

## 11. Rate limit

### 11.1 Em rotas Express

`express-rate-limit` por IP em:

- `/auth/login` — 5 attempts / 15 min
- `/auth/reset-password` — 3 attempts / 15 min
- `/webhooks/*` — 100 req/s por IP
- API key request `/api/v1/*` — limite por key (configurável em `api_keys.rate_limit_per_minute`)

Store: Redis (`rate-limit-redis`).

### 11.2 Em outbound

- Por workspace: limites de plano (`plans.limits.messages_per_month`).
- Por campanha: `rate_limit_per_minute` + `daily_limit`.
- Adaptativo Meta: reduz se quality YELLOW; pausa se RED.

### 11.3 Em agents

- Per-conversation: max 1 agent execution concorrente (locker em Redis).
- Per-workspace: limite por plano (`plans.limits.agent_invocations_per_day`).

---

## 12. Deploy

### 12.1 Build

GitHub Actions `ci.yml`:

```yaml
on: [pull_request, push]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:ci
      - run: pnpm build
```

GitHub Actions `deploy.yml` (em push pra `main`):

```yaml
on:
  push:
    branches: [main]
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Login GHCR
        run: echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u ${{ github.actor }} --password-stdin
      - name: Build & push api image
        run: |
          docker build -f infra/docker/api.Dockerfile -t ghcr.io/highermind/api:${{ github.sha }} .
          docker push ghcr.io/highermind/api:${{ github.sha }}
      - name: Build & push workers image
        # similar
      - name: Build & push web image (Next.js standalone)
        run: |
          docker build -f infra/docker/web.Dockerfile -t ghcr.io/highermind/web:${{ github.sha }} .
          docker push ghcr.io/highermind/web:${{ github.sha }}
      - name: Build & push agent-runtime image (Python)
        run: |
          docker build -f infra/docker/agent-runtime.Dockerfile -t ghcr.io/highermind/agent-runtime:${{ github.sha }} apps/agent-runtime
          docker push ghcr.io/highermind/agent-runtime:${{ github.sha }}
      - name: SSH deploy
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: root
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /root/highermind
            export IMAGE_TAG=${{ github.sha }}
            docker compose -f infra/docker/docker-compose.prod.yml pull
            docker compose -f infra/docker/docker-compose.prod.yml up -d --no-deps api web worker-inbound worker-outbound worker-media worker-campaigns worker-flows agent-runtime scheduler
            sleep 15
            curl -fsS http://localhost:3001/health || (docker compose logs --tail=100 api && exit 1)
            docker compose -f infra/docker/docker-compose.prod.yml exec -T api curl -fsS http://web:3000/api/healthz \
              || (docker compose logs --tail=100 web && exit 1)
            docker compose -f infra/docker/docker-compose.prod.yml exec -T api curl -fsS http://agent-runtime:8001/healthz \
              || (docker compose logs --tail=100 agent-runtime && exit 1)
```

### 12.2 Migration

Aplica via `pnpm db:migrate` em hook pre-deploy (no script SSH antes do `up -d`).

### 12.3 Rollback

- Se health check falha após deploy: SSH manual + `IMAGE_TAG=<old-sha> docker compose up -d`.
- Migration de DB **idempotente** e **backwards-compatible** dentro de uma deploy. Migrations destrutivas exigem maintenance window.

### 12.4 Branch protection

- `main` protegida no GitHub.
- Push direto bloqueado via git hook local (`scripts/git-hooks/pre-push`) + branch protection server-side.
- Hotfix exige PR; merge fast-forward (linear history).

---

## 13. Disaster recovery

### 13.1 Plano

| Cenário | RTO | RPO | Plano |
|---|---|---|---|
| VPS down | 4h | 0h | Spin up nova VPS, restore último backup R2, ajustar DNS |
| Postgres corruption | 1h | 24h | Restore último backup (delta de até 1 dia) |
| Redis perdido | 5min | aceitável (cache + locks) | Restart, cache reaquece; locks renegociam |
| RabbitMQ perdido | 30min | aceitável (transitional) | Restart, queues recriadas pela topology setup; mensagens em flight podem perder, retry kicks in |
| WAHA session deauth | 1h | sessão perdida | Re-scan QR code |
| R2 outage | depende Cloudflare | media reads/writes pausados | Switch driver para LocalDriver temporário |

### 13.2 Runbooks

`docs/runbooks/`:

- `dev-environment-windows.md`          — setup do ambiente dev local (Windows 11 nativo: Node via fnm, Python via uv, Docker Desktop); pode ser executado manualmente ou por agente IA
- `claude-code-sync.md` + `claude-config-template/`  — sincronia da config do Claude Code entre máquinas via repo Git privado (CLAUDE.md + settings.json + skills personalizadas)
- `multi-agent-dev.md`                  — desenvolvimento multi-agente: 1 orchestrator Claude + 3-4 workers Claude em paralelo, isolados via Git worktrees + slots com `files_allowed`
- `incident-postgres-down.md`
- `incident-vps-down.md`
- `restore-from-backup.md`
- `rotate-encryption-key.md`
- `rotate-openrouter-key.md`           — rotação de api key da plataforma sem downtime de agentes
- `rotate-meta-app-secret.md`          — rotação de app_secret (cuidado: invalida verify token do webhook)
- `meta-waba-banned-response.md`
- `meta-app-review-instagram.md`       — checklist + scripts pra App Review IG
- `agent-runtime-deploy-rollback.md`   — diferente do Node por usar dependências Python (lock files)
- `manage-workspace-agent-policy.md`   — super-admin: como alterar policy + impacto imediato (cache invalidation)

---

## 14. Observability dashboards (Grafana, futuro)

Métricas a expor (sumarizadas):

- **Throughput:** mensagens inbound/outbound por minuto.
- **Latency:** p50/p95/p99 por handler.
- **Error rate:** % de jobs DLQ.
- **Queue lag:** backlog de cada fila.
- **DB:** active connections, slow queries, table sizes.
- **Agents:** tokens/min, cost/dia por workspace.
- **Campaigns:** delivery rate, block rate por campanha ativa.

Backend: Prometheus + Grafana, ou serviço gerenciado (Grafana Cloud free tier suficiente).

---

## 15. Não-objetivos do MVP infra

- Kubernetes (Docker Compose é suficiente até ~100 workspaces ativos).
- Multi-region (single Brasil é suficiente).
- Read replicas Postgres (single master é suficiente até ~1M conversas).
- CDN para mídia (R2 + signed URL direto é suficiente; CDN entra com `media.<domínio>` opcional).
- Multi-cluster Redis (single instance suficiente).
- DB sharding por workspace (não necessário até centenas de milhares de workspaces).

---

## 16. Próximos passos pós `/hm-init`

1. Criar `infra/docker/` com Dockerfiles (api, workers, **agent-runtime Python**) + compose.
2. Provisionar VPS Hetzner (ou usar a atual, migrando incrementalmente).
3. Setup Nginx + Let's Encrypt para `api.<domínio>` e `app.<domínio>`.
4. Setup R2 bucket + credentials.
5. Setup GitHub Actions CI/CD (jobs separados Node + Python).
6. Setup Pino (Node) + loguru (Python) + OpenTelemetry no boilerplate.
7. Setup OpenRouter API key na plataforma + sincronização inicial de `llm_models_whitelist`.
8. Setup Meta App único (Tech Provider WA + IG) + webhook `/webhooks/meta` configurado no App Dashboard.
9. Configurar branch protection no GitHub.
