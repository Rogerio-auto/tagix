# Auditoria — Calendar 2.0: visibilidade & privacidade (F37-S05)

> **Data:** 2026-06-18
> **Escopo:** regressão do vazamento **L1** (`docs/features/CALENDAR_V2_PLAN.md §3`) — provar que
> a lista de calendários e a lista de eventos só entregam o que cada membro pode ver, por role.
> **Método:** API real (`@hm/api` em `http://localhost:3001`, `AUTH_PROVIDER=mock`), cookies de
> sessão por membro, Postgres do `docker-compose.dev.yml`. Workspace `dev` (`6aeb5134-…`).
> **Veredito:** **NÃO pronto para merge sem follow-up.** As listas (`GET /api/calendars`,
> `GET /api/events`, `GET /api/calendars/:id/events`) e o detalhe de calendário estão corretos —
> o vazamento L1 das LISTAS está **fechado**. Porém o **detalhe de evento por id**
> (`GET /api/events/:id`) **vaza** eventos de calendários inacessíveis (leak read-only confirmado,
> ver §4). É da mesma classe L1 e precisa de fix no slot dono (S02 / `apps/api/src/routes/calendar/events.ts`).

---

## 1. Ambiente & atores

Mock auth loga qualquer member existente; cada role tem cookie próprio.

| Papel | Membro | memberId | Personal calendar (provisionado) |
|---|---|---|---|
| OWNER | Dev Owner (`owner@dev.local`) | `22ac97eb…309ce` | `48d7e88f…` |
| ADMIN | Diego Souza (`admin1@dev.com`) | `0737503c…b9fc` | (provisionado no 1º GET) |
| SUPERVISOR | Gabriela Oliveira (`supervisor2@dev.com`) | `6d4b91c2…a1da` | `70208a76…` |
| AGENT | João Santos (`agent3@dev.com`) | `6e525191…ae00` | `1899fca5…` |
| AGENT | Marina Pereira (`agent4@dev.com`) | `814c7c26…ac04` | `656e0937…` |

Calendários do tipo `workspace` no workspace `dev`: `Agenda · Dev Workspace` (`46a074aa…`, isDefault)
e `QA Cal` (`6dac18c6…`). Time `Vendas` (`1dc22110…`) com todos os 5 membros como `role='member'`
(nenhum `lead`). Calendário de time `Agenda Vendas` (`b925a5bc…`) criado durante a auditoria.

Login (padrão para cada ator):

```bash
curl -s -c /tmp/<role>.txt -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" -d '{"email":"<email>","password":"x"}'
```

---

## 2. `GET /api/calendars` — quem vê o quê (PASS)

Cada membro hita `GET /api/calendars` (que provisiona lazy o pessoal + Empresa e filtra por
`calendarRepo.accessibleCalendarIds`).

```bash
curl -s -b /tmp/agent3.txt http://localhost:3001/api/calendars
curl -s -b /tmp/agent4.txt http://localhost:3001/api/calendars
curl -s -b /tmp/owner.txt  http://localhost:3001/api/calendars
```

| Ator | type=personal vistos | Vê pessoal de colega? | Vê "Empresa" (workspace)? |
|---|---|---|---|
| AGENT (João) | só o **próprio** (`1899fca5…`) | **NÃO** | Sim (2 workspace cals) |
| AGENT (Marina) | só o **próprio** (`656e0937…`) | **NÃO** | Sim |
| SUPERVISOR (Gabriela) | só o **próprio** (`70208a76…`) | **NÃO** (não lidera time) | Sim |
| ADMIN (Diego) | **todos** (5 pessoais) | Sim (por role) | Sim |
| OWNER (Dev Owner) | **todos** (4 pessoais) | Sim (por role) | Sim |

**Resultado:** PASS. Membro comum recebe apenas o próprio pessoal + os `workspace`. OWNER/ADMIN
recebem todos os pessoais. Bate com o DoD: "cada um vê o seu + Empresa; owner vê todos".

---

## 3. `GET /api/events` — escopo da lista por calendário acessível (PASS)

Seed do teste: Marina cria um evento **privado** no seu calendário pessoal.

```bash
curl -s -b /tmp/agent4.txt -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -d '{"calendarId":"656e0937-355f-4b02-adbe-20e9619294f4",
       "title":"SEGREDO Marina - terapia",
       "startAt":"2026-06-20T14:00:00.000Z","endAt":"2026-06-20T15:00:00.000Z","type":"task"}'
# → 201, event id 5e63ee7a-8714-45b6-97c4-277d178a3553
```

João (AGENT, NÃO acessa o pessoal de Marina) consulta eventos pela janela:

