---
id: F61-S04
title: Roteador de notificação — dedupe, preferência por evento e fuso do membro
phase: F61
status: in-progress
priority: high
estimated_size: L
depends_on: [F61-S03]
blocks: []
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T23:11:33Z

---
# F61-S04 — Roteador de notificação

## Objetivo

Um evento decide **por onde avisa**, uma vez só — para o dono não receber a mesma coisa
três vezes e desligar tudo.

## Contexto

`APP_MOBILE_PLAN` §4.2. A F61-S03 entregou o canal (push por dispositivo). Falta a decisão:
o mesmo "lead novo" pode virar push, WhatsApp e e-mail simultâneos.

> Sem esse roteador, o dono recebe a mesma coisa três vezes e desliga tudo — e aí você perdeu
> o canal que sustentava o speed-to-lead.

Notificação demais não é um incômodo: é a destruição do canal. Uma vez que o dono desliga, ele
não religa, e o tempo de resposta — o número que fecha venda — volta ao que era antes do produto.

## Escopo

### files_allowed

- `packages/shared/src/notifications.ts`
- `packages/shared/src/notifications.test.ts`
- `packages/shared/src/index.ts`
- `packages/db/src/schema/notifications.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`
- `apps/api/src/services/notifications/**`
- `apps/api/src/socket/relay.ts`
- `apps/api/src/socket/relay.test.ts`

### files_forbidden

- `apps/workers/**`

## Escopo (faz)

1. **Preferência por TIPO de evento**, não um interruptor geral. "Me avise de lead novo, não de
   mensagem em conversa que já estou acompanhando."
2. **Dedupe por janela**: se a pessoa abriu o app nos últimos N minutos, não mandar WhatsApp —
   ela já viu.
3. **Silêncio por horário, no fuso do MEMBRO** (não no do servidor nem no do workspace).
4. **Fallback em cascata**, não em paralelo: push falhou ou não existe → WhatsApp → e-mail.
5. **Registro do que foi enviado**, para o dedupe ter memória e para responder "por que não fui
   avisado?".

## Fora de escopo

- Badge de não-lidos e link profundo (F61-S08).
- Preferências de notificação de CONTATO (é outro domínio: consentimento, F59).

## Definition of Done

- [x] Um evento nunca gera dois avisos do mesmo tipo no mesmo canal.
- [x] Preferência é por tipo de evento e tem default seguro.
- [x] Janela de silêncio usa o fuso do membro.
- [x] Cascata: e-mail só sai se push e WhatsApp não resolveram.
- [x] Push desligado (sem VAPID) degrada para o próximo canal sem erro.
- [x] RLS em tudo que for tabela nova.

## Validação

```bash
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
pnpm lint
```

## Notas

- A régua: o dono confia no aviso o suficiente para não conferir o app "por garantia".

## Decisões tomadas na execução (2026-09-09)

1. **A decisão é pura; a execução é separada.** `@hm/shared/notifications` não faz IO — 22 testes
   cobrem a regra inteira sem banco, sem rede e sem relógio. A API só executa.

2. **Preferência por evento SEM migration.** `members.notification_prefs` já existia com
   `{in_app, email, push}` em toda linha desde o F0. O refinamento novo entra como `byEvent`
   opcional no mesmo jsonb: quem nunca abriu as configurações mantém o comportamento de antes, e
   não houve backfill de nenhuma linha.

3. **O interruptor geral RESTRINGE, nunca amplia.** Quem desligou push no perfil não volta a
   receber push porque o default do evento inclui.

4. **`lead_novo` é o único que sai por WhatsApp por padrão.** É o único evento que justifica
   interromper alguém. E nenhum evento manda e-mail por padrão — e-mail de notificação vira
   filtro, e filtro é como um canal morre em silêncio.

5. **"Já viu" roda ANTES de "silêncio".** Quem está com o app aberto às 23h está trabalhando;
   silenciar o push dele seria esconder o lead de quem está olhando a fila.

6. **"Já viu" corta só o INTRUSIVO.** O push continua, porque é ele que acende o badge sem
   interromper; o WhatsApp é que interrompe.

