# Handoff — próxima sessão (escrito em 2026-10-14)

> Leia este arquivo inteiro antes de qualquer ação. Ele descreve o estado real do repositório e da
> produção no fim da sessão de 05 a 14/10/2026, o que está pela metade e a ordem para continuar.
> Depois de concluir cada item, atualize ou apague a linha correspondente.

## 1. Estado do repositório

- Branch `main`, árvore **limpa**.
- **`main` local está 30+ commits à frente do `origin/main` e 5 atrás.** Os 5 do remoto são de outra sessão; ver o §4.1 antes de qualquer push.
- **Stashes** (`git stash list`). Nenhum foi aplicado:

| Stash | Conteúdo | O que fazer |
|---|---|---|
| `F72-S04 parcial (Home…)` | Home nova: `features/dashboard/home/*` (HomeClient, KpiStrip, RevenueChart, home-format), `DashboardPanels`, API `services/dashboard/home.ts(+test)`, `routes/dashboard`, `(app)/page.tsx`, `hoje/page.tsx`, `manifest.ts` | Retomar a F72-S04 a partir dele (§3) |
| `F72-S05 parcial (inbox DS3)` | `features/conversations/**`, `(app)/conversations/**`, spec `conversations-inbox-ds3.spec.ts` | Retomar a F72-S05 |
| `F72-S06 parcial (pipeline + calendario + cockpit-agenda)` | `features/pipeline/**`, `features/calendar/**`, `features/cockpit-agenda/**` | Retomar a F72-S06 |
| `incidente-flow-midia-2026-10-09 (nao F72)` | Correção do incidente de mídia de flow com tipo errado: `packages/flow-engine` (validação + `message.handler`), nó de mensagem do flow builder, `apps/workers/src/outbound/presence.ts(+test)`, runbook `docs/runbooks/incident-flow-media-mismatch-2026-10-09.md` | **Não é da F72.** Veio de outra sessão. Ler o runbook, validar e integrar como slot/fix próprio. **Não foi para produção** |
| `f70-s02: script + registro COMMS` | Antigo, anterior a esta sessão | Não mexer sem o Rogério |

Os stashes foram feitos **sem saber se os agentes tinham terminado**: os agentes pararam por limite de uso no meio da onda 3. Trate como trabalho parcial e confira o DoD do slot contra o conteúdo antes de integrar.

Para aplicar um stash no fluxo do `slot.py` (o `claim` exige árvore limpa):
```bash
python scripts/slot.py claim F72-S04
git stash list                     # achar o índice do "F72-S04 parcial"
git stash pop stash@{N}
```

## 2. Produção (VPS 187.77.237.233, deploy manual)

- No ar: **`75de4fd4`** (F71 completa: convites, várias empresas, cadastro, trial de 15 dias e só leitura). Migração `0094` aplicada.
- **Não foi para produção** (está na `main` local):
  - F70-S36/S37: nome do contato na inbox, migração `0095`;
  - o log da recusa do Supabase no email de confirmação (`78a731e9`);
  - `deploy.ps1` com BOM para o PowerShell 5.1;
  - F72-S01..S03: tokens, fontes, `@hm/ui` e shell do DS 3.0.
- **Deploy pelo CI não funciona:** faltam os secrets `VPS_HOST`, `VPS_USER` e `VPS_SSH_KEY` no GitHub, e o job sai como "sucesso" sem fazer nada. O deploy é manual: `./scripts/deploy.ps1 -Branch main` (PowerShell) ou `ssh -t -i ~/.ssh/leadium_vps root@187.77.237.233 "bash /opt/leadium/scripts/deploy.sh main"`.
- **Storage R2:** token trocado em 07/10 e sonda `ok`. Ainda falta rodar o reprocessamento da mídia parada (runbook `storage-recusou-midia` §4, começar com `--dry-run`).

## 3. Trabalho em andamento — F72 (adoção do DS 3.0)

Spec: `docs/features/DS3_ADOCAO.md` · ADR: `docs/decisions/ADR-002-tipografia-ds3.md` · maquete: `docs/design/ds-3.0-agency-os.html`.

