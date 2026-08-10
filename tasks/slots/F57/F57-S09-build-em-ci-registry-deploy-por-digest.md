---
id: F57-S09
title: Build em CI + registry — deploy por digest, não build no nó de produção
phase: F57
status: available
priority: medium
estimated_size: L
depends_on: [F57-S01, F57-S04]
blocks: []
agent_id: backend-engineer
source_docs:
  - scripts/deploy.sh
  - apps/api/Dockerfile
  - docs/audits/2026-08-08-fundacao-hm-init.md
---

# F57-S09 — O artefato que roda em produção nunca foi testado por ninguém

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08).

## Objetivo

Separar build de deploy: CI constrói e testa a imagem, registry guarda, produção
apenas *puxa* por digest imutável.

## Contexto / causa raiz (verificada)

`scripts/deploy.sh:56-59` constrói **as 5 imagens no nó de produção**:

```bash
docker compose --env-file "$APP_DIR/.env" -f "$COMPOSE" build
```

Três problemas encadeados:

1. **O artefato testado ≠ o artefato executado.** O CI testa o *código*; a imagem é
   construída depois, num host diferente, com cache de builder diferente e resolução
   de dependência num instante diferente. Ninguém jamais testou o binário que atende
   os tenants.
2. **Build compete com tráfego.** `pnpm install --frozen-lockfile` + `next build` no
   mesmo nó que serve `app.leadium.com.br`, com Postgres/Redis/RabbitMQ ao lado e
   limites de memória apertados (`api: 768M`, `web: 384M`). Deploy degrada produção.
3. **Sem rollback de artefato.** A tag é o sha do commit (bom!), mas as imagens só
   existem no disco daquele nó. Perdeu o nó, perdeu todas as versões: rollback exige
   rebuild — dentro do incidente.

Além disso, as imagens de `api` e `workers` **não são multi-stage de verdade**: o
stage `runtime` faz `FROM deps`, herdando o workspace inteiro, `devDependencies`
(`tsx` roda em runtime, então isso é deliberado e documentado) e o cache de build.
Ou seja: código-fonte completo, ferramentas de dev e superfície de ataque
desnecessária na imagem de produção — o oposto do que o padrão pede para o stage
final. É a mesma raiz: build acoplado a runtime.

## Escopo (faz)

- Job novo no CI que constrói as 5 imagens e publica no GHCR (`ghcr.io/rogerio-auto/…`),
  taggeado por sha **e** por digest.
- `deploy.sh` deixa de buildar: passa a `docker pull` por **digest** e
  `docker stack deploy`. Adicionar `--with-registry-auth` (já está) e login no GHCR.
- Rodar smoke test contra a imagem construída **no CI**, antes de publicar (subir o
  container, bater no `/health`).
- Para `api`/`workers`: avaliar `pnpm deploy --filter` (ou `--prod` + build TS) para
  produzir um stage final enxuto sem o workspace inteiro. Se a decisão for manter
  `tsx` em runtime, **documentar a escolha e o trade-off** no `ARCHITECTURE.md` — o
  que não pode acontecer é a imagem gorda ser acidente.
- Manter caminho de emergência: flag no `deploy.sh` para build local, para o caso de
  registry inacessível durante incidente.

## Escopo (não faz)

- Multi-nó / réplicas > 1 (é decisão de escala, não de fundação).
- Backup pré-migration → **F57-S07**.
- Secrets → **F57-S08**.

## Arquivos permitidos

- `.github/workflows/ci.yml`
- `.github/workflows/**` (workflow novo, se preferir separar)
- `scripts/deploy.sh`
- `scripts/deploy.ps1`
- `infra/docker/docker-compose.prod.yml`
- `apps/api/Dockerfile`
- `apps/workers/Dockerfile`
- `apps/web/Dockerfile`
- `apps/agent-runtime/Dockerfile`
- `docs/runbooks/deploy-production.md`
- `docs/runbooks/rollback-deploy.md`
- `docs/ARCHITECTURE.md`

## Definition of Done

- [ ] CI publica as 5 imagens no GHCR por sha; smoke test roda antes do push.
- [ ] `deploy.sh` não invoca `docker build` no caminho normal; resolve e deploya por
      **digest**.
- [ ] Rollback para o deploy anterior = um comando, sem rebuild (testado de verdade).
- [ ] Imagens de `api`/`workers` sem `pnpm-lock.yaml`/`docs`/`tasks`/código de teste,
      **ou** decisão documentada no `ARCHITECTURE.md`.
- [ ] A verificação de convergência de sha existente em `deploy.sh:98-127` continua
      funcionando com digest.

## Validação

```bash
bash -n scripts/deploy.sh
docker compose -f infra/docker/docker-compose.prod.yml config
```

## Notas

- `depends_on: F57-S01` porque publicar imagem a partir de um CI vermelho é publicar
  às cegas. `depends_on: F57-S04` porque este slot dá ao CI permissão de escrita em
  packages — o bloco `permissions:` precisa existir **antes**, para conceder escopo
  pontual em vez de herdar o default.
- Não introduza `:latest` em produção. A nota em `deploy.sh:50-52` sobre o Swarm não
  recriar serviço com tag fixa é conhecimento duramente adquirido — preserve-a.
