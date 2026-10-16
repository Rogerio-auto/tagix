# Pendências da construção F73–F76 (Copiloto, Loja de Integrações, Mascote)

> Arquivo de **acúmulo**. Os agentes anotam aqui o que ficou para trás ou depende do Rogério, sem parar a
> construção. No fim da construção o Rogério lê este arquivo e resolve cada ponto, um a um.
> Formato de cada item: `- [ ] <SLOT> — <o que falta> — **Precisa de:** <quem/o quê> — **Impacto:** <o que fica sem prova/sem funcionar> — **Como fechar:** <passo cirúrgico>`.

## Decisões de produto (do Rogério)

- [ ] F75-S16 — confirmar se algum flow em produção chama host interno/porta baixa/resposta > 1 MiB (passam a falhar após o deploy) — **Precisa de:** Rogério (consulta no banco de produção antes do deploy) — **Impacto:** flow legítimo pode parar — **Como fechar:** `SELECT` nos nós `http_request` dos flows publicados; se houver host interno legítimo, pôr em `HM_FLOW_HTTP_ALLOWLIST`.

## Credenciais, contas e serviços externos

## Provas que não puderam ser executadas (infra, dispositivo, custo)

## Dívida técnica e achados fora de fronteira (slots futuros)

- [ ] F75-S16 (para F75-S13) — guard SSRF compartilhado (`packages/shared/src/net/ssrf-guard.ts`) não bloqueia fec0::/10, 2002::/16 (6to4 com v4 interno), 64:ff9b:1::/48, 2001::/32 (Teredo), 100::/64 — **Precisa de:** slot de `@hm/shared` (F75-S13) — **Impacto:** fail-closed incompleto em IPv6 raro (pouco roteável na VPS) — **Como fechar:** acrescentar as faixas em `isBlockedIpAddress` com teste.
- [ ] F75-S16 — `FlowHttpRequest` (`packages/flow-engine/src/types.ts`) e `docs/features/FLOW_BUILDER.md` não citam o teto de 1 MiB, 5 redirects, portas permitidas e `HM_FLOW_HTTP_ALLOWLIST` — **Precisa de:** F75-S13 — **Impacto:** documentação desatualizada — **Como fechar:** atualizar comentário e doc.
- [ ] Infra dev — Postgres nativo do Windows ocupa `localhost:5432`; o container dev só é alcançável via override fora do repo em 5442 — **Precisa de:** slot de infra (parametrizar `${POSTGRES_HOST_PORT:-5432}` no compose dev) — **Impacto:** quem sobe o compose cru não roda testes de banco — **Como fechar:** uma linha no compose + runbook.

## Itens bloqueados de propósito (v1.1)

- [ ] F73-S16 — "Mover sozinho" do piloto automático — **Precisa de:** dado de aceitação (>= 70% de aceite e <= 3% de desfazer por 30 dias) — **Impacto:** o piloto só sugere e aguarda aprovação — **Como fechar:** destravar o slot depois da telemetria.
