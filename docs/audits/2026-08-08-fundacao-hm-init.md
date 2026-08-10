# Auditoria de fundação — `/hm-init` sobre repo existente

> **Data:** 2026-08-08 · **HEAD auditado:** `53b6364e` · **Branch:** `main`
> **Método:** clone limpo + execução real de todos os gates (install, typecheck,
> lint, audit, migrations, suíte completa contra Postgres/Redis/RabbitMQ de pé) +
> leitura de configuração de build, CI, compose de dev e prod, e do harness de slots.
> **Convenção:** todo achado abaixo tem evidência executável ou `arquivo:linha`.
> Nada foi modificado no código de produto.

---

## 1. Veredito

A fundação de engenharia **passa** no padrão. Isto é medição, não cortesia:

| Gate | Resultado no HEAD `53b6364e` |
|---|---|
| `pnpm typecheck` | ✅ exit 0 — 12 projetos |
| `pnpm lint` | ✅ exit 0 |
| `any` / `as any` / `<any>` em `apps` + `packages` | **0** |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | **0** |
| `eslint-disable` | 5, todos justificados inline |
| `tsconfig.base.json` | `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noPropertyAccessFromIndexSignature` + `verbatimModuleSyntax` |
| Migrations | 67 `.sql`, aplicam limpas em banco novo |
| RLS | 75 tabelas com RLS, 77 policies, `FORCE RLS` via `0062` |
| Testes | 218 arquivos, ~1.900 testes |
| Segredo commitado | **nenhum** — só `.env.example`, `.env.production.example`, `landing/.env.example` |
| Security headers | helmet + CSP + HSTS + CORS por allowlist (`apps/api/src/middlewares/security.ts`) |

O tier crítico da `AUDITORIA_TECNICA.md` (2026-07-09) foi **fechado** pela fase F56 —
verifiquei sete achados um por um no código atual, incluindo o P0 do runtime de IA,
o bypass de auth por `AUTH_PROVIDER=mock`, `FORCE ROW LEVEL SECURITY` e o SSRF de
webhook outbound.

**O que não passa é o cinturão de segurança em volta disso.** Três coisas, em ordem
de consequência:

1. **O CI do `main` está vermelho e ninguém está sendo avisado.**
2. **27 vulnerabilidades HIGH em dependência**, várias no caminho de tráfego de tenant.
3. **Migration roda em produção sem snapshot prévio.**

Nenhuma das três é dívida de arquitetura. Todas são plumbing — e é justamente por isso
que estarem abertas é grave: são baratas de fechar e caras de ignorar.

---

## 2. Achados

### F-01 · CRÍTICO — CI vermelho no `main` desde ~2026-06-30; CD nunca rodou

Últimos 5 runs de `main`: `failure`, `cancelled`, `failure`, `failure`, `failure`.
Run do HEAD atual (`29623760575`): `ci` **failure**, `e2e` **failure**,
`python` success, `deploy` **skipped**.

Como o job `deploy` declara `needs: [ci, python, e2e]`, ele é pulado em **todo** push.
O CD do repositório nunca executou; produção só sobe por `deploy.sh` manual na VPS.
E, mais importante: **nada bloqueia merge em `main`**. Os 1.900 testes, o typecheck,
o lint e o teste de isolamento RLS existem — mas não têm poder de veto. As 407 entregas
de slot foram feitas com o semáforo desligado.

Duas causas, ambas de ambiente, **nenhum bug de produto**:

- **`ENCRYPTION_KEY` ausente** do bloco `env:` do job `ci`
  (`.github/workflows/ci.yml:44-48` define só `DATABASE_URL`, `REDIS_URL`,
  `AMQP_URL`, `NODE_ENV`). Quebra 9 testes em `apps/api` + `apps/workers` que cifram
  segredo de webhook.
- **Catálogo de planos não semeado.** `provisionWorkspaceWithOwner`
  (`packages/db/src/provisioning/provision.ts:69`) aborta com *"Plano free ausente no
  catálogo"*. O CI roda `migrate` mas nunca `seed`, e nenhuma migration popula
  `plans` (`select count(*) from plans` = 0 em banco recém-migrado).

Reprodução local bateu **idêntica** ao CI: `@hm/db` → 7 failed | 69 passed (76).
Com infra de pé, o total foi 23 falhas em ~1.900 — **todas** de ambiente.

O job `e2e` falha à parte: o comentário do workflow (`ci.yml:112-115`) promete
*"toda a rede que sai do browser é interceptada"*, mas os rewrites de `/api`,
`/auth` e `/socket.io` são resolvidos **no servidor** Next contra
`localhost:3001` — o log mostra `ECONNREFUSED` em série para `/api/me`,
`/api/conversations`, `/api/flows`, `/api/teams` e outros.

