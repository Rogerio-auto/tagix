---
id: F57-S04
title: Hardening do workflow — permissions mínimas, actions por SHA, host key pinado
phase: F57
status: available
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: security-auditor
source_docs:
  - .github/workflows/ci.yml
  - docs/audits/2026-08-08-fundacao-hm-init.md
---

# F57-S04 — Hardening do pipeline de CI/CD

> **Origem:** auditoria de fundação (/hm-init, 2026-08-08). O workflow tem três
> fraquezas de supply chain, todas de correção pequena.

## Objetivo

Reduzir o raio de dano de um comprometimento de action, de token ou de rede durante
o deploy.

## Contexto / causa raiz (verificada)

1. **Sem bloco `permissions:`.** `.github/workflows/ci.yml` não declara nenhum
   escopo, então o `GITHUB_TOKEN` herda o default do repositório — potencialmente
   `write` em conteúdo, packages, issues e PRs. Qualquer step comprometido
   (incluindo qualquer transitivo de `pnpm install`, que roda scripts de build
   aprovados no `allowBuilds`) recebe esse token pelo ambiente.

2. **Actions por tag mutável.** `actions/checkout@v4`, `actions/setup-node@v4`,
   `pnpm/action-setup@v4`, `astral-sh/setup-uv@v5`, `actions/upload-artifact@v4`.
   Tag é ponteiro móvel: quem controla o repo da action muda o que executa dentro
   do nosso pipeline, com o nosso token.

3. **TOFU cego no deploy.** `.github/workflows/ci.yml:178`:
   ```
   ssh-keyscan -H "$VPS_HOST" >> ~/.ssh/known_hosts
   ```
   Aceita **qualquer** host key apresentada naquele momento. Um atacante capaz de
   responder pelo host recebe a chave SSH privada de deploy (escrita em disco no
   step anterior) e a sessão. Não há verificação alguma de identidade do servidor.

## Escopo (faz)

- `permissions: contents: read` no topo do workflow; elevar por job **só** onde
  necessário (o job `e2e` precisa de escrita para `upload-artifact`? confirmar e
  conceder pontualmente).
- Pin de **todas** as actions por SHA completo, com comentário `# vX.Y.Z` ao lado.
- Substituir o `ssh-keyscan` por host key pinada em secret
  (`VPS_SSH_HOST_KEY`), escrita direto no `known_hosts`. Falhar o deploy se o
  secret não existir (fail-closed — hoje o job já é no-op sem `VPS_HOST`, manter
  esse comportamento para o caso "VPS não configurada", mas **nunca** cair em
  keyscan cego quando a VPS existe).
- Adicionar `environment:` ao job `deploy` (habilita required reviewers / proteção)
  e `concurrency` própria, para dois pushes não deployarem em paralelo.

## Escopo (não faz)

- Mover o build para CI + registry → **F57-S09**.
- `pnpm audit` → **F57-S03**.

## Arquivos permitidos

- `.github/workflows/ci.yml`
- `docs/runbooks/deploy-production.md`

## Arquivos proibidos

- `scripts/deploy.sh` (é de **F57-S07** e **F57-S09**)

## Definition of Done

- [ ] `permissions:` explícito; nenhum job com mais escopo do que usa.
- [ ] 100% das actions pinadas por SHA de 40 caracteres.
- [ ] Deploy verifica host key a partir de secret; sem o secret, falha com mensagem
      clara (não faz keyscan).
- [ ] Job `deploy` com `environment` e `concurrency` próprios.
- [ ] Runbook `deploy-production.md` documenta como obter e rotacionar a host key.

## Validação

```bash
pnpm lint
```

## Notas

- Como extrair a host key para o secret:
  `ssh-keyscan -t ed25519 <host>` **numa rede confiável**, e conferir o fingerprint
  contra o que o console do provedor mostra. O ponto não é nunca usar keyscan — é
  não usá-lo cegamente dentro do pipeline em cada run.
- Este slot não tem teste automatizado; a validação é revisão do diff + um run real
  do workflow.