| # | Caminho | Comando (resumo) | Esperado | Obtido |
|---|---|---|---|---|
| 1 | lista geral | `GET /api/events?from=…&to=…` | sem o segredo | **OK** — só vê 2 eventos do workspace cal (`Visita ao imóvel · Carla/Diego`) |
| 2 | overlay forçado | `…&calendarIds=656e0937…` (cal de Marina) | id inacessível descartado → `[]` | **OK** — `events: []` |
| 3 | eventos do calendário | `GET /api/calendars/656e0937…/events` | 403/404 | **OK** — `403 "Sem acesso a este calendário."` |
| 4 | detalhe do calendário | `GET /api/calendars/656e0937…` | 403/404 | **OK** — `403` |

```bash
# Teste 2 (tentativa de overlay do calendário do colega):
curl -s -b /tmp/agent3.txt \
  "http://localhost:3001/api/events?from=2026-06-19T00:00:00.000Z&to=2026-06-21T00:00:00.000Z&calendarIds=656e0937-355f-4b02-adbe-20e9619294f4"
# → {"events":[]}
```

**Resultado:** PASS para a LISTA. O vazamento L1 das listas está fechado: `GET /api/events`,
o overlay `calendarIds` (interseção pedido ∩ acessível) e `GET /api/calendars/:id/events` nunca
entregam eventos de calendário inacessível.

---

## 4. 🔴 LEAK — `GET /api/events/:id` não verifica acesso ao calendário (FAIL)

Mesma seed (evento privado de Marina, `5e63ee7a…`). João pede o detalhe direto pelo id:

```bash
curl -s -b /tmp/agent3.txt http://localhost:3001/api/events/5e63ee7a-8714-45b6-97c4-277d178a3553
```

**HTTP 200** — corpo COMPLETO vazado para um agente sem acesso:

```json
{"event":{"id":"5e63ee7a-…","calendarId":"656e0937-…","title":"SEGREDO Marina - terapia",
  "type":"task","startAt":"2026-06-20T14:00:00.000Z","endAt":"2026-06-20T15:00:00.000Z",
  "status":"scheduled","createdBy":"814c7c26-…(Marina)", …},
 "participants":[{"memberId":"814c7c26-…","role":"organizer","rsvp":"pending", …}]}
```

**Causa raiz:** o handler `GET /api/events/:id` (`apps/api/src/routes/calendar/events.ts`, ~L238)
carrega o evento só sob RLS (que escopa por **workspace**, não por calendário) e **não** intersecta
com `accessibleCalendarIds` nem chama `requireCalendarAccess`. As listas foram corrigidas no S02,
mas o detalhe por id ficou de fora — é exatamente a classe de vazamento L1 do plano.

**Impacto:** vazamento de privacidade read-only. Expõe título, descrição, local, URL de reunião,
vínculos `contactId`/`dealId`/`conversationId` e a lista de participantes (com RSVP) de qualquer
evento do workspace a qualquer membro que conheça/adivinhe o id (UUID v4 — não trivial de adivinhar,
mas ids vazam por logs, integrações, exports e referências cruzadas). Não há escrita: PUT/cancel/RSVP
estão protegidos (ver §5).

**Repro determinística:** §3 (criar o evento como Marina) + o `curl` acima como João → 200 com o título.

**Fix recomendado (slot dono S02, fora da fronteira deste slot QA):** no `GET /api/events/:id`,
após carregar o evento, computar `accessibleCalendarIds` e responder **404** se
`!ids.includes(event.calendarId)` (404, não 403, para não confirmar existência). Espelha o que
`requireCalendarAccess` já faz nas rotas `/api/calendars/:id*`. Cobrir com teste de regressão
em `apps/api/src/routes/calendar/routes.test.ts` (membro comum → 404 no detalhe de evento alheio).

---

## 5. Mutações por id — bloqueadas (PASS)

João tenta MUTAR o evento privado de Marina:

| Ação | Comando | Obtido |
|---|---|---|
| editar | `PUT /api/events/5e63ee7a…` `{"title":"HACKED"}` | **403** "Apenas o criador ou um admin pode editar este evento." |
| cancelar | `POST /api/events/5e63ee7a…/cancel` | **403** idem |
| RSVP | `POST /api/events/5e63ee7a…/rsvp` `{"rsvp":"accepted"}` | **404** "Você não é participante deste evento." |

Confirmado que o título permanece inalterado (`owner GET` → ainda `SEGREDO Marina - terapia`).
`canMutateEvent` (criador OU ADMIN/OWNER) segura PUT/cancel; o RSVP só atinge participantes.
**Resultado:** PASS — a escrita está protegida. (O leak é apenas de leitura.)

---

## 6. Visibilidade de calendário de TIME (PASS parcial)

Criado um calendário de time para `Vendas`:

```bash
curl -s -b /tmp/owner.txt -X POST http://localhost:3001/api/calendars \
  -H "Content-Type: application/json" \
  -d '{"name":"Agenda Vendas","type":"team","teamId":"1dc22110-a216-4dcb-9cb0-7f3b4821e2b8"}'
# → 201, cal b925a5bc-3495-45d6-9270-30dd24068439
```

João (membro de `Vendas`):

