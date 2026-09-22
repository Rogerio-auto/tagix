import { FileText, Image, Video } from 'lucide-react';
import { previewText, safeComponents } from './format';
import type { CreateTemplateDraft, MessageTemplate } from './types';

interface PreviewContent {
  header?: string;
  media?: string;
  body: string;
  footer?: string;
  buttons: { text: string; value?: string }[];
}

function fromTemplate(template: MessageTemplate): PreviewContent {
  const components = safeComponents(template.components);
  const header = components.find((item) => item.type === 'HEADER');
  const body = components.find((item) => item.type === 'BODY');
  const footer = components.find((item) => item.type === 'FOOTER');
  const buttons = components.find((item) => item.type === 'BUTTONS');
  return {
    ...(header?.text ? { header: header.text } : {}),
    ...(header?.format && header.format !== 'TEXT' ? { media: header.format } : {}),
    body: body?.text ?? 'Conteúdo não reconhecido. Sincronize novamente para atualizar a prévia.',
    ...(footer?.text ? { footer: footer.text } : {}),
    buttons: buttons?.buttons ?? [],
  };
}

function fromDraft(draft: CreateTemplateDraft): PreviewContent {
  return {
    ...(draft.header.trim() ? { header: previewText(draft.header, [draft.headerExample]) } : {}),
    body: previewText(draft.body, draft.bodyExamples) || 'Sua mensagem aparecerá aqui.',
    ...(draft.footer.trim() ? { footer: draft.footer } : {}),
    buttons: draft.buttons.map((button) => ({
      text: button.text || 'Novo botão',
      ...(button.value ? { value: button.value } : {}),
    })),
  };
}

function MediaPlaceholder({ format }: { format: string }) {
  const normalized = format.toUpperCase();
  const Icon = normalized === 'IMAGE' ? Image : normalized === 'VIDEO' ? Video : FileText;
  const label = normalized === 'IMAGE' ? 'Imagem' : normalized === 'VIDEO' ? 'Vídeo' : 'Documento';
  return (
    <div className="flex h-32 items-center justify-center gap-2 rounded-sm bg-surface-3 text-sm text-text-low">
      <Icon className="size-5" aria-hidden />
      {label} do modelo sincronizado
    </div>
  );
}

export function TemplatePreview({ template, draft }: { template?: MessageTemplate; draft?: CreateTemplateDraft }) {
  const content = template ? fromTemplate(template) : draft ? fromDraft(draft) : null;
  if (!content) return null;
  return (
    <section aria-label="Prévia da mensagem" className="rounded-lg border border-border bg-surface-inset p-4">
      <p className="mb-3 font-head text-xs font-semibold text-text-mid">Prévia no WhatsApp</p>
      <div className="mx-auto max-w-sm rounded-md bg-surface-2 p-3 shadow-elev-1">
        {content.media ? <MediaPlaceholder format={content.media} /> : null}
        {content.header ? <p className="mt-2 whitespace-pre-wrap font-body text-sm font-semibold text-text">{content.header}</p> : null}
        <p className="mt-2 whitespace-pre-wrap break-words font-body text-sm text-text">{content.body}</p>
        {content.footer ? <p className="mt-2 whitespace-pre-wrap text-xs text-text-low">{content.footer}</p> : null}
        {content.buttons.length > 0 ? (
          <div className="mt-3 divide-y divide-border-2 border-t border-border-2">
            {content.buttons.map((button, index) => (
              <div key={`${button.text}-${index}`} className="px-2 py-2 text-center text-sm font-medium text-info">
                {button.text}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
