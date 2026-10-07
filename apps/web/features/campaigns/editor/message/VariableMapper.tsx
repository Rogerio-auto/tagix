'use client';

/**
 * Mapeamento das variáveis do modelo (F58-S09).
 *
 * Cada espaço `{{n}}` vira uma pergunta em português: "o que vai aqui?". A
 * resposta é um dado do contato, um campo personalizado ou um texto fixo — e,
 * para os dois primeiros, o texto reserva é obrigatório: um contato sem nome
 * não pode receber "Olá , tudo bem?".
 *
 * O exemplo ao lado é o valor REAL que sairia para o contato de amostra (ou o
 * texto reserva, quando ele não tem o dado). O exemplo aprovado pela Meta
 * aparece só como dica — nunca é preenchido sozinho.
 */
import type * as React from 'react';
import { useId } from 'react';
import { Input } from '@hm/ui';
import { cn } from '@/shared/lib/cn';
import {
  CONTACT_FIELD_LABEL,
  SOURCE_KIND_LABEL,
  changeSourceKind,
  resolveValue,
  slotKey,
  type BindingSource,
  type BindingSourceKind,
  type ContactField,
  type ContactSample,
  type MessageIssue,
  type SlotKey,
  type TemplateBinding,
  type VariableSlot,
} from './model';

export interface VariableMapperProps {
  readonly slots: readonly VariableSlot[];
  readonly bindings: readonly TemplateBinding[];
  readonly contact: ContactSample | null;
  /** Chaves de campos personalizados conhecidos (sugestões no campo). */
  readonly customFieldKeys?: readonly string[];
  readonly issues: readonly MessageIssue[];
  /** Mostra os erros de todos os campos (depois de tentar avançar). */
  readonly showAllErrors: boolean;
  readonly touched: ReadonlySet<SlotKey>;
  readonly onTouch: (key: SlotKey) => void;
  readonly onChange: (key: SlotKey, source: BindingSource) => void;
  readonly disabled?: boolean;
}

const KINDS: readonly BindingSourceKind[] = ['contact', 'customField', 'fixed'];
const FIELDS: readonly ContactField[] = ['displayName', 'phone', 'email'];

const FALLBACK_PLACEHOLDER: Readonly<Record<ContactField, string>> = {
  displayName: 'Ex.: cliente',
  phone: 'Ex.: seu número',
  email: 'Ex.: seu e-mail',
};

