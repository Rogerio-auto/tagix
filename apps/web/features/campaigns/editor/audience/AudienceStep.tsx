'use client';

/**
 * Passo do público: importação guiada (F58-S08).
 *
 * ## O que substitui, e por quê
 *
 * Antes era uma `<textarea>` onde o cliente colava CSV cru e apertava importar.
 * Ele descobria o tamanho real do público **depois** — às vezes só quando a
 * campanha já tinha saído para menos gente do que ele achava, ou para mais.
 *
 * Agora são três momentos explícitos, na ordem em que a dúvida aparece:
 *
 * 1. **Trazer os dados** — arquivo ou colar. Colar continua existindo: é como se
 *    tira uma lista de outro sistema em trinta segundos.
 * 2. **Conferir o mapeamento** — qual coluna é telefone, qual é nome. O palpite
 *    aparece na tela; um palpite escondido vira um bug que só aparece com mil
 *    mensagens já enviadas.
 * 3. **Ver a prévia** — quantos vão receber de verdade, e o que fazer com o resto.
 *
 * ## Consentimento não é caixinha
 *
 * Não existe "dar opt-in a todos". Existe **registrar de onde veio** o
 * consentimento, e o campo é obrigatório. Marcar mil pessoas como "aceitaram
 * receber" sem dizer onde não é consentimento: é uma afirmação sem prova — e nos
 * EUA a prova é o que separa uma campanha de uma multa por mensagem.
 */

import type * as React from 'react';
import { useMemo, useState } from 'react';
import { Button, Card, CardBody, Input } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import { parseCsvFile, type ColumnRole } from './csv-parse';
import {
  classifyAudience,
  VERDICT_HINT,
  VERDICT_LABEL,
  type RowVerdict,
} from './classify';

/** Papéis oferecidos no seletor de coluna, na ordem em que fazem sentido. */
const PAPEIS: ReadonlyArray<{ id: ColumnRole; label: string }> = [
  { id: 'phone', label: 'Telefone' },
  { id: 'name', label: 'Nome' },
  { id: 'consent', label: 'Consentimento' },
  { id: 'ignore', label: 'Ignorar' },
];

/** Ordem de exibição da prévia: primeiro o que decide, depois o que corrige. */
const ORDEM: readonly RowVerdict[] = [
  'valido',
  'sem_consentimento',
  'telefone_invalido',
  'repetido_no_arquivo',
  'ja_na_campanha',
];

const COR: Readonly<Record<RowVerdict, string>> = {
  valido: 'text-brand',
  sem_consentimento: 'text-warning',
  telefone_invalido: 'text-danger',
  repetido_no_arquivo: 'text-text-2',
  ja_na_campanha: 'text-text-2',
};

export interface AudienceStepProps {
  /** Fuso/mercado do workspace decide como normalizar telefone sem DDI. */
  readonly defaultCountry: '55' | '1';
  /** Do market pack: nos EUA marketing exige consentimento prévio. */
  readonly requireConsent: boolean;
  /** Telefones já vinculados a esta campanha (para não recontar). */
  readonly alreadyInCampaign?: ReadonlySet<string>;
  /** Envia o que foi conferido. O passo não sabe falar com a API. */
  readonly onImport: (input: {
    rows: ReadonlyArray<{ phone: string; name?: string; optIn?: boolean }>;
    source?: string;
    optInOnImport: boolean;
  }) => Promise<void>;
}