```bash
curl -s -b /tmp/agent3.txt http://localhost:3001/api/calendars     # lista contém "Agenda Vendas"
curl -s -b /tmp/agent3.txt http://localhost:3001/api/calendars/b925a5bc-…   # → HTTP 200
```

**Resultado:** PASS — membro do time vê e acessa o calendário do time (regra `team` via
`team_members`, L6 do plano).

**Pendente de ambiente (honestidade):**
- **Exclusão de não-membro do time:** todos os 5 membros do workspace `dev` pertencem a `Vendas`,
  então não há um não-membro para provar a NEGAÇÃO ao vivo. Coberto indiretamente pela unidade
  `canAccessCalendar('team', …) → false no puro` + `accessibleCalendarIds` filtrando por
  `inArray(calendars.teamId, visibleTeamIds)` (`routes.test.ts`, `packages/db/src/repos/calendar.ts`).
- **SUPERVISOR vê os times que LIDERA + pessoais dos liderados:** nenhum membro tem
  `team_members.role='lead'` no seed, então o ramo `SUPERVISOR` de `accessibleCalendarIds`
  (times liderados + pessoais dos integrantes) não foi exercitado ao vivo. A SUPERVISOR Gabriela,
  por não liderar nada, corretamente só vê o próprio pessoal + workspace (§2) — consistente com a
  lógica. O ramo de liderança está coberto só por leitura de código (`repo.accessibleCalendarIds`,
  branch `role === 'SUPERVISOR' && ledTeamIds.length > 0`); **recomenda-se** um teste de integração
  com um `lead` semeado para fechar essa lacuna.

---

## 7. UX / a11y na tela (UX_PRINCIPLES §4) — checklist

Verificado por leitura do `CalendarPage.tsx` + trilha/form/detalhe (não E2E ao vivo — §8):

- [x] Trilha agrupa **Meu calendário · Empresa · Times · (owner) Pessoas**; cada item é
      `role="checkbox"` com `aria-checked`, ponto de cor e label acessível (`aria-label="Calendários"`).
- [x] Cor por **calendário** (de `calendars.color`, DATA) + legenda; zero hex literal em JSX (tokens DS v2).
- [x] Empty states que convidam ("Sua agenda está pronta", "Nenhum calendário visível") e ErrorState
      com causa + próximo passo (UX §2.5/§2.6).
- [x] Edição/arraste só habilitados para quem pode editar (`editable: canEdit && (criador || admin)`).
- [x] HelpPanel `?` explica a feature (não tooltip); atalhos N/T/1/2/3 documentados.
- [x] Seleção de calendários persiste **por membro** (`hm:calendar:selection:<memberId>`) — não vaza
      entre contas no mesmo browser.

---

## 8. E2E (`apps/web/e2e/calendar-v2.spec.ts`)

Specs determinísticos dos fluxos-chave (trilha liga/desliga + overlay, criar evento simples e
**recorrente**, abrir detalhe). Mocks herméticos por rota (sem API/DB real).

**Execução:** PENDENTE DE AMBIENTE. Neste host Windows o bundle cliente do Next **não hidrata** no
headless-shell (memória `e2e-no-hydration-this-host`) — TODA a suíte e2e do projeto fica em branco,
inclusive specs já verdes. O spec foi validado por `pnpm --filter @hm/web typecheck` (tsc verde) e
`eslint` (verde). **NÃO** marcamos verde de execução aqui; rodar (`pnpm --filter @hm/web e2e`) num
host onde o app hidrata.

---

## 9. Validações

| Check | Comando | Resultado |
|---|---|---|
| typecheck (web) | `pnpm --filter @hm/web typecheck` | verde |
| typecheck (repo) | `pnpm typecheck` | verde |
| lint | `pnpm lint` | verde |
| unit/integration API | `pnpm --filter @hm/api test calendar` | (suíte S02 verde — `routes.test.ts`) |

---

## 10. Veredito

- **Vazamento L1 das LISTAS:** FECHADO. `GET /api/calendars`, `GET /api/events` (+ overlay) e
  `GET /api/calendars/:id*` escopam corretamente por role/ownership/team. OWNER/ADMIN veem todos;
  membro comum só o seu + Empresa; membro de time vê o calendário do time.
- **Vazamento residual (§4):** `GET /api/events/:id` entrega o detalhe + participantes de eventos
  de calendários inacessíveis (read-only). **Bloqueia o "pronto para merge"** da feature de
  privacidade até o fix no slot dono (S02). Escrita está protegida (§5).
- **Lacunas de ambiente (honestas):** negação de não-membro de time e o ramo SUPERVISOR-lead não
  foram provados ao vivo (seed sem `lead`/sem não-membro); cobertos por unidade + leitura de código.
  E2E validado por typecheck/lint, execução pendente de host que hidrata.

**Recomendação:** abrir follow-up no slot dono para o §4 antes de promover a F37 a produção.
