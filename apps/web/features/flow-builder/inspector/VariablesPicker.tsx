'use client';

const KNOWN_VARS = [
  'contact.name',
  'contact.phone',
  'contact.email',
  'trigger.message',
  'conversation.status',
  'last_response',
  'webhook_response.body',
];

/** Picker de variaveis para inputs do inspector (FLOW_BUILDER secao 8/9.2). */
export function VariablesPicker({ onPick }: { onPick: (token: string) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-text-low">Variaveis</p>
      <div className="flex flex-wrap gap-1.5">
        {KNOWN_VARS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onPick(`{{${v}}}`)}
            className="rounded-pill border border-border-2 bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-low transition-colors hover:border-accent hover:text-text"
          >
            {`{{${v}}}`}
          </button>
        ))}
      </div>
    </div>
  );
}
