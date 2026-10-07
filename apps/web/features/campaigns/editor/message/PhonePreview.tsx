/**
 * Prévia de celular da mensagem (F58-S09).
 *
 * Regra de segurança: tudo aqui é nó de texto do React. O modelo vem da Meta,
 * o valor fixo vem do usuário, o campo do contato vem de um CSV — nenhum deles
 * vira HTML. Não há `dangerouslySetInnerHTML`, `<a href>` nem `<img src>` com
 * endereço externo: a mídia do cabeçalho aparece como marcador, e o link do
 * botão aparece como texto. Uma prévia não pode abrir nem carregar nada.
 *
 * Server-safe (sem hooks): roda no teste de renderização estática.
 */
import type * as React from 'react';
import {
  CheckCheck,
  ExternalLink,
  FileText,
  ImageIcon,
  MapPin,
  Phone,
  Reply,
  Video,
} from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import {
  parseTemplate,
  resolveButtonUrl,
  segmentText,
  styleRuns,
  type ContactSample,
  type HeaderFormat,
  type PreviewSegment,
  type TemplateBinding,
  type TemplateButton,
  type TemplateOption,
} from './model';

export interface PhonePreviewProps {
  readonly template: TemplateOption | null;
  readonly bindings: readonly TemplateBinding[];
  /** Contato de exemplo. Sem ele, entra o texto reserva de cada campo. */
  readonly contact: ContactSample | null;
  /** Nome que aparece no topo da conversa (o número/canal que envia). */
  readonly senderName: string;
  readonly className?: string;
}

function Styled({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {styleRuns(text).map((run, i) => {
        if (run.style === 'bold')
          return (
            <strong key={i} className="font-semibold">
              {run.text}
            </strong>
          );
        if (run.style === 'italic') return <em key={i}>{run.text}</em>;
        if (run.style === 'strike') return <s key={i}>{run.text}</s>;
        if (run.style === 'mono') {
          return (
            <code key={i} className="font-mono text-[0.92em]">
              {run.text}
            </code>
          );
        }
        return <span key={i}>{run.text}</span>;
      })}
    </>
  );
}

function Segments({ segments }: { segments: readonly PreviewSegment[] }): React.JSX.Element {
  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === 'text' ? (
          <Styled key={i} text={segment.text} />
        ) : (
          <mark
            key={i}
            data-variable={segment.key}
            data-missing={segment.missing ? 'true' : undefined}
            title={
              segment.missing
                ? 'Ainda sem valor'
                : segment.usedFallback
                  ? 'Texto reserva (o contato não tem este dado)'
                  : undefined
            }
            className={cn(
              'rounded-xs px-0.5 text-inherit',
              segment.missing
                ? 'bg-warn-bg text-warn outline outline-1 outline-dashed outline-warn/50'
                : 'bg-info-bg',
              segment.usedFallback &&
                !segment.missing &&
                'underline decoration-dotted underline-offset-2',
            )}
          >
            {segment.text}
          </mark>
        ),
      )}
    </>
  );
}

const MEDIA: Readonly<
  Record<Exclude<HeaderFormat, 'TEXT'>, { label: string; Icon: typeof ImageIcon }>
> = {
  IMAGE: { label: 'Imagem do modelo', Icon: ImageIcon },
  VIDEO: { label: 'Vídeo do modelo', Icon: Video },
  DOCUMENT: { label: 'Documento do modelo', Icon: FileText },
  LOCATION: { label: 'Localização', Icon: MapPin },
  UNKNOWN: { label: 'Anexo do modelo', Icon: FileText },
};

function MediaHeader({ format }: { format: Exclude<HeaderFormat, 'TEXT'> }): React.JSX.Element {
  const { label, Icon } = MEDIA[format];
  return (
    <div
      data-media={format}
      className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-sm bg-surface-3 text-text-low"
    >
      <Icon className="size-6" aria-hidden />
      <span className="text-xs">{label}</span>
    </div>
  );
}