export function AudienceStep({
  defaultCountry,
  requireConsent,
  alreadyInCampaign,
  onImport,
}: AudienceStepProps): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const [roles, setRoles] = useState<ColumnRole[] | null>(null);
  const [origem, setOrigem] = useState('');
  const [registrarConsentimento, setRegistrarConsentimento] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const arquivo = useMemo(() => (texto.trim() === '' ? null : parseCsvFile(texto)), [texto]);
  const papeis = roles ?? arquivo?.roles ?? [];

  const linhas = useMemo(() => {
    if (arquivo === null) return [];
    const iTel = papeis.indexOf('phone');
    const iNome = papeis.indexOf('name');
    const iCons = papeis.indexOf('consent');
    if (iTel < 0) return [];
    return arquivo.rows.map((cols) => ({
      phone: cols[iTel] ?? '',
      ...(iNome >= 0 && cols[iNome] !== undefined ? { name: cols[iNome] } : {}),
      ...(iCons >= 0 ? { consent: /^(1|true|sim|yes|s|y)$/i.test((cols[iCons] ?? '').trim()) } : {}),
    }));
  }, [arquivo, papeis]);

  const previa = useMemo(
    () =>
      classifyAudience({
        rows: linhas,
        defaultCountry,
        ...(alreadyInCampaign !== undefined ? { alreadyInCampaign } : {}),
        // Quem vai registrar a origem agora não deve ver todo mundo como "sem
        // consentimento": a prévia reflete o estado APÓS a importação.
        requireConsent: requireConsent && !registrarConsentimento,
      }),
    [linhas, defaultCountry, alreadyInCampaign, requireConsent, registrarConsentimento],
  );

  const semColunaTelefone = arquivo !== null && !papeis.includes('phone');
  const origemFaltando = registrarConsentimento && origem.trim().length < 3;
  const podeImportar =
    previa.willReceive > 0 && !semColunaTelefone && !origemFaltando && !enviando;

  const importar = async (): Promise<void> => {
    setEnviando(true);
    try {
      await onImport({
        rows: previa.rows
          .filter((r) => r.verdict === 'valido' && r.phone !== null)
          .map((r) => ({
            phone: r.phone as string,
            ...(r.name !== null ? { name: r.name } : {}),
          })),
        ...(registrarConsentimento ? { source: origem.trim() } : {}),
        optInOnImport: registrarConsentimento,
      });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── 1. Trazer os dados ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <label htmlFor="publico-csv" className="text-small font-medium text-text">
          Quem vai receber esta campanha?
        </label>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          className="text-small text-text-2 file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-small file:text-text"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f === undefined) return;
            // Lido no navegador: a conferência acontece ANTES de qualquer byte
            // sair da máquina do cliente.
            void f.text().then((t) => {
              setTexto(t);
              setRoles(null);
            });
          }}
        />
        <p className="text-small text-text-3">
          Envie um arquivo CSV, ou cole a lista abaixo. Uma linha por pessoa.
        </p>
        <textarea
          id="publico-csv"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setRoles(null);
          }}
          rows={5}
          placeholder={'telefone,nome\n+5566999342444,Ana Souza'}
          className="rounded-md border border-border bg-surface p-3 font-mono text-small text-text"
        />
      </div>

      {/* ── 2. Conferir o mapeamento ────────────────────────────────────────── */}
      {arquivo !== null && arquivo.rows.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-small font-medium text-text">O que é cada coluna?</p>
          <div className="flex flex-wrap gap-2">
            {papeis.map((papel, i) => (
              <label key={i} className="flex flex-col gap-1">
                <span className="max-w-[10rem] truncate text-small text-text-2">
                  {arquivo.header?.[i] ?? `Coluna ${i + 1}`}
                </span>
                <select
                  value={papel}
                  onChange={(e) => {
                    const novo = [...papeis];
                    novo[i] = e.target.value as ColumnRole;
                    setRoles(novo);
                  }}
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-small text-text"
                >
                  {PAPEIS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {arquivo.header === null && (
            <p className="text-small text-text-3">
              Seu arquivo não parece ter cabeçalho. Assumimos a primeira coluna como telefone —
              corrija acima se não for.
            </p>
          )}
          {semColunaTelefone && (
            <p role="alert" className="text-small text-danger">
              Escolha qual coluna tem o telefone. Sem isso não dá para enviar.
            </p>
          )}
        </div>
      )}

      {/* ── 3. Prévia ───────────────────────────────────────────────────────── */}
      {previa.rows.length > 0 && (
        <Card>
          <CardBody>
            <p className="font-head text-h3 text-text">
              {previa.willReceive === 1
                ? '1 pessoa vai receber'
                : `${previa.willReceive} pessoas vão receber`}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {ORDEM.filter((v) => previa.counts[v] > 0).map((v) => (
                <li key={v} className="flex flex-col">
                  <span className={cn('text-small font-medium', COR[v])}>
                    {previa.counts[v]} · {VERDICT_LABEL[v]}
                  </span>
                  {VERDICT_HINT[v] !== '' && (
                    <span className="text-small text-text-3">{VERDICT_HINT[v]}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* ── Consentimento ───────────────────────────────────────────────────── */}
      {previa.rows.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={registrarConsentimento}
              onChange={(e) => setRegistrarConsentimento(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="block font-medium text-text">
                Estas pessoas autorizaram receber mensagens
              </span>
              <span className="mt-0.5 block text-small text-text-2">
                Marque só se for verdade. Você precisa dizer onde elas autorizaram.
              </span>
            </span>
          </label>

          {registrarConsentimento && (
            <div className="ml-7 flex flex-col gap-1">
              <label htmlFor="consent-origem" className="text-small font-medium text-text">
                Onde elas autorizaram?
              </label>
              <Input
                id="consent-origem"
                value={origem}
                onChange={(e) => setOrigem(e.target.value)}
                placeholder="Ex.: formulário do site, cadastro na loja, orçamento por telefone"
                aria-invalid={origemFaltando}
              />
              {origemFaltando && (
                <p role="alert" className="text-small text-danger">
                  Diga de onde veio o consentimento. Sem isso, o registro não vale como prova.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <Button onClick={() => void importar()} disabled={!podeImportar}>
          {enviando
            ? 'Importando…'
            : previa.willReceive > 0
              ? `Importar ${previa.willReceive}`
              : 'Importar'}
        </Button>
      </div>
    </div>
  );
}
