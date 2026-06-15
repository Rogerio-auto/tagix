'use client';

import { useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  List as ListIcon,
  Phone,
  Plus,
  Reply,
  Trash2,
} from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useFlowEditor } from '../../hooks/useFlowEditor';
import { VariablesPicker } from '../../inspector/VariablesPicker';
import { SelectField, TextField } from '../inspector-fields';

/**
 * Inspector rico do node `interactive` (F31-S04). Editor ESTRUTURADO (nao JSON):
 * botoes reply/url/phone e listas com secoes/itens, header/footer, body
 * interpolavel (VariablesPicker), validacao de limites do provider (WhatsApp)
 * sinalizada inline e preview WYSIWYG.
 *
 * Espelha o shape de `interactive.handler.ts`. Validacao reativa (feedback
 * imediato, UX §2.7) com estados de erro DS v2 (token `danger`).
 */

const LIMITS = {
  body: 1024,
  header: 60,
  footer: 60,
  buttonTitle: 20,
  buttonLabel: 20,
  replyButtonsMax: 3,
  sectionsMax: 10,
  rowsTotalMax: 10,
  rowTitle: 24,
  rowDescription: 72,
  sectionTitle: 24,
} as const;

type ButtonType = 'reply' | 'url' | 'phone';

interface InteractiveButton {
  type: ButtonType;
  id?: string;
  title?: string;
  url?: string;
  phoneNumber?: string;
}
interface ListRow {
  id?: string;
  title?: string;
  description?: string;
}
interface ListSection {
  title?: string;
  rows: ListRow[];
}

const genId = (prefix: string): string => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readButtons(value: unknown): InteractiveButton[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw): InteractiveButton => {
    const r = asRecord(raw);
    const type = ((r['type'] as string) ?? 'reply') as ButtonType;
    return {
      type: type === 'url' || type === 'phone' ? type : 'reply',
      id: typeof r['id'] === 'string' ? r['id'] : undefined,
      title: typeof r['title'] === 'string' ? r['title'] : undefined,
      url: typeof r['url'] === 'string' ? r['url'] : undefined,
      phoneNumber: typeof r['phoneNumber'] === 'string' ? r['phoneNumber'] : undefined,
    };
  });
}

function readSections(value: unknown): ListSection[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw): ListSection => {
    const r = asRecord(raw);
    const rowsRaw = Array.isArray(r['rows']) ? r['rows'] : [];
    return {
      title: typeof r['title'] === 'string' ? r['title'] : undefined,
      rows: rowsRaw.map((rr): ListRow => {
        const row = asRecord(rr);
        return {
          id: typeof row['id'] === 'string' ? row['id'] : undefined,
          title: typeof row['title'] === 'string' ? row['title'] : undefined,
          description: typeof row['description'] === 'string' ? row['description'] : undefined,
        };
      }),
    };
  });
}

