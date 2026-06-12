# Runbook — Banimento / restrição de WABA na Meta (produção)

> **Para quem:** SRE / on-call + responsável de conta do `tagix` (Highermind v2) respondendo a banimento, restrição ou queda de qualidade de um WhatsApp Business Account (WABA) na Meta.
> **Ambiente:** VPS Ubuntu, Docker Compose. Canal `meta_whatsapp` em `channels` (`waba_id`, `phone_number_id`); tokens em `channel_secrets.access_token_enc`. Canal alternativo possível: `waha` (WhatsApp Web não-oficial) e `meta_instagram`.
> **Impacto:** o canal WhatsApp oficial daquele workspace para de enviar/receber. Inbound de clientes some; outbound (atendimento, campanhas, flows) falha com erro da Graph API.
> **Comandos são bash (Linux/prod). Nunca PowerShell.**

> ⚠️ **Não tome ação destrutiva no canal** (deletar `channel`/`channel_secrets`) durante o incidente — o banimento pode ser revertido pela Meta e você perde o histórico de associação. Apenas **desative** (`is_active=false`) e faça fallback.

---

## 1. Sintomas / Detecção

Você chega aqui por:

- Email/alerta da Meta (Business Manager / WhatsApp Manager) com "account restricted", "banned", "violated policies", ou queda de qualidade para **RED**.
- Spike de erros de outbound nos logs:

  ```bash
  cd /root/highermind
  export COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"
  $COMPOSE logs --tail=300 worker-outbound \
    | grep -i -E 'graph|whatsapp|131049|131056|368|80007|throttl|blocked|restricted|account_violation'
  ```

  Códigos típicos da Cloud API: `368` (conta temporariamente bloqueada por política), `131056`/`131049` (limites/restrição de qualidade), `80007` (rate limit), `190` (token inválido/expirado — pode ser desativação do app).

- Painel `/admin/infrastructure` ou dashboard de campanhas mostrando block rate alto e delivery rate despencando.

---

## 2. Confirmar escopo e severidade

Não confunda **rate limit temporário** (auto-recupera) com **ban/restrição** (exige apelação). Cheque a fonte da verdade na Meta.

1. Descubra qual canal/workspace está afetado:

   ```bash
   set -a; source /root/highermind/.env; set +a
   psqlc() { $COMPOSE exec -T postgres psql -U "$PG_USER" -d highermind "$@"; }
   psqlc -c "
     select id, workspace_id, name, phone_number, waba_id, phone_number_id, is_active
     from channels where provider='meta_whatsapp' order by workspace_id;"
   ```

