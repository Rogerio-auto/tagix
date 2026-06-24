'use client';

/**
 * Edição de endereço com autopreenchimento ViaCEP (F47-S06).
 *
 * UX:
 *  §2.1 — editar é digitar no corpo dos campos (não engrenagem); o CEP completo
 *         dispara o autofill automaticamente (sem botão escondido).
 *  §2.7 — feedback imediato: spinner inline enquanto busca o CEP.
 *  §2.11 — erro do CEP em 3 partes (o quê / por quê / o que fazer), inline.
 *  §8 (mobile) — inputs herdam ≥16px do globals.css; campos empilham e respiram.
 *
 * Componente CONTROLADO: recebe `value` e emite `onChange`. Não persiste — o
 * `<ContactPanel>` decide quando salvar (PATCH). Read-only quando `!editable`.
 */

import { useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Input } from '@hm/ui';
import type { ContactAddress } from '../types';
import { fetchCep, formatCep } from '@/shared/lib/viacep';

type CepState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'invalid' }
  | { kind: 'error' };

const UF_RE = /^[A-Z]{0,2}$/;

export function AddressForm({
  value,
  onChange,
  editable = true,
}: {
  value: ContactAddress;
  onChange: (next: ContactAddress) => void;
  editable?: boolean;
}) {
  const [cepState, setCepState] = useState<CepState>({ kind: 'idle' });
  // Evita corrida: só a busca mais recente pode aplicar resultado.
  const lookupSeq = useRef(0);

  function patch(partial: Partial<ContactAddress>): void {
    onChange({ ...value, ...partial });
  }

  async function runLookup(rawCep: string): Promise<void> {
    const seq = ++lookupSeq.current;
    setCepState({ kind: 'loading' });
    const result = await fetchCep(rawCep);
    if (seq !== lookupSeq.current) return; // resultado obsoleto

    if (result.status === 'ok') {
      setCepState({ kind: 'idle' });
      onChange({
        ...value,
        cep: formatCep(result.address.cep),
        street: result.address.street || value.street,
        district: result.address.district || value.district,
        city: result.address.city,
        state: result.address.state,
      });
      return;
    }
    setCepState({ kind: result.status });
  }

  function handleCepChange(raw: string): void {
    const masked = formatCep(raw);
    patch({ cep: masked });
    if (cepState.kind !== 'idle') setCepState({ kind: 'idle' });

    const digits = masked.replace(/\D/g, '');
    if (digits.length === 8) void runLookup(masked);
  }

  // ── Read-only: render compacto do endereço montado ────────────────────────
  if (!editable) {
    const line1 = [value.street, value.number].filter(Boolean).join(', ');
    const line2 = [value.district, value.city && `${value.city}${value.state ? ` - ${value.state}` : ''}`]
      .filter(Boolean)
      .join(' · ');
    return (
      <div className="flex flex-col gap-0.5 font-body text-sm text-text">
        {value.cep && <span className="text-text-mid">{formatCep(value.cep)}</span>}
        {line1 && <span>{line1}</span>}
        {value.complement && <span className="text-text-mid">{value.complement}</span>}
        {line2 && <span className="text-text-mid">{line2}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* CEP — gatilho do autofill */}
      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <Input
            label="CEP"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="00000-000"
            maxLength={9}
            value={value.cep ?? ''}
            onChange={(e) => handleCepChange(e.target.value)}
          />
          {cepState.kind === 'loading' && (
            <Loader2
              className="absolute right-3 top-[2.35rem] size-4 animate-spin text-text-low"
              aria-hidden
            />
          )}
        </div>

        {/* Erro do CEP em 3 partes (§2.11) */}
        {(cepState.kind === 'not_found' || cepState.kind === 'error') && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0 font-body text-xs">
              {cepState.kind === 'not_found' ? (
                <>
                  <p className="font-semibold text-danger">CEP não encontrado</p>
                  <p className="text-text-mid">Esse CEP não consta na base dos Correios.</p>
                  <p className="text-text-low">Confira os 8 dígitos ou preencha o endereço à mão.</p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-danger">Não foi possível consultar o CEP</p>
                  <p className="text-text-mid">A consulta de endereço está indisponível agora.</p>
                  <p className="text-text-low">Tente de novo ou preencha o endereço manualmente.</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Rua + número */}
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Input
          label="Rua"
          autoComplete="address-line1"
          value={value.street ?? ''}
          onChange={(e) => patch({ street: e.target.value })}
        />
        <Input
          label="Número"
          inputMode="numeric"
          value={value.number ?? ''}
          onChange={(e) => patch({ number: e.target.value })}
        />
      </div>

      {/* Complemento */}
      <Input
        label="Complemento"
        placeholder="Apto, bloco, referência"
        value={value.complement ?? ''}
        onChange={(e) => patch({ complement: e.target.value })}
      />

      {/* Bairro */}
      <Input
        label="Bairro"
        value={value.district ?? ''}
        onChange={(e) => patch({ district: e.target.value })}
      />

      {/* Cidade + UF */}
      <div className="grid grid-cols-[1fr_5rem] gap-3">
        <Input
          label="Cidade"
          autoComplete="address-level2"
          value={value.city ?? ''}
          onChange={(e) => patch({ city: e.target.value })}
        />
        <Input
          label="UF"
          maxLength={2}
          placeholder="SP"
          value={value.state ?? ''}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            if (UF_RE.test(next)) patch({ state: next });
          }}
        />
      </div>
    </div>
  );
}
