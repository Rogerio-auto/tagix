# Incidente: midia de Flow enviada com tipo incorreto (2026-10-09)

## Resumo

Em 9 de outubro de 2026, um disparo manual dos flows `F3` e `F4` na conversa
`b680d889-cd30-41d5-8eed-624c10c40bc9` produziu uma bolha de nota de voz que nao
podia ser carregada. A execucao dos dois flows terminou como `completed`, mas uma
mensagem individual ficou `failed`.

O incidente ocorreu na versao de producao `75de4fd4`. Este documento e a correcao
associada foram preparados localmente e **nao foram deployados**.

## Evidencias

- 16:19:12 (America/Manaus): a mensagem
  `0e70ca6d-d85b-44ac-88f2-aa32074de6a6` foi criada como `voice`, com
  `media_mime=image/jpeg`.
- O node `message-1782489856230-21` da versao executada estava configurado com
  `messageType=audio` e `audioMessageKind=voice`, mas apontava para o arquivo
  `WhatsApp_Image_2026-06-25_at_10.03.00.jpeg` (`image/jpeg`).
- O safeguard do outbound leu os bytes, registrou `nota de voz rebaixada para audio
  (binario nao e ogg/opus)` e enviou o objeto como audio comum. A Meta recusou; o
  callback deixou a mensagem com `view_status=failed` e
  `failed_reason=channel_status_failed`.
- As outras midias da mesma execucao (OGG, MP4 e imagens coerentes) foram enviadas.
- No mesmo intervalo, o worker registrou repetidamente `(#100) Invalid parameter`
  ao tentar a pre-acao de presenca. Esse erro era cosmetico e nao foi a causa da
  mensagem `failed`, mas revelou um segundo defeito.

## Causa raiz

### 1. Estado obsoleto no editor de Flow

Ao trocar o tipo de um node de imagem para audio, o inspector atualizava apenas
`messageType`, `mediaKind` e `audioMessageKind`. Os campos
`mediaStorageKey/mediaUrl`, `mediaType` e `mediaFilename` continuavam apontando para
o arquivo anterior. O preview passava a mostrar uma nota de voz, escondendo que a
referencia ainda era uma imagem.

A validacao de publicacao verificava somente topologia do grafo, ciclos,
alcancabilidade e variaveis. Nao havia regra de coerencia entre tipo selecionado,
MIME e arquivo. Por fim, o runtime priorizava `audioMessageKind=voice` sobre o MIME
real, propagando a inconsistencia ate o outbound.

### 2. Alvo incorreto no indicador automatico do WhatsApp

O pre-action generico do outbound chamava `sendTypingIndicator` com `job.chatId`
(telefone/remote id). Na Cloud API, o indicador e atrelado ao `message_id` de uma
mensagem inbound. O telefone no campo `message_id` gera `(#100) Invalid parameter`.

O pre-action explicito dos flows ja usa o caminho correto: consulta a ultima
mensagem inbound e publica um job `typing_indicator` com seu `externalId`.

## Correcao

1. O editor limpa key, MIME e nome do arquivo ao trocar a familia da mensagem.
2. A validacao compartilhada (browser e API) impede publicar:
   - mensagem de midia sem arquivo;
   - texto com midia obsoleta;
   - `messageType` divergente do MIME.
3. O runtime usa o MIME real como fonte autoritativa para flows legados ja
   publicados. Assim, o node inconsistente deste incidente sera enviado como
   imagem depois do deploy, sem depender de alteracao imediata no banco.
4. O pre-action generico e ignorado para `meta_whatsapp`, pois o job nao possui um
   `message_id` inbound valido. WAHA continua usando `chatId`. O pre-action explicito
   de Flow continua funcionando pelo job dedicado.

## Validacao antes do deploy

Executar:

```powershell
corepack pnpm@11.5.2 --filter @hm/flow-engine test
corepack pnpm@11.5.2 --filter @hm/workers test
corepack pnpm@11.5.2 --filter @hm/web test
corepack pnpm@11.5.2 --filter @hm/flow-engine typecheck
corepack pnpm@11.5.2 --filter @hm/workers typecheck
corepack pnpm@11.5.2 --filter @hm/web typecheck
```

## Verificacao depois do deploy

1. Disparar `F3` em uma conversa de teste.
2. Confirmar que o node afetado aparece como imagem e chega a `sent/delivered`.
3. Confirmar que nao surgem novos logs `pre-action de presenca falhou` com
   `provider=meta_whatsapp` e erro `(#100)`.
4. Abrir e salvar novamente o `F3`: o editor deve exigir a selecao de uma midia
   coerente antes da proxima publicacao. Se a intencao do node era realmente uma
   nota de voz, substituir a imagem pelo audio correto e republicar.

## Dados de producao

Nenhum registro de producao foi alterado durante a investigacao. Foram realizadas
somente consultas de logs do Docker Swarm e `SELECT`s no Postgres. Nao houve
restart, republicacao de Flow ou deploy.
