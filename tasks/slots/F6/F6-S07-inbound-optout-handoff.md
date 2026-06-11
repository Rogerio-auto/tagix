---
id: F6-S07
title: Inbound hooks — opt-out por keyword + reply handling (mark responded + AI handoff + followup)
phase: F6
status: in-progress
priority: high
estimated_size: M
depends_on: [F6-S01]
agent_id: backend-engineer
claimed_at: 2026-06-11T05:14:50Z

---
# F6-S07 — Inbound hooks de campanha

> **source_docs:** `docs/features/CAMPAIGNS.md` §8.3, §9.3, §16; `docs/ROADMAP.md` F6-S05 (opt-out), F6-S09 (AI handoff)
> **blocks:** —

## Objetivo
Conectar mensagens inbound às campanhas: (1) **opt-out por keyword** (STOP/PARAR/SAIR/CANCELAR/REMOVER/DESCADASTRAR) → opta o contato out + remove de campanhas MARKETING futuras + confirmação automática; (2) **reply handling** — se a conversa teve delivery recente (janela 7d), marca recipient `responded`, faz **AI handoff** se `campaign.auto_handoff_on_reply`, e dispara followup `on_reply`.

## Escopo (faz)
- `apps/workers/src/campaigns-inbound/**`: `isOptOutKeyword` + `optOutContact` (§9.3, com confirmação anti-falso-positivo §16) e `handleContactReply` (§8.3: lookup delivery 7d via conversation→recipient, marca responded, handoff, publica `campaign.followup` event).
- O ponto de chamada no pipeline inbound (após persistir a mensagem) é gap-fill do orchestrator (1-2 linhas), mantendo o worker-inbound F1 intocado fora do hook.

## Fora de escopo
- Followup processor (F6-S06 consome o event), worker de envio (F6-S05), API de opt-out manual (F6-S04).

## Arquivos permitidos
- `apps/workers/src/campaigns-inbound/**`

## Definition of Done
- [ ] Keyword de opt-out opta o contato out (com confirmação) e o exclui de campanhas MARKETING; teste cobre keyword exata vs texto que só contém a palavra.
- [ ] Reply em janela 7d de uma delivery marca `responded` + faz handoff (se configurado) + publica followup `on_reply`.
- [ ] `pnpm --filter @hm/workers test` + lint/typecheck verdes.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/workers test
```

## Notas
- Especialista sugerido: **backend-engineer**.
- Opt-out só em match EXATO da keyword (normalizado upper/trim) — não em "quero PARAR de receber" (§9.3). Anti-falso-positivo: confirmação "Confirma que quer parar?" (§16).