2. Consulte o status real direto na Graph API (token decifrado do canal). Faça isto dentro do `api` para usar `decryptSecret`:

   ```bash
   CHANNEL_ID="<id-do-canal-afetado>"
   ENC="$(psqlc -tA -c "select access_token_enc from channel_secrets where channel_id='${CHANNEL_ID}';")"
   PNID="$(psqlc -tA -c "select phone_number_id from channels where id='${CHANNEL_ID}';")"
   WABA="$(psqlc -tA -c "select waba_id from channels where id='${CHANNEL_ID}';")"
   $COMPOSE exec -T -e ENC="$ENC" -e PNID="$PNID" -e WABA="$WABA" api node -e '
     const { decryptSecret } = require("@hm/db");
     const tok = decryptSecret(process.env.ENC);
     (async () => {
       const num = await fetch(`https://graph.facebook.com/v21.0/${process.env.PNID}?fields=verified_name,quality_rating,messaging_limit_tier,name_status,status&access_token=${tok}`).then(r=>r.json());
       console.log("PHONE:", JSON.stringify(num));
       const acc = await fetch(`https://graph.facebook.com/v21.0/${process.env.WABA}?fields=account_review_status,business_verification_status,name,on_behalf_of_business_info&access_token=${tok}`).then(r=>r.json());
       console.log("WABA:", JSON.stringify(acc));
     })();'
   ```

   Interprete:

   | Campo | Valor preocupante | Significado |
   |---|---|---|
   | `quality_rating` | `RED` | qualidade crítica — restrição iminente ou ativa |
   | `status` (número) | `RESTRICTED` / `FLAGGED` | número limitado |
   | `account_review_status` | `REJECTED` / `DISABLED` | WABA reprovado/desabilitado |
   | erro `190` | token inválido | app/token revogado pela Meta |

---

## 3. Conter o sangramento (parar envio para não piorar)

Continuar disparando contra um WABA restrito **agrava** a violação. Pause o outbound do canal afetado imediatamente.

1. Desative o canal (não destrutivo — `is_active=false`):

   ```bash
   psqlc -c "update channels set is_active=false, updated_at=now() where id='${CHANNEL_ID}';"
   ```

2. Pause campanhas e flows que usam esse canal (evita re-tentativas em massa):

   ```bash
   # Pausar campanhas ativas do workspace afetado (ajuste status conforme schema de campanhas):
   WS="$(psqlc -tA -c "select workspace_id from channels where id='${CHANNEL_ID}';")"
   psqlc -c "update campaigns set status='paused', updated_at=now()
             where workspace_id='${WS}' and status in ('running','scheduled');"
   ```

3. Drene/segure o outbound em voo para esse canal — confirme que worker-outbound não está martelando a Graph API:

   ```bash
   $COMPOSE logs --tail=50 worker-outbound | grep -i "${CHANNEL_ID}" || echo "sem envios recentes para o canal"
   ```

   Mensagens que falharem irão para a `hm.q.outbound.dlq` (manual) — isso é o comportamento desejado agora; **não** as re-enfileire enquanto o canal estiver banido.

---

## 4. Comunicação

1. **Interna:** abra incidente, marque SEV de acordo com nº de workspaces afetados. Notifique o dono da conta Meta (quem tem acesso ao Business Manager para apelar).

2. **Cliente afetado:** comunique de forma proativa via canal alternativo (email/IG) — antes que ele perceba pelo silêncio. Mensagem honesta: canal WhatsApp temporariamente indisponível, equipe atuando, fallback ativo.

3. **Meta:** abra a apelação no **WhatsApp Manager → Account/Phone → "Request review"** (ou via Business Help Center). Tenha em mãos: `waba_id`, `phone_number_id`, business verification status, e evidência de uso legítimo (opt-in dos contatos, conteúdo das campanhas). Anexe prova de consentimento se a causa for spam/opt-out.

---

## 5. Fallback de canal

Mantenha o atendimento vivo enquanto o WABA está fora.

1. **Se o workspace tem um canal WAHA** (WhatsApp Web não-oficial) configurado, ative-o como rota temporária:

   ```bash
   psqlc -c "
     select id, name, waha_session_id, is_active, is_default
     from channels where workspace_id='${WS}' and provider='waha';"
   # Ative e/ou torne default o canal WAHA do workspace:
   psqlc -c "update channels set is_active=true where id='<waha-channel-id>';"
   psqlc -c "update channels set is_default=false where workspace_id='${WS}';
             update channels set is_default=true where id='<waha-channel-id>';"
   ```

   Confirme a sessão WAHA viva (`waha.<domínio>` admin UI ou):

   ```bash
   $COMPOSE exec -T api curl -fsS -H "X-Api-Key: ${WAHA_API_KEY}" \
     http://waha:3000/api/sessions | head
   ```

   > **Cautela:** WAHA é não-oficial; usar para volume alto de outbound pode levar a ban do **número** no WhatsApp. Use para **atendimento reativo** (responder quem escreveu), não para campanhas. Não migre campanhas para WAHA.

2. **Se não há WAHA**, oriente o cliente a direcionar contatos para Instagram (`meta_instagram`) ou outro WhatsApp não-restrito, e segure campanhas até reativação.

3. Garanta que o inbound não se perca: webhooks da Meta param para o canal banido, mas mensagens recebidas via fallback (WAHA/IG) continuam entrando pelos workers normalmente.

---

## 6. Reativação (após Meta aprovar a apelação)

1. Confirme na Graph API que o status voltou (repita §2 passo 2). Só prossiga quando `account_review_status` voltar a `APPROVED` e `quality_rating` sair de `RED`.

2. Reative o canal oficial:

   ```bash
   psqlc -c "update channels set is_active=true, updated_at=now() where id='${CHANNEL_ID}';"
   # Restaurar default se você o trocou para WAHA no §5:
   psqlc -c "update channels set is_default=false where workspace_id='${WS}';
             update channels set is_default=true where id='${CHANNEL_ID}';"
   ```

3. Re-verifique a entrega do webhook da Meta (pode ter sido pausada). Confirme assinatura/HMAC e o callback `api.<domínio>/webhooks/meta`:

   ```bash
   curl -fsS "https://api.<domínio>/health" >/dev/null && echo "API up para receber webhook"
   ```

   Se necessário, re-subscreva os campos do webhook no App Dashboard da Meta (messages, message_status).

4. **Reabilite outbound gradualmente** — não despeje o backlog de uma vez (re-trigger de qualidade RED). Comece com tráfego reativo de atendimento; só depois retome campanhas, em rate baixo:

   ```bash
   # Retome campanhas com cuidado, uma de cada vez, monitorando quality_rating:
   psqlc -c "select id, name, status from campaigns where workspace_id='${WS}' and status='paused';"
   # Reative manualmente a mais crítica primeiro (ajuste para o schema real de campanhas).
   ```

5. Trate a DLQ acumulada (§3): inspecione em `/admin/infrastructure/queues/dlq` e **decida por mensagem** se re-enfileira (mensagens transacionais relevantes) ou descarta (campanha que já não faz sentido). Não faça requeue cego.

---

## 7. Verificação ("resolvido")

1. `quality_rating` ≠ `RED` e `account_review_status = APPROVED` (Graph API, §2).
2. Envio de teste real passa pelo canal oficial:

   ```bash
   $COMPOSE logs -f worker-outbound | grep -i "${CHANNEL_ID}"   # observe um envio com sucesso (200 da Graph API)
   ```

3. Inbound voltando: uma mensagem de teste recebida aparece na conversa (UI `app.<domínio>`).
4. Delivery rate normalizando no dashboard de campanhas; sem novos códigos de restrição nos logs.
5. Fallback WAHA revertido a default original (se aplicado).

**Resolvido quando:** §7.1 + envio de teste OK + inbound OK + sem erros de restrição por ≥ 30 min.

---

## 8. Pós-incidente

- Causa-raiz: qualidade caiu por quê? (Conteúdo, ritmo, opt-out ignorado, lista fria.) Ajuste o playbook de campanhas — a defesa real contra ban é **higiene de envio** (opt-in válido, opt-out respeitado, rate adaptativo por quality, vide `INFRASTRUCTURE.md` §11.2).
- Verifique se o rate-limit adaptativo da Meta está mesmo pausando em RED e reduzindo em YELLOW; se não pausou automaticamente antes do ban, abra follow-up de engenharia.
- Documente o tempo de apelação da Meta para calibrar expectativa de RTO em incidentes futuros.
- Se o token foi revogado (erro `190`), rotacione o `access_token` do canal e, se afetar app secret/verify token de plataforma, veja `rotate-meta-app-secret.md`.