7. **Disponibilidade é fato SEPARADO da preferência.** "O membro quer WhatsApp" e "o produto sabe
   mandar WhatsApp" são coisas diferentes, e confundi-las faria a cascata parar num degrau que
   nunca entrega. `suppressedBy: 'indisponivel'` distingue os dois casos — sem isso, um canal
   quebrado ficaria escondido atrás de "o usuário não quis".

8. **Dedupe ESTRUTURAL, no índice único.** `(workspace, member, event_key, channel)`. Uma consulta
   prévia perderia a corrida entre dois consumidores da mesma fila; o índice não perde.

9. **O lugar é reservado ANTES do envio.** Se dois consumidores chegarem juntos, só um passa pelo
   índice e só ele manda. A ordem inversa mandaria dois avisos e gravaria um.

10. **Envio sem nenhum aparelho vira `falhou`, não `enviado`.** Um "enviado" mentiroso silenciaria
    o evento para sempre — o pior resultado possível num canal de aviso.

11. **A supressão também é gravada, com motivo.** É o que responde à pergunta "por que não fui
    avisado?". Sem essa resposta o dono deixa de confiar e volta a conferir o app por garantia —
    justamente o trabalho que o produto deveria ter tirado dele. Um Redis com TTL resolveria o
    dedupe e perderia isto.

12. **`Intl` para a hora local, não aritmética de offset.** Horário de verão existe e muda em
    datas diferentes nos EUA e no Brasil — o cliente brasileiro nos EUA tem equipe nos dois
    fusos. Fuso inválido cai no relógio do servidor em vez de lançar: errar a janela é ruim, não
    avisar por causa de uma string é pior.

13. **O gancho vive no relay da API, não no worker.** O worker já publica `message:new` em
    `hm.q.socket.relay`, que a API consome — ou seja, a API **já recebe todo evento de mensagem
    nova**. Pendurar ali custa zero infraestrutura nova. A alternativa (worker chamando o
    roteador) exigiria mover o serviço para um pacote e dar ao worker as chaves VAPID: mais
    peças, mesma entrega. Por isso `relay.ts` entrou em `files_allowed` durante a execução.

14. **O aviso sai DEPOIS do emit e sem `await`.** O relay é o último trecho entre o banco e o
    navegador; se ele engolir ou atrasar um evento, o sintoma é "o tempo real some às vezes".
    Há teste provando a ordem e provando que o handler não espera.

15. **`.catch()` explícito, não só `void`.** `void` descarta o VALOR, não a rejeição — a promise
    rejeitada virava unhandled rejection. **O teste pegou isto**, e é o tipo de coisa que em
    produção derruba o processo da API inteira por causa de um aviso que não saiu.

16. **Só mensagem do CONTATO vira aviso.** Notificar o dono da resposta que ele mesmo acabou de
    mandar é a forma mais rápida de ele desligar as notificações.

17. **"Lead novo" não é "mensagem nova".** Lead novo é o contato que só tem esta conversa; um
    cliente antigo mandando "bom dia" não é lead novo. A chave do dedupe reflete isso:
    `lead_novo` é por conversa (uma vez na vida), `mensagem_nova` é por mensagem.

18. **Sem dono atribuído, avisa os OWNER — não os ADMIN.** Numa agência o ADMIN costuma ser da
    agência, e ele não precisa do celular tocando a cada mensagem do cliente do cliente.

## O que NÃO está ligado, e por quê

**WhatsApp e e-mail para o MEMBRO não entram em `canaisDisponiveis` ainda.** WhatsApp exige
template aprovado para mensagem iniciada pelo negócio fora da janela de 24h; e-mail transacional
para membro ainda não tem remetente próprio. Declarar isso — em vez de fingir que funciona — é o
que evita um canal fantasma: aquele que aparece nas preferências, o usuário liga, e nada chega.
O roteador já sabe o que fazer no dia em que existirem, sem mudar uma linha.

## Resultado

- 22 testes em `@hm/shared` (decisão pura), 8 em `services/notifications` (fuso e relógio),
  5 novos em `socket/relay` (17 no arquivo).
- Migration `0077`: `notification_deliveries` com RLS + `members.timezone`.
- Typecheck limpo no monorepo. Lint: 0 erros.