function Context({ slot }: { slot: VariableSlot }): React.JSX.Element {
  // O trecho do modelo com o espaço destacado — onde, na frase, o valor cai.
  const parts = slot.context.split(/(\{\{\s*\d+\s*\}\})/u);
  return (
    <p className="text-xs leading-relaxed text-text-low">
      {parts.map((part, i) =>
        /^\{\{\s*\d+\s*\}\}$/u.test(part) ? (
          <span
            key={i}
            className={cn(
              'rounded-xs px-0.5 font-mono',
              part.replace(/\s/gu, '') === `{{${slot.component === 'button' ? 1 : slot.index}}}`
                ? 'bg-info-bg text-info'
                : 'text-text-low',
            )}
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

function Row({
  slot,
  binding,
  contact,
  customFieldKeys,
  errors,
  onTouch,
  onChange,
  disabled,
}: {
  slot: VariableSlot;
  binding: TemplateBinding | undefined;
  contact: ContactSample | null;
  customFieldKeys: readonly string[];
  errors: readonly MessageIssue[];
  onTouch: () => void;
  onChange: (source: BindingSource) => void;
  disabled: boolean;
}): React.JSX.Element {
  const id = useId();
  const source: BindingSource = binding?.source ?? { kind: 'fixed', value: '' };
  const resolved = resolveValue(source, contact);
  const errorOf = (code: MessageIssue['code']): string | undefined =>
    errors.find((e) => e.code === code)?.text;

  const example = resolved.value.trim();
  const isButton = slot.component === 'button';

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-text">{slot.label}</span>
        <Context slot={slot} />
      </div>

      <div
        role="radiogroup"
        aria-label={`O que vai em ${slot.label}`}
        className="flex flex-wrap gap-1.5"
      >
        {KINDS.map((kind) => {
          const active = source.kind === kind;
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => {
                onTouch();
                onChange(changeSourceKind(source, kind));
              }}
              className={cn(
                'rounded-pill border px-3 py-1 text-xs outline-none transition-colors duration-150 focus-visible:shadow-glow-md motion-reduce:transition-none',
                'disabled:cursor-not-allowed disabled:opacity-50',
                active
                  ? 'border-border-2 bg-surface-3 text-text'
                  : 'border-border text-text-mid hover:bg-surface-2',
              )}
            >
              {SOURCE_KIND_LABEL[kind]}
            </button>
          );
        })}
      </div>

      {source.kind === 'contact' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm text-text-mid">
            Qual dado
            <select
              value={source.field}
              disabled={disabled}
              onChange={(e) => onChange({ ...source, field: e.target.value as ContactField })}
              className="h-10 rounded-sm border border-border bg-surface-inset px-3 text-sm text-text outline-none hover:border-border-2 focus-visible:shadow-glow-md disabled:opacity-40"
            >
              {FIELDS.map((field) => (
                <option key={field} value={field}>
                  {CONTACT_FIELD_LABEL[field]}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="Se o contato não tiver esse dado"
            value={source.fallback}
            disabled={disabled}
            maxLength={1000}
            placeholder={FALLBACK_PLACEHOLDER[source.field]}
            onBlur={onTouch}
            onChange={(e) => onChange({ ...source, fallback: e.target.value })}
            {...(errorOf('fallback_empty') ? { error: errorOf('fallback_empty') } : {})}
          />
        </div>
      ) : null}

      {source.kind === 'customField' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Nome do campo"
            value={source.key}
            disabled={disabled}
            maxLength={120}
            list={customFieldKeys.length > 0 ? `${id}-fields` : undefined}
            placeholder="Ex.: cidade"
            onBlur={onTouch}
            onChange={(e) => onChange({ ...source, key: e.target.value })}
            {...(errorOf('custom_key_empty') ? { error: errorOf('custom_key_empty') } : {})}
          />
          {customFieldKeys.length > 0 ? (
            <datalist id={`${id}-fields`}>
              {customFieldKeys.map((key) => (
                <option key={key} value={key} />
              ))}
            </datalist>
          ) : null}
          <Input
            label="Se o contato não tiver esse campo"
            value={source.fallback}
            disabled={disabled}
            maxLength={1000}
            placeholder="Ex.: sua cidade"
            onBlur={onTouch}
            onChange={(e) => onChange({ ...source, fallback: e.target.value })}
            {...(errorOf('fallback_empty') ? { error: errorOf('fallback_empty') } : {})}
          />
        </div>
      ) : null}

      {source.kind === 'fixed' ? (
        <Input
          label={isButton ? 'Final do link' : 'Texto que vai para todos'}
          value={source.value}
          disabled={disabled}
          maxLength={1000}
          placeholder={slot.approvedExample ? `Ex.: ${slot.approvedExample}` : 'Escreva o texto'}
          onBlur={onTouch}
          onChange={(e) => onChange({ kind: 'fixed', value: e.target.value })}
          {...(errorOf('fixed_empty')
            ? { error: errorOf('fixed_empty') }
            : isButton
              ? { hint: 'Só a parte do link que muda — o começo já está aprovado no modelo.' }
              : {})}
        />
      ) : null}

      <p
        className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-text-low"
        aria-live="polite"
      >
        {contact ? (
          <>
            <span>Para {contact.displayName?.trim() || 'o contato de exemplo'}:</span>
            {example ? (
              <span className="font-medium text-text">{example}</span>
            ) : (
              <span className="text-warn">ainda sem valor</span>
            )}
            {resolved.usedFallback && example ? <span>(texto reserva)</span> : null}
          </>
        ) : example ? (
          <>
            <span>{source.kind === 'fixed' ? 'Vai sair:' : 'Quem não tiver o dado recebe:'}</span>
            <span className="font-medium text-text">{example}</span>
          </>
        ) : slot.approvedExample ? (
          <span>Exemplo aprovado pela Meta: {slot.approvedExample}</span>
        ) : (
          <span>Defina o valor para ver o exemplo.</span>
        )}
      </p>
    </li>
  );
}

export function VariableMapper({
  slots,
  bindings,
  contact,
  customFieldKeys = [],
  issues,
  showAllErrors,
  touched,
  onTouch,
  onChange,
  disabled = false,
}: VariableMapperProps): React.JSX.Element {
  if (slots.length === 0) {
    return (
      <p className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm text-text-mid">
        Este modelo não tem campos para preencher: todo mundo recebe o mesmo texto.
      </p>
    );
  }
  return (
    <ul aria-label="Campos da mensagem" className="flex flex-col gap-2">
      {slots.map((slot) => {
        const binding = bindings.find((b) => slotKey(b.component, b.index) === slot.key);
        const visibleErrors =
          showAllErrors || touched.has(slot.key) ? issues.filter((i) => i.slot === slot.key) : [];
        return (
          <Row
            key={slot.key}
            slot={slot}
            binding={binding}
            contact={contact}
            customFieldKeys={customFieldKeys}
            errors={visibleErrors}
            onTouch={() => onTouch(slot.key)}
            onChange={(source) => onChange(slot.key, source)}
            disabled={disabled}
          />
        );
      })}
    </ul>
  );
}