| Slot | Estado |
|---|---|
| S01 tokens/fontes/tipografia | ✅ done |
| S02 `@hm/ui` | ✅ done |
| S03 shell + mobile 4 abas + Mais | ✅ done |
| S04 Home | 🟡 parcial no stash; status no board = blocked/available |
| S05 Inbox | 🟡 parcial no stash |
| S06 Pipeline + calendário | 🟡 parcial no stash |
| S07 varredura do app | não iniciado |
| S08 auth/plataforma/ajuda/público | não iniciado |
| S09 auditoria final | não iniciado |

Pendências registradas nas notas da S03 (resolver na S04):
- `/hoje` quebra sob o mock padrão do e2e;
- "Home" no celular aponta para `/hoje`, e a S04 decide a unificação;
- `apps/web/e2e/mobile-navigation.spec.ts` está obsoleto e precisa ser removido ou ajustado.

Bug achado na S01 e corrigido na S02: **as fontes do DS v2 nunca renderizavam em produção** (auto-referência cíclica de `--font-*` no `@hm/ui/theme.css`). As fontes do DS 3.0 já renderizam.

## 4. Ordem recomendada para a próxima sessão

1. **Sincronizar com o remoto:** `git fetch origin`, ler os 5 commits de `main..origin/main`, depois `git merge --no-ff origin/main`, `python scripts/slot.py sync` e commit do STATUS. Rodar o typecheck **por pacote**: em paralelo, o typecheck estoura a memória desta máquina.
2. **Incidente de flow (stash `incidente-flow-midia…`):** ler o runbook, aplicar, validar os testes do `flow-engine`, `workers` e `web` (flow-builder) e commitar como fix. É correção de produção e tem prioridade sobre o visual.
3. **Retomar a F72** pelo orchestrator (`.claude/agents/orchestrator.md`):
   - S04, S05 e S06 a partir dos stashes, uma por vez ou duas em paralelo no máximo (memória);
   - depois S07 e S08, e por fim a S09.
   - Workers **sempre em primeiro plano** (`run_in_background: false`). Com eles em segundo plano, o orchestrator encerrou sem esperar os workers duas vezes.
4. **Publicar** depois do aval do Rogério:
   - push (`git pull --no-rebase --no-edit origin main; if ($LASTEXITCODE -eq 0) { git push origin main }`);
   - CI verde;
   - `./scripts/deploy.ps1 -Branch main`;
   - conferir a tag dos serviços na VPS, as migrações `0095` e seguintes, e o `/health` com `storage: ok`.

## 5. Pendências que dependem do Rogério

- **Leadium (única empresa em produção) está em trial:** expira em 15 dias a partir do deploy da F71 (~22/10/2026). Marcar a assinatura como **Ativa** no painel de plataforma antes disso. Se expirar, vira só leitura e o agente da Arcada para de responder.
- **Email de confirmação de cadastro não chegou** (teste de 07/10, email `be***@gmail.com`): o Supabase aceitou (HTTP 200), então o problema está no SMTP ou na entrega. Conferir spam e o log do provedor de SMTP. Fazer os testes 5.1 a 5.4 de `docs/runbooks/supabase-auth-emails.md`.
- Desligar "Allow new users to sign up" no Supabase (recomendação da auditoria F71).
- Go-live público do cadastro depende da **F71-S11** (headers de segurança do web) e da **F71-S15** (verify define senha), segundo o parecer do auditor.
- Opcional: secrets de deploy no GitHub para o CI voltar a publicar sozinho.
- Avisos do GitHub Actions: Node 20 descontinuado e `ubuntu-latest` vira Ubuntu 26 em 19/10. Atualizar as actions.

## 6. Prompt pronto para abrir a próxima sessão

> Leia `tasks/HANDOFF.md` inteiro e o `CLAUDE.md`. Siga a ordem do §4: sincronize com o remoto, integre o fix do incidente de flow do stash e retome a F72 pelo orchestrator a partir dos stashes da S04/S05/S06, com workers em primeiro plano. Sem push nem deploy sem o meu ok. Me reporte ao fim de cada etapa.
