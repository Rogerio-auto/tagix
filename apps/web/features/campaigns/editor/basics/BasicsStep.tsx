'use client';

/**
 * Primeiro passo do criador de campanha (F58-S07).
 *
 * A regra mora em `model.ts`, pura e testada. Aqui é só apresentação — e as
 * decisões de apresentação que importam são três:
 *
 * 1. **Cada opção traz um exemplo curto.** "Sequência de mensagens" não significa
 *    nada sozinho; "uma agora, outra em três dias se não responder" significa.
 *
 * 2. **Canal inelegível aparece, desabilitado, com o motivo.** Sumir com o número
 *    do cliente produz a pior pergunta de suporte que existe: "cadê meu número?".
 *
 * 3. **Erro só depois do primeiro toque no campo.** Formulário que já abre
 *    vermelho ensina o usuário a ignorar vermelho.
 */

import type * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { Card, CardBody, Input } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import {
  canAdvance,
  channelLabel,
  sortChannels,
  validateBasics,
  warnBasics,
  NAME_MAX,
  type BasicsField,
  type BasicsState,
  type CampaignMode,
  type ChannelChoice,
} from './model';

/** Exemplo concreto por modo. É o que faz a escolha ser óbvia sem manual. */
const MODOS: ReadonlyArray<{
  id: CampaignMode;
  titulo: string;
  exemplo: string;
}> = [
  {
    id: 'single',
    titulo: 'Envio único',
    exemplo: 'Uma mensagem, uma vez. Ex.: avisar a promoção desta semana.',
  },
  {
    id: 'sequence',
    titulo: 'Sequência de mensagens',
    exemplo: 'Uma agora e outra depois de alguns dias, para quem não respondeu.',
  },
];

export interface BasicsStepProps {
  readonly value: BasicsState;
  readonly channels: readonly ChannelChoice[];
  readonly onChange: (next: BasicsState) => void;
  /** Publicado para o orquestrador do wizard decidir se libera "Continuar" (F58-S12). */
  readonly onValidityChange?: (valid: boolean) => void;
}

export function BasicsStep({
  value,
  channels,
  onChange,
  onValidityChange,
}: BasicsStepProps): React.JSX.Element {
  // Erro só aparece depois que a pessoa mexeu no campo: formulário que já abre
  // vermelho ensina o usuário a ignorar vermelho.
  const [tocados, setTocados] = useState<Partial<Record<BasicsField, boolean>>>({});

  const erros = validateBasics(value, channels);
  const avisos = warnBasics(value, channels);
  const ordenados = sortChannels(channels);

  const atualizar = (patch: Partial<BasicsState>): void => {
    const proximo = { ...value, ...patch };
    onChange(proximo);
    onValidityChange?.(canAdvance(proximo, channels));
  };

  const tocar = (campo: BasicsField): void => setTocados((t) => ({ ...t, [campo]: true }));
  const erroDe = (campo: BasicsField): string | undefined =>
    tocados[campo] === true ? erros[campo] : undefined;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Nome ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <label htmlFor="campanha-nome" className="text-small font-medium text-text">
          Como você quer chamar esta campanha?
        </label>
        <Input
          id="campanha-nome"
          value={value.name}
          maxLength={NAME_MAX}
          placeholder="Ex.: Promoção de reforma de cozinha — março"
          onChange={(e) => atualizar({ name: e.target.value })}
          onBlur={() => tocar('name')}
          aria-invalid={erroDe('name') !== undefined}
          aria-describedby={erroDe('name') !== undefined ? 'campanha-nome-erro' : undefined}
        />
        <p className="text-small text-text-3">
          Só você vê este nome. Ele não aparece para quem recebe.
        </p>
        {erroDe('name') !== undefined && (
          <p id="campanha-nome-erro" role="alert" className="text-small text-danger">
            {erros.name}
          </p>
        )}
      </div>

      {/* ── Modo ────────────────────────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-small font-medium text-text">
          Esta campanha é um envio único ou uma sequência?
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODOS.map((modo) => {
            const ativo = value.mode === modo.id;
            return (
              <button
                key={modo.id}
                type="button"
                aria-pressed={ativo}
                onClick={() => {
                  tocar('mode');
                  atualizar({ mode: modo.id });
                }}
                className={cn(
                  'flex flex-col gap-1 rounded-md border p-4 text-left transition-colors',
                  ativo
                    ? 'border-brand bg-surface-2'
                    : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <span className="font-semibold text-text">{modo.titulo}</span>
                <span className="text-small text-text-2">{modo.exemplo}</span>
              </button>
            );
          })}
        </div>
        {erroDe('mode') !== undefined && (
          <p role="alert" className="text-small text-danger">
            {erros.mode}
          </p>
        )}
      </fieldset>

      {/* ── Canal ───────────────────────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-small font-medium text-text">
          Por onde a campanha vai sair?
        </legend>

        {ordenados.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-body text-text">Nenhum canal conectado ainda.</p>
              <p className="mt-1 text-small text-text-2">
                Conecte um número de WhatsApp oficial para poder enviar campanhas.
              </p>
              <Link
                href="/settings/channels"
                className="mt-3 inline-block text-small font-medium text-brand"
              >
                Conectar um canal
              </Link>
            </CardBody>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {ordenados.map((canal) => {
              const ativo = value.channelId === canal.id;
              return (
                <div key={canal.id}>
                  <button
                    type="button"
                    disabled={!canal.eligible}
                    aria-pressed={ativo}
                    onClick={() => {
                      tocar('channelId');
                      atualizar({ channelId: canal.id });
                    }}
                    className={cn(
                      'flex w-full items-start justify-between gap-3 rounded-md border p-4 text-left transition-colors',
                      ativo
                        ? 'border-brand bg-surface-2'
                        : 'border-border bg-surface hover:border-border-strong',
                      !canal.eligible && 'cursor-not-allowed opacity-60 hover:border-border',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-text">
                        {channelLabel(canal)}
                      </span>
                      {canal.eligible ? (
                        <span className="mt-0.5 block text-small text-text-2">
                          {canal.approvedTemplateCount === 0
                            ? 'Nenhum modelo aprovado ainda'
                            : canal.approvedTemplateCount === 1
                              ? '1 modelo aprovado'
                              : `${canal.approvedTemplateCount} modelos aprovados`}
                        </span>
                      ) : (
                        // O motivo vem traduzido da API, por provider: dizer
                        // "reconecte o número do WhatsApp" quando o problema é o
                        // remetente de e-mail é pior que não dizer nada.
                        <span className="mt-0.5 block text-small text-text-3">
                          {canal.ineligibleMessage}
                        </span>
                      )}
                    </span>
                  </button>

                  {!canal.eligible && (
                    <Link
                      href="/settings/channels"
                      className="mt-1 inline-block px-1 text-small font-medium text-brand"
                    >
                      Resolver nas configurações
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {erroDe('channelId') !== undefined && (
          <p role="alert" className="text-small text-danger">
            {erros.channelId}
          </p>
        )}
        {erroDe('channelId') === undefined && avisos.channelId !== undefined && (
          <p className="text-small text-warning">{avisos.channelId}</p>
        )}
      </fieldset>
    </div>
  );
}