export function InteractiveInspector({ nodeId }: { nodeId: string }) {
  const nodes = useFlowEditor((s) => s.nodes);
  const update = useFlowEditor((s) => s.updateNodeData);
  const node = nodes.find((n) => n.id === nodeId);

  const d = useMemo(() => asRecord(node?.data), [node?.data]);
  const kind: 'buttons' | 'list' = d['kind'] === 'list' ? 'list' : 'buttons';
  const body = (d['body'] as string) ?? '';
  const header = (d['header'] as string) ?? '';
  const footer = (d['footer'] as string) ?? '';
  const buttonLabel = (d['buttonLabel'] as string) ?? '';
  const buttons = useMemo(() => readButtons(d['buttons']), [d]);
  const sections = useMemo(() => readSections(d['sections']), [d]);

  if (!node) return null;
  const set = (patch: Record<string, unknown>) => update(nodeId, patch);

  // ---- mutators -----------------------------------------------------------
  const setButtons = (next: InteractiveButton[]) => set({ buttons: next });
  const setSections = (next: ListSection[]) => set({ sections: next });

  const addButton = (type: ButtonType) => {
    const base: InteractiveButton =
      type === 'reply' ? { type, id: genId('btn'), title: '' } : { type, title: '' };
    setButtons([...buttons, base]);
  };
  const updateButton = (i: number, patch: Partial<InteractiveButton>) =>
    setButtons(buttons.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const removeButton = (i: number) => setButtons(buttons.filter((_, idx) => idx !== i));
  const moveButton = (i: number, dir: -1 | 1) => setButtons(moveItem(buttons, i, dir));

  const addSection = () =>
    setSections([...sections, { title: '', rows: [{ id: genId('row'), title: '' }] }]);
  const updateSection = (si: number, patch: Partial<ListSection>) =>
    setSections(sections.map((s, idx) => (idx === si ? { ...s, ...patch } : s)));
  const removeSection = (si: number) => setSections(sections.filter((_, idx) => idx !== si));
  const moveSection = (si: number, dir: -1 | 1) => setSections(moveItem(sections, si, dir));

  const addRow = (si: number) =>
    updateSection(si, {
      rows: [...(sections[si]?.rows ?? []), { id: genId('row'), title: '' }],
    });
  const updateRow = (si: number, ri: number, patch: Partial<ListRow>) =>
    updateSection(si, {
      rows: (sections[si]?.rows ?? []).map((r, idx) => (idx === ri ? { ...r, ...patch } : r)),
    });
  const removeRow = (si: number, ri: number) =>
    updateSection(si, { rows: (sections[si]?.rows ?? []).filter((_, idx) => idx !== ri) });

  // ---- validation ---------------------------------------------------------
  const replyCount = buttons.filter((b) => b.type === 'reply').length;
  const totalRows = sections.reduce((acc, s) => acc + s.rows.length, 0);
  const bodyError = body.trim().length === 0 ? 'Corpo obrigatorio' : undefined;

  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label="Tipo"
        value={kind}
        options={[
          { value: 'buttons', label: 'Botoes' },
          { value: 'list', label: 'Lista' },
        ]}
        onChange={(v) => set({ kind: v })}
      />

      <BodyField
        value={body}
        error={bodyError}
        onChange={(v) => set({ body: v })}
        onInsertToken={(token) => set({ body: `${body}${token}` })}
      />

      <LimitedTextField
        label="Cabecalho (opcional)"
        value={header}
        max={LIMITS.header}
        placeholder="Titulo curto"
        onChange={(v) => set({ header: v })}
      />
      <LimitedTextField
        label="Rodape (opcional)"
        value={footer}
        max={LIMITS.footer}
        placeholder="Texto de rodape"
        onChange={(v) => set({ footer: v })}
      />

      {kind === 'buttons' ? (
        <ButtonsEditor
          buttons={buttons}
          replyCount={replyCount}
          onAdd={addButton}
          onUpdate={updateButton}
          onRemove={removeButton}
          onMove={moveButton}
        />
      ) : (
        <ListEditor
          buttonLabel={buttonLabel}
          sections={sections}
          totalRows={totalRows}
          onButtonLabel={(v) => set({ buttonLabel: v })}
          onAddSection={addSection}
          onUpdateSection={updateSection}
          onRemoveSection={removeSection}
          onMoveSection={moveSection}
          onAddRow={addRow}
          onUpdateRow={updateRow}
          onRemoveRow={removeRow}
        />
      )}

      <Preview
        kind={kind}
        header={header}
        body={body}
        footer={footer}
        buttons={buttons}
        buttonLabel={buttonLabel}
        sections={sections}
      />
    </div>
  );
}

function moveItem<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir;
  if (target < 0 || target >= arr.length) return arr;
  const next = [...arr];
  const a = next[index];
  const b = next[target];
  if (a === undefined || b === undefined) return arr;
  next[index] = b;
  next[target] = a;
  return next;
}

// ---------------------------------------------------------------------------
// Body field with VariablesPicker
// ---------------------------------------------------------------------------
function BodyField({
  value,
  error,
  onChange,
  onInsertToken,
}: {
  value: string;
  error?: string;
  onChange: (v: string) => void;
  onInsertToken: (token: string) => void;
}) {
  const over = value.length > LIMITS.body;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-low">Corpo</span>
        <VariablesPicker onPick={onInsertToken} />
      </div>
      <textarea
        value={value}
        placeholder="Escolha uma opcao {{contact.name}}"
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error) || over}
        className={cn(
          'min-h-[90px] rounded-md border bg-surface-2 px-3 py-2 text-sm text-text focus:outline-none',
          error || over ? 'border-danger focus:border-danger' : 'border-border-2 focus:border-accent',
        )}
      />
      <div className="flex items-center justify-between">
        {error ? (
          <span className="text-[11px] text-danger">{error}</span>
        ) : (
          <span className="text-[11px] text-text-low">Suporta variaveis {`{{...}}`}.</span>
        )}
        <CharCounter length={value.length} max={LIMITS.body} />
      </div>
    </div>
  );
}

