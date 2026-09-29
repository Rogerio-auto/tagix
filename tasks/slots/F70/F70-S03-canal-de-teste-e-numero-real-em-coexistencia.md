---
id: F70-S03
title: Canal de teste agora; número real em coexistência quando tudo estiver pronto
phase: F70
status: blocked
priority: critical
estimated_size: M
depends_on: [F70-S02]
blocks: [F70-S04, F70-S05]
source_docs:
  - rogerio-os/tasks/central-operacao/CO-04-canal-de-teste-agora-numero-real-em-coexistencia-quando-tudo.md
  - docs/runbooks/connect-whatsapp-coexistence.md
---
# F70-S03 — Canal de teste agora; número real em coexistência quando tudo estiver pronto

> Espelho do **CO-04** da Central de Operação (`rogerio-os/tasks/central-operacao/`).

## Objetivo

Desenvolver e testar o atendimento com o número de teste da Meta e, no fim, ligar o número do Rogério em coexistência (app do celular + Cloud API) com o ciclo real validado.

## Contexto

Parser e worker de coexistência existem (`packages/channels/src/meta/whatsapp/coexistence.ts`, `apps/workers/src/coexistence/db-ports.ts`), mas foram construídos sem número real: os riscos R1–R6 do runbook nunca foram validados.

## Escopo

### files_allowed

- `packages/channels/src/meta/whatsapp/**`
- `apps/workers/src/coexistence/**`
- `docs/runbooks/connect-whatsapp-coexistence.md`

## Escopo (faz)

- Decisão de 24/09: **o número real só é conectado quando o resto estiver rodando.** Até lá, canal com o **número de teste da Meta** (Cloud API) no workspace do Rogério, para F70-S04..S06 serem desenvolvidos e testados.
- No fim: seguir `docs/runbooks/connect-whatsapp-coexistence.md` com o número real.
- Validar R1–R6 (nomes de campo, PIN, tipos fora do enum, ordem do histórico) e corrigir o que falhar.
- Confirmar em produção: mensagem recebida, eco do app e histórico aparecem na conversa certa.
- Atualizar o runbook com o que foi aprendido.

## Fora de escopo

- Autoria do eco e pausa da IA (F70-S04).
- Atribuição de anúncio (F70-S05).

## Passos do Rogério 🧑

- Usar o número no app WhatsApp Business (≥ 2.24.17) por pelo menos 7 dias antes do onboarding.
- Fazer o Embedded Signup (login Meta, PIN).
- **O número é o pessoal do Rogério:** no onboarding, **não compartilhar o histórico** de conversas. Conferir o nome exibido aprovado pela Meta.
- Mandar mensagens de teste do celular para validar o eco.

## Definition of Done

- [ ] R1–R6 marcados como validados ou corrigidos no runbook
- [ ] 3 cenários provados em produção: inbound, eco do app, histórico
- [ ] teste automatizado para cada correção feita no parser

## Estado real (conferido em produção, 29/09/2026, só leitura)

- **Canal:** `meta_whatsapp` "Arcada Rogério" (`cc6ca56b-d524-46d7-bc1d-b6d6b00193dc`), modo **coexistência**, ativo desde 25/09.
  - WABA `395375790331443`, conta "Rogerio Viana", portfólio 3d_viana (`997352610954716`), número +55 69 9967-0030, compartilhada com o Sólio com controle total.
  - Workspace: **Leadium** (`afe23bf3-…`), o único de produção, com a trava de origem ligada (F70-S30).
- **O número real entrou antes do previsto:** a decisão de 24/09 era conectar só no fim. O canal de teste da Meta foi pulado, e o número real já recebe inbound e ecos do app.
- **Histórico não foi compartilhado**, como decidido: nenhum webhook `history` chegou, e as mensagens começam em 25/09 14:31, no momento da conexão (988 mensagens até 29/09: 613 do contato, 210 ecos antigos gravados antes da F70-S04 e 165 ecos do app).
- **Pendência:** `channels.phone_number` está vazio. O canal foi conectado pelo conector antigo, antes do hotfix `d774835a`, que resolve o número pela WABA. Dá para preencher numa próxima conexão ou num backfill pontual.
- **Entra no fluxo da Arcada?** Ainda não:
  - o agente "Arcada — atendimento" não existe em produção (o seed nunca rodou lá; ver F70-S33);
  - nenhum flow está publicado;
  - as 19 conversas estão com a IA desligada: 15 sem origem gravada (anteriores ao deploy da F70) e 4 `sem-origem`.
  - Com a trava ligada, só conversa nova de anúncio, site ou Instagram poderá receber a IA quando o agente for ativado.
- **R1–R6 do runbook:** a validação formal segue pendente. O inbound e o eco já funcionam com o número real.
