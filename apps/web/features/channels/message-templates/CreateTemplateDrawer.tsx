'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Drawer, Input, useToast } from '@hm/ui';
import { draftToInput, validateDraft, variableNumbers, type DraftErrors } from './format';
import { MessageTemplateApiError, useCreateMessageTemplate } from './queries';
import { TemplatePreview } from './TemplatePreview';
import { EMPTY_DRAFT, type CreateTemplateDraft, type MessageTemplate, type TemplateButtonDraft } from './types';

const fieldClass = 'w-full rounded-sm border border-border bg-surface-inset px-3 py-2 font-body text-sm text-text outline-none hover:border-border-2 focus:border-brand focus:shadow-glow-sm disabled:opacity-40';

function fieldIssue(errors: DraftErrors, key: keyof DraftErrors): React.ReactNode {
  return errors[key] ? <span role="alert" className="text-xs text-danger">{errors[key]}</span> : null;
}

function correctedDraft(template: MessageTemplate): CreateTemplateDraft {
  const baseName = template.name.replace(/_v\d+$/, '');
  return { ...EMPTY_DRAFT, name: `${baseName}_v2`, language: template.language, category: template.category === 'UTILITY' || template.category === 'AUTHENTICATION' ? template.category : 'MARKETING' };
}

export function CreateTemplateDrawer({
  channelId,
  channelName,
  open,
  seed,
  onClose,
}: {
  channelId: string;
  channelName: string;
  open: boolean;
  seed: MessageTemplate | null;
  onClose: () => void;
}) {
  const create = useCreateMessageTemplate(channelId);
  const { toast } = useToast();
  const [draft, setDraft] = useState<CreateTemplateDraft>(EMPTY_DRAFT);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<DraftErrors>({});
  const errors = useMemo(() => ({ ...(submitted ? validateDraft(draft) : {}), ...serverErrors }), [draft, serverErrors, submitted]);
  const bodyVariables = variableNumbers(draft.body);

  useEffect(() => {
    if (!open) return;
    setDraft(seed ? correctedDraft(seed) : EMPTY_DRAFT);
    setSubmitted(false);
    setServerErrors({});
  }, [open, seed]);

  function patch(value: Partial<CreateTemplateDraft>): void {
    setDraft((current) => ({ ...current, ...value }));
    setServerErrors({});
  }

  function updateButton(id: string, value: Partial<TemplateButtonDraft>): void {
    patch({ buttons: draft.buttons.map((button) => button.id === id ? { ...button, ...value } : button) });
  }

  function addButton(): void {
    if (draft.buttons.length >= 3) return;
    patch({ buttons: [...draft.buttons, { id: crypto.randomUUID(), type: 'QUICK_REPLY', text: '', value: '', example: '' }] });
  }

  async function submit(): Promise<void> {
    setSubmitted(true);
    const clientErrors = validateDraft(draft);
    if (Object.keys(clientErrors).length > 0) return;
    try {
      await create.mutateAsync(draftToInput(draft));
      toast({ variant: 'success', title: 'Modelo enviado para análise', description: 'A aprovação depende da Meta. Sincronize para acompanhar o status.' });
      onClose();
    } catch (error) {
      if (error instanceof MessageTemplateApiError) {
        if (error.providerAccepted) {
          toast({ variant: 'warn', title: 'Modelo aceito pela Meta', description: 'Ele não foi salvo localmente. Sincronize antes de tentar criar novamente.' });
          onClose();
          return;
        }
        const mapped: DraftErrors = {};
        for (const issue of error.issues ?? []) {
          const path = issue.path.join('.');
          if (path === 'name') mapped.name = issue.message;
          else if (path === 'language') mapped.language = issue.message;
          else if (path.includes('HEADER')) mapped.header = issue.message;
          else if (path.includes('BUTTON') || path.includes('buttons')) mapped.buttons = issue.message;
          else if (path.includes('FOOTER')) mapped.footer = issue.message;
          else mapped.body = issue.message;
        }
        setServerErrors(mapped);
        toast({ variant: 'error', title: 'Revise o modelo', description: error.message });
      } else {
        toast({ variant: 'error', title: 'Não foi possível enviar o modelo', description: 'Confira sua conexão e tente novamente.' });
      }
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={seed ? 'Criar versão corrigida' : 'Criar modelo'}
      description={`${channelName} · será enviado para análise da Meta`}
      className="sm:max-w-4xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-xs text-text-low">Nome e idioma não podem ser alterados depois do envio. Uma mudança estrutural exige um novo modelo.</p>
          <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={create.isPending} onClick={() => void submit()}>Enviar para aprovação</Button></div>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); void submit(); }} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Nome" value={draft.name} onChange={(e) => patch({ name: e.target.value.toLowerCase().replace(/\s+/g, '_') })} placeholder="lembrete_consulta" hint="Somente minúsculas, números e sublinhado." error={errors.name} />
            <Input label="Idioma" value={draft.language} onChange={(e) => patch({ language: e.target.value })} placeholder="pt_BR" error={errors.language} />
          </div>
          <label className="flex flex-col gap-1.5"><span className="font-head text-sm font-medium text-text-mid">Categoria</span><select className={fieldClass} value={draft.category} onChange={(e) => patch({ category: e.target.value as CreateTemplateDraft['category'] })}><option value="MARKETING">Marketing</option><option value="UTILITY">Serviço</option><option value="AUTHENTICATION">Autenticação</option></select></label>

          <fieldset className="flex flex-col gap-3 rounded-md border border-border-2 p-4"><legend className="px-1 font-head text-sm font-semibold text-text">Cabeçalho de texto (opcional)</legend><Input value={draft.header} maxLength={60} onChange={(e) => patch({ header: e.target.value })} placeholder="Olá, {{1}}" error={errors.header} hint={`${draft.header.length}/60 caracteres`} />{variableNumbers(draft.header).length > 0 ? <Input label="Exemplo de {{1}}" value={draft.headerExample} onChange={(e) => patch({ headerExample: e.target.value })} placeholder="Marina" error={errors.headerExample} /> : null}<p className="text-xs text-text-low">Mídia aparece na prévia de modelos sincronizados. O envio de mídia em um novo modelo não faz parte desta versão.</p></fieldset>

          <label className="flex flex-col gap-1.5"><span className="font-head text-sm font-medium text-text-mid">Mensagem</span><textarea rows={7} maxLength={1024} value={draft.body} onChange={(e) => patch({ body: e.target.value })} className={fieldClass} placeholder="Olá, {{1}}. Seu pedido {{2}} está pronto." aria-invalid={Boolean(errors.body)} />{fieldIssue(errors, 'body')}<span className="text-xs text-text-low">Use {'{{1}}'}, {'{{2}}'} em ordem · {draft.body.length}/1.024 caracteres</span></label>
          {bodyVariables.length > 0 ? <fieldset className="grid gap-3 rounded-md border border-border-2 p-4 sm:grid-cols-2"><legend className="px-1 font-head text-sm font-semibold text-text">Exemplos das variáveis</legend>{bodyVariables.map((variable, index) => <Input key={variable} label={`Exemplo de {{${variable}}}`} value={draft.bodyExamples[index] ?? ''} onChange={(e) => { const values = [...draft.bodyExamples]; values[index] = e.target.value; patch({ bodyExamples: values }); }} placeholder={index === 0 ? 'Marina' : 'ABC-123'} />)}{fieldIssue(errors, 'bodyExamples')}</fieldset> : null}

          <Input label="Rodapé (opcional)" value={draft.footer} maxLength={60} onChange={(e) => patch({ footer: e.target.value })} placeholder="Responda SAIR para não receber mensagens." hint={`${draft.footer.length}/60 caracteres`} error={errors.footer} />

          <fieldset className="flex flex-col gap-3 rounded-md border border-border-2 p-4"><div className="flex items-center justify-between gap-3"><legend className="font-head text-sm font-semibold text-text">Botões (opcional)</legend><Button variant="secondary" size="sm" leftIcon={<Plus className="size-4" aria-hidden />} disabled={draft.buttons.length >= 3} onClick={addButton}>Adicionar botão</Button></div>{draft.buttons.map((button, index) => <div key={button.id} className="grid gap-3 rounded-sm bg-surface-2 p-3 sm:grid-cols-2"><label className="flex flex-col gap-1"><span className="text-xs text-text-mid">Tipo</span><select className={fieldClass} value={button.type} onChange={(e) => updateButton(button.id, { type: e.target.value as TemplateButtonDraft['type'], value: '', example: '' })}><option value="QUICK_REPLY">Resposta rápida</option><option value="URL">Abrir site</option><option value="PHONE_NUMBER">Ligar</option></select></label><Input label={`Texto do botão ${index + 1}`} value={button.text} maxLength={25} onChange={(e) => updateButton(button.id, { text: e.target.value })} />{button.type !== 'QUICK_REPLY' ? <Input label={button.type === 'URL' ? 'URL HTTPS' : 'Telefone internacional'} value={button.value} onChange={(e) => updateButton(button.id, { value: e.target.value })} placeholder={button.type === 'URL' ? 'https://exemplo.com/pedido/{{1}}' : '+5511999999999'} /> : null}{button.type === 'URL' && button.value.includes('{{1}}') ? <Input label="Exemplo para a URL" value={button.example} onChange={(e) => updateButton(button.id, { example: e.target.value })} placeholder="ABC-123" /> : null}<Button variant="ghost" size="sm" className="justify-self-start text-danger" aria-label={`Remover botão ${index + 1}`} onClick={() => patch({ buttons: draft.buttons.filter((item) => item.id !== button.id) })}><Trash2 className="size-4" aria-hidden /> Remover</Button></div>)}{draft.buttons.length === 0 ? <p className="text-sm text-text-low">A mensagem pode ser enviada sem botões.</p> : null}{fieldIssue(errors, 'buttons')}</fieldset>
        </form>
        <div className="lg:sticky lg:top-0 lg:self-start"><TemplatePreview draft={draft} /></div>
      </div>
    </Drawer>
  );
}