→ **F57-S01** (ci), **F57-S02** (e2e)

### F-02 · CRÍTICO — 27 HIGH no `pnpm audit`, sem gate no CI

`pnpm audit`: **27 high · 12 moderate · 2 low · 0 critical**. Nenhum job roda audit —
por isso acumulou em silêncio. O padrão é explícito: zero HIGH/CRITICAL.

Exposto a tráfego de tenant:

| Pacote | Instalado | Mínimo | Relevância **aqui** |
|---|---|---|---|
| `next` | 15.5.19 | 15.5.21 | SSRF em **rewrites** com hostname controlado pelo atacante — e o `apps/web` roteia `/api`, `/auth`, `/socket.io` exatamente por rewrite. Mais: SSRF em Server Actions em custom server, DoS no App Router |
| `socket.io-parser` | 4.2.6 | 4.2.7 | Memory exhaustion; Socket.io **público** em `app.leadium.com.br/socket.io` |
| `ws` | 8.20.1 | 8.21.0 | Memory exhaustion DoS no mesmo caminho de WebSocket |
| `sharp` | 0.34.5 | 0.35.0 | CVEs do libvips; processa **mídia enviada por tenant** |
| `form-data` | 4.0.5 | 4.0.6 | CRLF injection em multipart |
| `fast-uri` | ≤3.1.3 | 3.1.5 | Host confusion via `\` |

Build-time/transitivo: `postcss` (leitura arbitrária de `.map`), `brace-expansion`,
`js-yaml`, `nanoid`, `shell-quote`, `esbuild`, `protobufjs`, `uuid`, dois pacotes
OpenTelemetry. O `pnpm-workspace.yaml` **já tem** o mecanismo certo (`overrides:`,
usado para `rollup` no F10-S13) — está subutilizado.

→ **F57-S03**

### F-03 · ALTO — Migration em produção sem snapshot

`scripts/deploy.sh` faz build → `stack deploy` → espera Postgres → **migra** (§6,
6 tentativas) → verifica convergência de sha. Não há etapa de backup.
`grep -rl 'pg_dump'` acerta apenas docs e slots — **nenhum script executável**.
O runbook `docs/runbooks/restore-from-backup.md` existe e descreve como restaurar,
mas o deploy não produz o artefato que o runbook pressupõe.

O resto do script é notavelmente bom — tag por sha, `start-first`, e a verificação
explícita de convergência (`deploy.sh:98-127`) que fecha o buraco do "deploy verde com
serviço para trás". Esta é a lacuna que sobrou, e é a única que perde dados.

→ **F57-S07**

### F-04 · ALTO — Contexto de build da `landing/` sem `.dockerignore`; nginx como root

6 Dockerfiles, 2 `.dockerignore`. O da raiz é excelente — mas vale só para contexto
de raiz. O serviço `landing` usa `context: ../../landing`
(`docker-compose.prod.yml:355`) e `landing/Dockerfile` faz `COPY . .`: `node_modules`,
`dist` e um eventual `landing/.env` entram no contexto e na camada de build.

Nem `landing/Dockerfile` nem `infra/docker/landing/Dockerfile` têm `USER` — o master
do `nginx:1.27-alpine` roda como **root**, no serviço mais exposto (rede
`network_public`, atrás do Traefik) e de menor valor do stack.

→ **F57-S05**

### F-05 · ALTO — Colisão de porta no dev que se disfarça de erro de credencial

`docker-compose.dev.yml` publica `5432`, `6379`, `5672`, `15672` em `0.0.0.0`.
Na máquina do fundador **já existe** um Postgres nativo em `0.0.0.0:5432`
(`postgres.exe`, PID 7700). O `up` reportou `Up (healthy)` e `docker port` listou o
mapeamento — **sem erro de bind** — mas toda conexão do host cai no Postgres nativo:

```
pnpm --filter @hm/db migrate  →  code: '28P01', routine: 'auth_failed'
```

O sintoma diz "senha errada"; a causa é "porta de outro processo". Confirmado que o
container está sadio (`docker exec … psql -U hm` → `hm`); republicado em `55432`, as
67 migrations aplicaram limpas. O compose **já resolveu isso para o WAHA**
(`3100:3000`, com comentário) — a lição só não foi aplicada ao resto.

Junto: bind em `0.0.0.0` expõe Redis sem senha e RabbitMQ com `hm/hm` à rede local;
`devlikeapro/waha:latest` sem pin e sem API key; e drift de major do Prometheus
(`v3.1.0` dev vs `v2.53.1` prod).

→ **F57-S06**

### F-06 · MÉDIO — Segredos de produção como env var no spec do Swarm

`x-app-env` (`docker-compose.prod.yml:14-56`) injeta ~13 segredos por env, incluindo
`ENCRYPTION_KEY` (chave-mestra do AES-256-GCM at-rest), `SUPABASE_SERVICE_KEY`,
`META_APP_SECRET` e `ABACATEPAY_API_KEY`.

O armazenamento está correto — nada hardcoded, tudo `${VAR}`, `.env` fora do git.
O **mecanismo de entrega** é o problema: env var de serviço Swarm fica em claro em
`docker service inspect`, em `/proc/<pid>/environ`, e em qualquer dump de ambiente
(o stack tem Sentry). Swarm secrets resolvem: cifrados no Raft, montados em tmpfs,
invisíveis ao `inspect`.

→ **F57-S08**

### F-07 · MÉDIO — O artefato que roda em produção nunca foi testado

`deploy.sh:56-59` constrói as 5 imagens **no nó de produção**. Logo: (a) o CI testa o
código, mas a imagem é construída depois, noutro host, com outro cache — ninguém
testou o binário que atende tenant; (b) `pnpm install` + `next build` competem com o
tráfego no mesmo nó, com limites apertados (`api: 768M`, `web: 384M`); (c) as imagens
só existem no disco daquele nó — perdeu o nó, rollback exige rebuild dentro do
incidente.

Correlato: `api` e `workers` não são multi-stage de verdade (`FROM deps` no stage
`runtime`), então levam o workspace inteiro e `devDependencies` para produção. É
deliberado (`tsx` roda em runtime) e documentado no Dockerfile — mas é consequência do
mesmo acoplamento build↔runtime.

→ **F57-S09**

### F-08 · MÉDIO — Lint não vê promise solta nem regra de hook

`eslint.config.mjs:21` usa `tseslint.configs.recommended` — a variante **sem** tipos.
Ficam de fora `no-floating-promises`, `no-misused-promises`, `await-thenable`. Num
backend com 5 consumers RabbitMQ + Socket.io + scheduler, promise não-aguardada é a
causa clássica de *"mensagem de cliente sumiu sem erro no log"* — o `ack` acontece, o
trabalho não. A regra é gratuita e o repo já tem toda a config de tipos.

E `apps/web` (React 19, ~69k LOC) não tem `eslint-plugin-react-hooks`. A ironia mede o
gap: **`landing/`**, um app Vite estático, **tem** (`landing/eslint.config.js:11`).
O produto de verdade não.

Também: `eslint.config.mjs:19` ignora `**/*.config.{js,mjs,cjs,ts}` — `next.config.ts`,
`playwright.config.ts`, `drizzle.config.ts` não são verificados.

→ **F57-S10**

### F-09 · MÉDIO — 1.900 testes, zero medição

Nenhum dos 9 `vitest.config.ts` define `coverage`/`thresholds`; nenhum
`@vitest/coverage-v8` instalado; o CI nunca coleta. O `CLAUDE.md` afirma *"testes
acompanham o código"* e o `_TEMPLATE.md` traz `[ ] Testes do feliz path passam` no
DoD — nada disso é verificável. Um slot pode entregar 800 linhas sem teste e ficar
verde. Com 407 slots entregues, ninguém sabe onde estão os vazios.
(`apps/workers` roda `vitest run` sem `vitest.config.ts` próprio.)

→ **F57-S11**

### F-10 · MÉDIO — Guard anti-colisão de migrations desligado

`tasks/slot.config.json` → `"migrations": { "enabled": false, "path": null }` — num
repo com **67 migrations** e journal em `packages/db/drizzle/meta/`. O `slot.py`
expõe `check-migrations` ("opt-in via slot.config.json") e o opt-in nunca foi feito.

Migration é o recurso mais colidível em desenvolvimento paralelo por agentes: dois
slots geram `0067_*.sql`, ambos passam no `validate`, o conflito aparece no merge — ou
no `deploy.sh`. **Já mordeu:** commit `99956380` — *"fix(db): registra no journal a
migration 0066"*. A ferramenta de prevenção está escrita e desarmada.

Junto: `phases` nomeia F0–F10, F38, F41 de um board que vai a F56; e as **12 skills
de slot não estão no repo** (`git ls-files .claude` → só os 7 agentes, sem
`.claude/skills/`).

→ **F57-S12**

### F-11 · ALTO (supply chain) — Workflow sem `permissions`, actions por tag, TOFU cego no deploy

- Nenhum bloco `permissions:` → `GITHUB_TOKEN` herda o default do repositório,
  potencialmente `write`, disponível a qualquer step (inclusive scripts de build
  aprovados no `allowBuilds`).
- Actions por tag mutável (`checkout@v4`, `setup-node@v4`, `action-setup@v4`,
  `setup-uv@v5`, `upload-artifact@v4`) — quem controla o repo da action muda o que
  roda no nosso pipeline, com o nosso token.
- `ci.yml:178`: `ssh-keyscan -H "$VPS_HOST" >> ~/.ssh/known_hosts` — aceita
  **qualquer** host key. Quem conseguir responder pelo host recebe a chave SSH de
  deploy (escrita em disco no step anterior). Zero verificação de identidade.

→ **F57-S04**

### F-12 · BAIXO — README e AUDITORIA_TECNICA desatualizados

`README.md:10` diz *"**Apenas documentação** […] o código será materializado pelo
`/hm-init` na fase seguinte"* e lista `apps/`, `packages/`, `infra/` como
**"(em breve)"** — num repo com 1.512 arquivos TS e produção no ar. A stack no README
diz "Docker Compose + Nginx via aaPanel"; o real é **Swarm + Traefik**.

`AUDITORIA_TECNICA.md` (65 KB, na raiz) está congelada em `933a145b` e não marca o que
F56 resolveu. Um agente que leia o §1 hoje re-trabalha o já feito.

→ **F57-S13**

---

## 3. O que está genuinamente acima da média

Registrado para calibrar as críticas acima e para não ser "melhorado" por engano:

- **`packages/db/src/rls.test.ts`** — isolamento A/B tabela por tabela. É o melhor
  arquivo de teste do repo.
- **`deploy.sh:98-127`** — cruza o sha da task **rodando** de cada serviço contra o do
  deploy e falha alto. Nasceu de um incidente real (`7637ccf`, agent-runtime revertido
  em silêncio) e é exatamente a lição certa, codificada.
- **`x-update-policy`** com `failure_action: pause` em vez de `rollback`, com a
  justificativa escrita no próprio compose. Decisão madura: pausa é detectável,
  rollback silencioso não.
- **Isolamento da infra em prod** — Postgres/Redis/RabbitMQ em `leadium_internal`, sem
  porta publicada, sem reusar as stacks de terceiros da VPS.
- **`pnpm-workspace.yaml`** — `allowBuilds` decidido pacote por pacote, com o porquê
  de cada `false` (`msw`, `@scarf/scarf`).
- **`.env.example`** — placeholders deliberadamente inválidos, com comentário
  distinguindo o que é público por design (`NEXT_PUBLIC_*`, DSN do Sentry) do que é
  segredo.
- **`.dockerignore` da raiz** — nega `.env` em três padrões diferentes.
- Comentários que explicam **por que**, não o que. `apps/web/Dockerfile` sobre o Next
  congelar rewrites em build-time vale meia hora de depuração para quem vier depois.

---

## 4. Ordem de execução recomendada

```
F57-S01  ci verde (ENCRYPTION_KEY + catálogo self-contained)   ← primeiro, sempre
F57-S02  e2e determinístico
F57-S12  harness: guard de migrations + skills                  ← barato, protege o resto
F57-S03  zerar HIGH do audit + gate                             (precisa de S01)
F57-S04  hardening do workflow
F57-S05  .dockerignore da landing + nginx non-root
F57-S06  portas do dev + WAHA
F57-S07  backup pré-migration                                   ← o de maior consequência
F57-S08  secrets do Swarm
F57-S11  piso de cobertura
F57-S10  lint type-aware + react-hooks                          (lote grande; sub-slots)
F57-S09  build em CI + registry                                 (precisa de S01, S04)
F57-S13  docs refletem o real
```

**Lote paralelo** — não deduza por leitura, pergunte ao harness.
`python scripts/slot.py plan-batch --max 3` no estado atual devolve:

```
  - F57-S01 [critical] -> db-engineer        (worktree isolada)
  - F57-S05 [high]     -> backend-engineer   (worktree isolada)
  - F57-S12 [medium]   -> backend-engineer   (worktree isolada)

  Adiados: F57-S02, F57-S04, F57-S06  (files_overlap com F57-S01)
           F57-S07, F57-S08           (files_overlap com F57-S05)
```

O gargalo de paralelismo desta fase é concreto: **`.github/workflows/ci.yml` está em
`files_allowed` de S01, S02, S03, S04, S09 e S11**, e `docker-compose.prod.yml` em
S05, S07, S08 e S09. Cinco dos treze slots convergem no mesmo arquivo de CI. Ou o
lote é pequeno (3, como acima), ou vale extrair um sub-slot que faça **toda** a
edição do workflow de uma vez e deixe os demais sem tocá-lo — decisão do orchestrator
na hora de disparar.

`isolation='worktree'` é obrigatório no disparo.

**Regra provisória até o F57-S07 fechar:** `pg_dump` manual antes de todo deploy que
carregue migration nova.