const BUTTON_ICON: Readonly<Record<TemplateButton['kind'], typeof Reply>> = {
  QUICK_REPLY: Reply,
  URL: ExternalLink,
  PHONE_NUMBER: Phone,
  OTHER: Reply,
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase() || '·';
}

export function PhonePreview({
  template,
  bindings,
  contact,
  senderName,
  className,
}: PhonePreviewProps): React.JSX.Element {
  const parsed = template ? parseTemplate(template.components) : null;

  return (
    <figure
      aria-label="Prévia no celular de quem recebe"
      className={cn(
        'mx-auto flex w-full max-w-[20rem] flex-col overflow-hidden rounded-lg border border-border-2 bg-surface shadow-elev-2',
        className,
      )}
    >
      {/* Barra da conversa */}
      <div className="flex items-center gap-2.5 border-b border-border bg-surface-2 px-3 py-2.5">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-surface-3 font-head text-xs font-semibold text-text-mid"
        >
          {initials(senderName)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-text">{senderName}</span>
          <span className="block text-xs text-text-low">Conta comercial</span>
        </span>
      </div>

      {/* Área da conversa */}
      <div className="flex min-h-[18rem] flex-col justify-end gap-1.5 bg-surface-inset p-3">
        {!template ? (
          <p className="m-auto max-w-[14rem] text-center text-sm text-text-low">
            Escolha um modelo para ver aqui exatamente o que a pessoa vai receber.
          </p>
        ) : parsed === null ? (
          <p role="alert" className="m-auto max-w-[14rem] text-center text-sm text-danger">
            Não conseguimos ler este modelo. Sincronize os modelos e tente de novo.
          </p>
        ) : (
          <>
            <div className="max-w-[92%] self-start rounded-md rounded-tl-xs bg-surface-2 p-1.5 shadow-elev-1">
              {parsed.header && parsed.header.format !== 'TEXT' ? (
                <MediaHeader format={parsed.header.format} />
              ) : null}
              <div className="flex flex-col gap-1.5 px-1.5 pt-1">
                {parsed.header?.format === 'TEXT' && parsed.header.text ? (
                  <p className="whitespace-pre-wrap break-words text-sm font-semibold text-text">
                    <Segments
                      segments={segmentText(parsed.header.text, 'header', bindings, contact)}
                    />
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text">
                  <Segments segments={segmentText(parsed.body, 'body', bindings, contact)} />
                </p>
                {parsed.footer ? (
                  <p className="whitespace-pre-wrap break-words text-xs text-text-low">
                    {parsed.footer}
                  </p>
                ) : null}
                <span className="flex items-center justify-end gap-1 text-[0.68rem] text-text-low">
                  agora
                  <CheckCheck className="size-3.5 text-info" aria-hidden />
                </span>
              </div>
            </div>

            {parsed.buttons.length > 0 ? (
              <ul
                aria-label="Botões da mensagem"
                className="flex max-w-[92%] flex-col gap-1 self-start"
              >
                {parsed.buttons.map((button) => {
                  const Icon = BUTTON_ICON[button.kind];
                  const url = resolveButtonUrl(button, bindings, contact);
                  return (
                    <li
                      key={button.position}
                      data-button-kind={button.kind}
                      className="flex flex-col items-center gap-0.5 rounded-md bg-surface-2 px-3 py-2 shadow-elev-1"
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium text-info">
                        <Icon className="size-3.5" aria-hidden />
                        {button.text || `Botão ${button.position}`}
                      </span>
                      {url ? (
                        <span className="max-w-full truncate text-[0.68rem] text-text-low">
                          {url}
                        </span>
                      ) : button.phone ? (
                        <span className="text-[0.68rem] text-text-low">{button.phone}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        )}
      </div>
      <figcaption className="sr-only">
        Prévia ilustrativa. A aparência final depende do aparelho de quem recebe.
      </figcaption>
    </figure>
  );
}
