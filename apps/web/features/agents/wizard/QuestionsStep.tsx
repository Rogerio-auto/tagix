import { Input } from '@hm/ui';
import type { TemplateAnswerValue, TemplateQuestion } from '../types';
import { Field, Select, Textarea, Toggle } from './fields';

export interface QuestionsStepProps {
  questions: TemplateQuestion[];
  /** Respostas atuais por `question.key`. */
  values: Record<string, TemplateAnswerValue>;
  /** Erros de validação por `question.key`. */
  errors: Record<string, string>;
  onChange: (key: string, value: TemplateAnswerValue) => void;
}

/** Lê a opção de um array (options vêm como string[] ou jsonb unknown[]). */
function asString(value: TemplateAnswerValue | undefined): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function QuestionInput({
  question,
  value,
  error,
  onChange,
}: {
  question: TemplateQuestion;
  value: TemplateAnswerValue | undefined;
  error?: string;
  onChange: (value: TemplateAnswerValue) => void;
}) {
  const fieldId = `q-${question.key}`;
  const label = question.required ? `${question.label} *` : question.label;
  const options = question.options ?? [];

  switch (question.type) {
    case 'textarea':
      return (
        <Field id={fieldId} label={label} hint={question.help} error={error}>
          <Textarea
            id={fieldId}
            value={asString(value)}
            error={Boolean(error)}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );

    case 'number':
      return (
        <Input
          id={fieldId}
          label={label}
          type="number"
          hint={question.help ?? undefined}
          error={error}
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      );

    case 'boolean':
      return (
        <Field id={fieldId} label={label} hint={question.help} error={error}>
          <Toggle
            checked={value === true}
            onChange={(next) => onChange(next)}
            label={value === true ? 'Sim' : 'Não'}
          />
        </Field>
      );

    case 'select':
      return (
        <Field id={fieldId} label={label} hint={question.help} error={error}>
          <Select
            id={fieldId}
            value={asString(value)}
            error={Boolean(error)}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Selecione…</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </Select>
        </Field>
      );

    case 'multiselect': {
      const selected = Array.isArray(value) ? value : [];
      const toggle = (opt: string) => {
        onChange(
          selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt],
        );
      };
      return (
        <Field id={fieldId} label={label} hint={question.help} error={error}>
          <div className="flex flex-wrap gap-2">
            {options.map((opt) => {
              const on = selected.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(opt)}
                  className={
                    on
                      ? 'rounded-pill border border-brand bg-brand/15 px-3 py-1 font-head text-xs font-medium text-brand outline-none focus-visible:shadow-glow-md'
                      : 'rounded-pill border border-border bg-surface-inset px-3 py-1 font-head text-xs font-medium text-text-mid outline-none transition-colors duration-200 hover:border-border-2 focus-visible:shadow-glow-md'
                  }
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </Field>
      );
    }

    case 'text':
    default:
      return (
        <Input
          id={fieldId}
          label={label}
          hint={question.help ?? undefined}
          error={error}
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export function QuestionsStep({ questions, values, errors, onChange }: QuestionsStepProps) {
  if (questions.length === 0) {
    return (
      <p className="rounded-md border border-border-2 bg-surface-inset px-4 py-6 text-center font-body text-sm text-text-low">
        Este template não pede informações adicionais. Avance para escolher o modelo.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-sm text-text-mid">
        Responda para personalizar o agente ao seu negócio. Campos com * são obrigatórios.
      </p>
      {questions.map((question) => (
        <QuestionInput
          key={question.key}
          question={question}
          value={values[question.key]}
          error={errors[question.key]}
          onChange={(value) => onChange(question.key, value)}
        />
      ))}
    </div>
  );
}