function CharCounter({ length, max }: { length: number; max: number }) {
  const over = length > max;
  return (
    <span className={cn('text-[11px] tabular-nums', over ? 'text-danger' : 'text-text-low')}>
      {length}/{max}
    </span>
  );
}

function LimitedTextField({
  label,
  value,
  max,
  placeholder,
  error,
  onChange,
}: {
  label: string;
  value: string;
  max: number;
  placeholder?: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  const over = value.length > max;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-low">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error) || over}
        className={cn(
          'rounded-md border bg-surface-2 px-3 py-2 text-sm text-text focus:outline-none',
          error || over ? 'border-danger focus:border-danger' : 'border-border-2 focus:border-accent',
        )}
      />
      <div className="flex items-center justify-between">
        {error ? <span className="text-[11px] text-danger">{error}</span> : <span />}
        <CharCounter length={value.length} max={max} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons editor
// ---------------------------------------------------------------------------
const BUTTON_META: Record<ButtonType, { label: string; icon: typeof Reply }> = {
  reply: { label: 'Resposta', icon: Reply },
  url: { label: 'Link', icon: ExternalLink },
  phone: { label: 'Telefone', icon: Phone },
};

function ButtonsEditor({
  buttons,
  replyCount,
  onAdd,
  onUpdate,
  onRemove,
  onMove,
}: {
  buttons: InteractiveButton[];
  replyCount: number;
  onAdd: (type: ButtonType) => void;
  onUpdate: (i: number, patch: Partial<InteractiveButton>) => void;
  onRemove: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
}) {
  const replyFull = replyCount >= LIMITS.replyButtonsMax;
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Botoes" hint={`${replyCount}/${LIMITS.replyButtonsMax} de resposta`} />

      {buttons.length === 0 && (
        <p className="rounded-md border border-dashed border-border-2 px-3 py-3 text-center text-xs text-text-low">
          Nenhum botao. Adicione abaixo.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {buttons.map((b, i) => (
          <ButtonRow
            key={i}
            index={i}
            count={buttons.length}
            button={b}
            replyOverLimit={b.type === 'reply' && replyCount > LIMITS.replyButtonsMax}
            onUpdate={(patch) => onUpdate(i, patch)}
            onRemove={() => onRemove(i)}
            onMove={(dir) => onMove(i, dir)}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <AddChip
          icon={Reply}
          label="Resposta"
          disabled={replyFull}
          title={replyFull ? `Maximo ${LIMITS.replyButtonsMax} botoes de resposta` : undefined}
          onClick={() => onAdd('reply')}
        />
        <AddChip icon={ExternalLink} label="Link" onClick={() => onAdd('url')} />
        <AddChip icon={Phone} label="Telefone" onClick={() => onAdd('phone')} />
      </div>
    </section>
  );
}

function ButtonRow({
  index,
  count,
  button,
  replyOverLimit,
  onUpdate,
  onRemove,
  onMove,
}: {
  index: number;
  count: number;
  button: InteractiveButton;
  replyOverLimit: boolean;
  onUpdate: (patch: Partial<InteractiveButton>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const meta = BUTTON_META[button.type];
  const Icon = meta.icon;
  const title = button.title ?? '';
  const titleError = title.trim().length === 0 ? 'Titulo obrigatorio' : undefined;
  return (
    <div
      className={cn(
        'rounded-md border bg-surface-1 p-2.5',
        replyOverLimit ? 'border-danger' : 'border-border-2',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-mid">
          <Icon className="size-3.5" aria-hidden />
          {meta.label}
        </span>
        <ItemControls index={index} count={count} onMove={onMove} onRemove={onRemove} />
      </div>

      <div className="flex flex-col gap-2">
        <LimitedTextField
          label="Titulo"
          value={title}
          max={LIMITS.buttonTitle}
          error={titleError}
          placeholder="Texto do botao"
          onChange={(v) => onUpdate({ title: v })}
        />
        {button.type === 'url' && (
          <TextField
            label="URL"
            value={button.url ?? ''}
            placeholder="https://exemplo.com"
            onChange={(v) => onUpdate({ url: v })}
          />
        )}
        {button.type === 'phone' && (
          <TextField
            label="Telefone"
            value={button.phoneNumber ?? ''}
            placeholder="+5511999999999"
            onChange={(v) => onUpdate({ phoneNumber: v })}
          />
        )}
        {replyOverLimit && (
          <p className="text-[11px] text-danger">
            Excede {LIMITS.replyButtonsMax} botoes de resposta permitidos.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List editor
// ---------------------------------------------------------------------------
function ListEditor({
  buttonLabel,
  sections,
  totalRows,
  onButtonLabel,
  onAddSection,
  onUpdateSection,
  onRemoveSection,
  onMoveSection,
  onAddRow,
  onUpdateRow,
  onRemoveRow,
}: {
  buttonLabel: string;
  sections: ListSection[];
  totalRows: number;
  onButtonLabel: (v: string) => void;
  onAddSection: () => void;
  onUpdateSection: (si: number, patch: Partial<ListSection>) => void;
  onRemoveSection: (si: number) => void;
  onMoveSection: (si: number, dir: -1 | 1) => void;
  onAddRow: (si: number) => void;
  onUpdateRow: (si: number, ri: number, patch: Partial<ListRow>) => void;
  onRemoveRow: (si: number, ri: number) => void;
}) {
  const rowsFull = totalRows >= LIMITS.rowsTotalMax;
  const sectionsFull = sections.length >= LIMITS.sectionsMax;
  const labelError = buttonLabel.trim().length === 0 ? 'Rotulo obrigatorio' : undefined;
  return (
    <section className="flex flex-col gap-2">
      <LimitedTextField
        label="Rotulo do botao da lista"
        value={buttonLabel}
        max={LIMITS.buttonLabel}
        error={labelError}
        placeholder="Ver opcoes"
        onChange={onButtonLabel}
      />

      <SectionHeader
        title="Secoes"
        hint={`${totalRows}/${LIMITS.rowsTotalMax} itens · ${sections.length}/${LIMITS.sectionsMax} secoes`}
      />

      {sections.length === 0 && (
        <p className="rounded-md border border-dashed border-border-2 px-3 py-3 text-center text-xs text-text-low">
          Nenhuma secao. Adicione abaixo.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {sections.map((s, si) => (
          <div key={si} className="rounded-md border border-border-2 bg-surface-1 p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-text-mid">Secao {si + 1}</span>
              <ItemControls
                index={si}
                count={sections.length}
                onMove={(dir) => onMoveSection(si, dir)}
                onRemove={() => onRemoveSection(si)}
              />
            </div>

            <LimitedTextField
              label="Titulo da secao (opcional)"
              value={s.title ?? ''}
              max={LIMITS.sectionTitle}
              placeholder="Categoria"
              onChange={(v) => onUpdateSection(si, { title: v })}
            />

            <div className="mt-2 flex flex-col gap-2">
              {s.rows.map((r, ri) => {
                const rowTitle = r.title ?? '';
                const rowTitleError = rowTitle.trim().length === 0 ? 'Titulo obrigatorio' : undefined;
                return (
                  <div key={ri} className="rounded-md border border-border-2 bg-surface-2 p-2">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-text-low">
                        Item {ri + 1}
                      </span>
                      <button
                        type="button"
                        aria-label="Remover item"
                        onClick={() => onRemoveRow(si, ri)}
                        className="rounded-sm p-1 text-text-low transition-colors hover:text-danger focus:text-danger focus:shadow-glow-sm focus:outline-none"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <LimitedTextField
                        label="Titulo"
                        value={rowTitle}
                        max={LIMITS.rowTitle}
                        error={rowTitleError}
                        placeholder="Nome do item"
                        onChange={(v) => onUpdateRow(si, ri, { title: v })}
                      />
                      <LimitedTextField
                        label="Descricao (opcional)"
                        value={r.description ?? ''}
                        max={LIMITS.rowDescription}
                        placeholder="Detalhe curto"
                        onChange={(v) => onUpdateRow(si, ri, { description: v })}
                      />
                    </div>
                  </div>
                );
              })}

              <AddChip
                icon={Plus}
                label="Item"
                disabled={rowsFull}
                title={rowsFull ? `Maximo ${LIMITS.rowsTotalMax} itens no total` : undefined}
                onClick={() => onAddRow(si)}
              />
            </div>
          </div>
        ))}
      </div>

      <AddChip
        icon={ListIcon}
        label="Secao"
        disabled={sectionsFull}
        title={sectionsFull ? `Maximo ${LIMITS.sectionsMax} secoes` : undefined}
        onClick={onAddSection}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold text-text">{title}</span>
      {hint && <span className="text-[11px] text-text-low">{hint}</span>}
    </div>
  );
}

function ItemControls({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const iconBtn =
    'rounded-sm p-1 text-text-low transition-colors hover:text-text focus:text-text focus:shadow-glow-sm focus:outline-none disabled:opacity-40 disabled:hover:text-text-low';
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label="Mover para cima"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        className={iconBtn}
      >
        <ChevronUp className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Mover para baixo"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        className={iconBtn}
      >
        <ChevronDown className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Remover"
        onClick={onRemove}
        className="rounded-sm p-1 text-text-low transition-colors hover:text-danger focus:text-danger focus:shadow-glow-sm focus:outline-none"
      >
        <Trash2 className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function AddChip({
  icon: Icon,
  label,
  disabled,
  title,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border border-border-2 bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-mid transition-colors',
        'hover:border-accent hover:text-text focus:border-accent focus:shadow-glow-sm focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-2 disabled:hover:text-text-mid',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// WYSIWYG preview
// ---------------------------------------------------------------------------
function Preview({
  kind,
  header,
  body,
  footer,
  buttons,
  buttonLabel,
  sections,
}: {
  kind: 'buttons' | 'list';
  header: string;
  body: string;
  footer: string;
  buttons: InteractiveButton[];
  buttonLabel: string;
  sections: ListSection[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Previa" />
      <div className="rounded-lg border border-border-2 bg-surface-3 p-3">
        <div className="max-w-[260px] rounded-lg rounded-tl-sm bg-surface-1 px-3 py-2.5 shadow-sm">
          {header.trim() && <p className="mb-1 text-sm font-semibold text-text">{header}</p>}
          <p className="whitespace-pre-wrap break-words text-sm text-text-mid">
            {body.trim() || 'Corpo da mensagem…'}
          </p>
          {footer.trim() && <p className="mt-1 text-[11px] text-text-low">{footer}</p>}

          {kind === 'buttons' ? (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-border-2 pt-2">
              {buttons.length === 0 && (
                <span className="text-center text-[11px] text-text-low">Sem botoes</span>
              )}
              {buttons.map((b, i) => {
                const Icon = BUTTON_META[b.type].icon;
                return (
                  <div
                    key={i}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-border-2 px-2 py-1.5 text-[13px] font-medium text-text"
                  >
                    <Icon className="size-3.5" aria-hidden />
                    <span className="truncate">{b.title?.trim() || 'Botao'}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-2 border-t border-border-2 pt-2">
              <div className="flex items-center justify-center gap-1.5 rounded-md border border-border-2 px-2 py-1.5 text-[13px] font-medium text-text">
                <ListIcon className="size-3.5" aria-hidden />
                <span className="truncate">{buttonLabel.trim() || 'Ver opcoes'}</span>
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {sections.length === 0 && (
                  <span className="text-center text-[11px] text-text-low">Sem secoes</span>
                )}
                {sections.map((s, si) => (
                  <div key={si} className="flex flex-col gap-1">
                    {s.title?.trim() && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-low">
                        {s.title}
                      </span>
                    )}
                    {s.rows.map((r, ri) => (
                      <div key={ri} className="rounded-sm bg-surface-2 px-2 py-1.5">
                        <p className="truncate text-[13px] text-text">{r.title?.trim() || 'Item'}</p>
                        {r.description?.trim() && (
                          <p className="truncate text-[11px] text-text-low">{r.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
