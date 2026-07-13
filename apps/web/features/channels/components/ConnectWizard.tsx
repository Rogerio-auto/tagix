'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Instagram,
  KeyRound,
  MessageSquarePlus,
  RefreshCw,
  Repeat2,
} from 'lucide-react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/cn';
import { PROVIDER_META, PROVIDER_ORDER } from '../constants';
import { startFbLogin, startWhatsAppSignup, type WaConnectMode, type WaSignupResult } from '../fb-login';
import {
  useConnectChannel,
  useConnectInstagram,
  useConnectWhatsApp,
  useListInstagramAccounts,
} from '../queries';
import {
  describeSignupFailure,
  getMetaSignupConfig,
  type MetaSignupConfig,
  type SignupFailureCopy,
} from '../signup-status';
import type {
  ChannelProvider,
  ConnectChannelInput,
  IgAccountCandidate,
  WaConnectInput,
} from '../types';
import { InlineNotice } from './InlineNotice';
import { MetaSignupUnavailable } from './MetaSignupUnavailable';

type Step = 'provider' | 'connect';

/**
 * Depois deste tempo em "conectando", oferecemos a saída manual SEM matar o popup
 * da Meta (que pode estar vivo em outra aba). O usuário nunca fica refém do
 * spinner — a lição do UX-12.
 */
const SLOW_SIGNUP_HINT_MS = 15_000;

export interface ConnectWizardProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Assistente de conexão multi-step num único painel (UX §2.3 — wizard em Modal,
 * sem modais aninhados). Passo 1: escolher provider. Passo 2: conectar.
 *
 * Meta (WhatsApp/IG): Embedded Signup real via `fb-login`. Quando o app da Meta
 * NÃO está configurado no build, o wizard não finge que dá: mostra o estado
 * indisponível com saídas reais (suporte / WAHA / token permanente) em vez de um
 * formulário impossível (F56-S05 — UX-01).
 * WAHA: identificador da sessão + chave de API.
 */
export function ConnectWizard({ open, onClose }: ConnectWizardProps) {
  const [step, setStep] = useState<Step>('provider');
  const [provider, setProvider] = useState<ChannelProvider | null>(null);

  const reset = () => {
    setStep('provider');
    setProvider(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const title =
    step === 'provider'
      ? 'Conectar canal'
      : `Conectar ${provider ? PROVIDER_META[provider].label : 'canal'}`;

  return (
    <Modal open={open} onClose={handleClose} title={title} className="max-w-lg">
      {step === 'provider' && (
        <ProviderStep
          onPick={(p) => {
            setProvider(p);
            setStep('connect');
          }}
        />
      )}
      {step === 'connect' && provider && (
        <ConnectStep
          provider={provider}
          onBack={() => setStep('provider')}
          onSwitchProvider={(p) => setProvider(p)}
          onDone={handleClose}
        />
      )}
    </Modal>
  );
}

function ProviderStep({ onPick }: { onPick: (p: ChannelProvider) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="mb-1 font-body text-sm text-text-mid">Escolha o tipo de canal para conectar.</p>
      {PROVIDER_ORDER.map((p) => {
        const meta = PROVIDER_META[p];
        const Icon = meta.icon;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className={cn(
              'flex items-center gap-3 rounded-md border border-border bg-surface-inset px-4 py-3 text-left outline-none',
              'transition-colors duration-200 hover:border-border-2 hover:bg-surface-2 focus-visible:shadow-glow-md',
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-text-mid">
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-head text-sm font-semibold text-text">{meta.label}</span>
              <span className="block font-body text-xs text-text-low">{meta.blurb}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ConnectStep({
  provider,
  onBack,
  onSwitchProvider,
  onDone,
}: {
  provider: ChannelProvider;
  onBack: () => void;
  onSwitchProvider: (p: ChannelProvider) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const connect = useConnectChannel();

  const submit = async (input: ConnectChannelInput) => {
    try {
      await connect.mutateAsync(input);
      toast({ variant: 'success', title: 'Canal conectado', description: input.name });
      onDone();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      const ref = err instanceof ApiError ? err.ref : undefined;
      toast({
        variant: 'error',
        title: 'Falha ao conectar',
        description: ref ? `${message} (ref ${ref})` : message,
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 self-start rounded-sm px-1 py-0.5 font-head text-xs text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Trocar tipo
      </button>

      {provider === 'meta_whatsapp' && (
        <MetaWhatsAppFlow
          onDone={onDone}
          onSwitchProvider={onSwitchProvider}
          onSubmitToken={submit}
          tokenSubmitting={connect.isPending}
        />
      )}
      {provider === 'meta_instagram' && (
        <MetaInstagramForm
          submitting={connect.isPending}
          onSubmit={submit}
          onSwitchProvider={onSwitchProvider}
          onDone={onDone}
        />
      )}
      {provider === 'waha' && <WahaForm submitting={connect.isPending} onSubmit={submit} />}
    </div>
  );
}

/** Modos de conexão do WhatsApp oficial (Embedded Signup server-side, F39). */
interface WaModeMeta {
  mode: WaConnectMode;
  label: string;
  blurb: string;
  icon: typeof MessageSquarePlus;
}

const WA_MODES: readonly WaModeMeta[] = [
  {
    mode: 'cloud_api',
    label: 'Número novo (Cloud API)',
    blurb: 'Registre um número que ainda não está em nenhum app WhatsApp. Pronto na hora.',
    icon: MessageSquarePlus,
  },
  {
    mode: 'coexistence',
    label: 'Coexistência',
    blurb: 'Mantenha o número que já usa no app WhatsApp Business e atenda também por aqui.',
    icon: Repeat2,
  },
];

type WaStep = 'mode' | 'signup' | 'finish';

/**
 * Fluxo WhatsApp server-side (Embedded Signup — INSTAGRAM.md §12.1):
 *   1. Escolher modo (Cloud API novo número × coexistência).
 *   2. Embedded Signup (FB Login) → captura code/phoneNumberId/wabaId; qualquer
 *      falha (cancelamento, popup bloqueado, ids ausentes) ABRE os campos manuais
 *      com um aviso que diz o que fazer (F56-S05 — UX-12).
 *   3. Nome do canal → POST /api/channels/whatsapp/connect.
 *
 * Sem app da Meta configurado no build, o fluxo inteiro é substituído pelo estado
 * indisponível (UX-01): o `code` não é obtenível, então não é pedido.
 */
function MetaWhatsAppFlow({
  onDone,
  onSwitchProvider,
  onSubmitToken,
  tokenSubmitting,
}: {
  onDone: () => void;
  onSwitchProvider: (p: ChannelProvider) => void;
  onSubmitToken: (input: ConnectChannelInput) => void | Promise<void>;
  tokenSubmitting: boolean;
}) {
  const { toast } = useToast();
  const connect = useConnectWhatsApp();
  const config = getMetaSignupConfig();

  const [step, setStep] = useState<WaStep>('mode');
  const [mode, setMode] = useState<WaConnectMode>('cloud_api');
  const [signup, setSignup] = useState<WaSignupResult | null>(null);

  const submit = async (input: WaConnectInput) => {
    try {
      const res = await connect.mutateAsync(input);
      toast({
        variant: 'success',
        title: 'WhatsApp conectado',
        description:
          input.mode === 'coexistence'
            ? 'Canal ativo. O histórico do app pode levar alguns minutos para sincronizar.'
            : (res.channel.name ?? input.name),
      });
      onDone();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      const ref = err instanceof ApiError ? err.ref : undefined;
      const code = err instanceof ApiError && err.status === 503 ? err.message : undefined;
      toast({
        variant: 'error',
        title: 'Falha ao conectar o WhatsApp',
        description: code ?? (ref ? `${message} (ref ${ref})` : message),
      });
    }
  };

  if (!config.configured) {
    return (
      <WaUnavailableStep
        config={config}
        submitting={tokenSubmitting}
        onSwitchProvider={onSwitchProvider}
        onSubmit={onSubmitToken}
      />
    );
  }

  if (step === 'mode') {
    return <WaModeStep selected={mode} onSelect={setMode} onNext={() => setStep('signup')} />;
  }

  if (step === 'signup') {
    return (
      <WaSignupStep
        mode={mode}
        onBack={() => setStep('mode')}
        onCaptured={(result) => {
          setSignup(result);
          setStep('finish');
        }}
      />
    );
  }

  return (
    <WaFinishStep
      mode={mode}
      signup={signup}
      submitting={connect.isPending}
      onBack={() => setStep('signup')}
      onSubmit={(input) => void submit(input)}
    />
  );
}

/**
 * WhatsApp sem app da Meta configurado (UX-01). Nada de `authorization code` — ele
 * só existe como saída do popup que este ambiente não consegue abrir. Duas saídas
 * de verdade no aviso (suporte / WAHA) e, para quem opera a conta na Meta, o
 * caminho avançado com **token permanente** (System User), que é obtenível no
 * painel e usa o mesmo `POST /api/channels/connect` do Instagram manual.
 */
function WaUnavailableStep({
  config,
  submitting,
  onSwitchProvider,
  onSubmit,
}: {
  config: MetaSignupConfig;
  submitting: boolean;
  onSwitchProvider: (p: ChannelProvider) => void;
  onSubmit: (input: ConnectChannelInput) => void | Promise<void>;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [name, setName] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  const valid =
    name.trim() !== '' &&
    phoneNumberId.trim() !== '' &&
    wabaId.trim() !== '' &&
    accessToken.trim() !== '';

  return (
    <div className="flex flex-col gap-3">
      <MetaSignupUnavailable config={config} onSwitchProvider={onSwitchProvider} />

      {!advancedOpen ? (
        <button
          type="button"
          onClick={() => setAdvancedOpen(true)}
          className="inline-flex items-center gap-1.5 self-start rounded-sm px-1 py-0.5 font-head text-xs text-text-low outline-none transition-colors duration-200 hover:text-text focus-visible:shadow-glow-md"
        >
          <KeyRound className="size-3.5" aria-hidden />
          Tenho um token permanente da Meta
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            void onSubmit({
              provider: 'meta_whatsapp',
              name: name.trim(),
              phoneNumberId: phoneNumberId.trim(),
              wabaId: wabaId.trim(),
              accessToken: accessToken.trim(),
              ...(phoneNumber.trim() ? { phoneNumber: phoneNumber.trim() } : {}),
            });
          }}
        >
          <InlineNotice tone="info">
            Use um <span className="text-text-mid">token de System User</span> da sua conta
            comercial (Meta Business → Usuários do sistema → Gerar token) com acesso ao número. Ao
            contrário do código do Embedded Signup, esse token é obtenível no painel e não expira em
            segundos.
          </InlineNotice>
          <Input label="Nome do canal" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input
            label="Phone Number ID"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            required
          />
          <Input label="WABA ID" value={wabaId} onChange={(e) => setWabaId(e.target.value)} required />
          <Input
            label="Token de acesso permanente"
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            hint="Cifrado no servidor; nunca exibido de volta."
            required
          />
          <Input
            label="Telefone (opcional)"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
          />
          <SubmitRow submitting={submitting} disabled={!valid} />
        </form>
      )}
    </div>
  );
}

/** Passo 1: escolher o modo de conexão (Cloud API × coexistência). */
function WaModeStep({
  selected,
  onSelect,
  onNext,
}: {
  selected: WaConnectMode;
  onSelect: (m: WaConnectMode) => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="font-body text-sm text-text-mid">Como você quer conectar o WhatsApp oficial?</p>
      <div className="flex flex-col gap-2">
        {WA_MODES.map((m) => {
          const Icon = m.icon;
          const active = selected === m.mode;
          return (
            <button
              key={m.mode}
              type="button"
              onClick={() => onSelect(m.mode)}
              aria-pressed={active}
              className={cn(
                'flex items-center gap-3 rounded-md border px-4 py-3 text-left outline-none transition-colors duration-200',
                active
                  ? 'border-accent bg-surface-2'
                  : 'border-border bg-surface-inset hover:border-border-2 hover:bg-surface-2',
                'focus-visible:shadow-glow-md',
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-text-mid">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block font-head text-sm font-semibold text-text">{m.label}</span>
                <span className="block font-body text-xs text-text-low">{m.blurb}</span>
              </span>
              {active && <Check className="ml-auto size-4 text-accent" aria-hidden />}
            </button>
          );
        })}
      </div>

      {selected === 'coexistence' && (
        <InlineNotice tone="info">
          As mensagens que você enviar pelo app WhatsApp Business continuam funcionando e também
          aparecem aqui no inbox. O histórico já existente pode levar alguns minutos para
          sincronizar.
        </InlineNotice>
      )}

      <div className="mt-1 flex justify-end">
        <Button type="button" variant="primary" onClick={onNext}>
          Continuar
        </Button>
      </div>
    </div>
  );
}

/**
 * Passo 2: Embedded Signup (FB Login). O caminho feliz é 1 clique; o caminho
 * infeliz **nunca prende o usuário**:
 *   - falha/cancelamento/timeout → aviso ancorado (o quê / por quê / o que fazer)
 *     + campos manuais JÁ ABERTOS + botão de tentar de novo (UX-12);
 *   - demora > 15s → oferta explícita de inserir manualmente, sem matar o popup.
 */
function WaSignupStep({
  mode,
  onBack,
  onCaptured,
}: {
  mode: WaConnectMode;
  onBack: () => void;
  onCaptured: (result: WaSignupResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [failure, setFailure] = useState<SignupFailureCopy | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const [code, setCode] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  const manualRef = useRef<HTMLFormElement | null>(null);

  // Dica de lentidão só enquanto o popup está aberto (limpa ao sair do estado).
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), SLOW_SIGNUP_HINT_MS);
    return () => clearTimeout(t);
  }, [loading]);

  // O aviso e os campos manuais aparecem juntos: a mensagem aponta para algo que
  // já está na tela (UX §2.11 — nunca "informe abaixo" sem o "abaixo" existir).
  useEffect(() => {
    if (failure?.canFallbackManual && manualRef.current) {
      manualRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [failure]);

  const onSignup = async () => {
    setFailure(null);
    setLoading(true);
    try {
      const result = await startWhatsAppSignup(mode);
      onCaptured(result);
    } catch (err) {
      const copy = describeSignupFailure(err);
      if (copy.canFallbackManual) setManualOpen(true);
      setFailure(copy);
    } finally {
      setLoading(false);
    }
  };

  const manualValid = code.trim() !== '' && phoneNumberId.trim() !== '' && wabaId.trim() !== '';
  const ctaLabel = mode === 'coexistence' ? 'Conectar número existente' : 'Conectar com a Meta';

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 self-start rounded-sm px-1 py-0.5 font-head text-xs text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Trocar modo
      </button>

      <div className="rounded-md border border-border bg-surface-inset px-4 py-3">
        <Button variant="primary" size="sm" loading={loading} onClick={() => void onSignup()}>
          {failure?.canRetry ? 'Tentar de novo' : ctaLabel}
        </Button>
        <p className="mt-2 font-body text-xs text-text-low">
          Conclua o Embedded Signup na janela da Meta — vamos capturar o número e a conta
          automaticamente.
        </p>
        {loading && slow && (
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-sm px-1 py-0.5 font-head text-xs text-text-mid underline-offset-2 outline-none hover:text-text hover:underline focus-visible:shadow-glow-md"
          >
            A janela da Meta não abriu? Inserir os dados manualmente
          </button>
        )}
      </div>

      {failure && (
        <InlineNotice
          tone="danger"
          title={failure.title}
          actions={
            failure.canRetry ? (
              <Button
                variant="secondary"
                size="sm"
                loading={loading}
                leftIcon={<RefreshCw className="size-3.5" aria-hidden />}
                onClick={() => void onSignup()}
              >
                Tentar de novo
              </Button>
            ) : undefined
          }
        >
          <p>{failure.why}</p>
          <p className="mt-1 text-text-mid">{failure.whatToDo}</p>
        </InlineNotice>
      )}

      {!manualOpen && (
        <button
          type="button"
          onClick={() => setManualOpen(true)}
          className="self-start rounded-sm px-1 py-0.5 font-head text-xs text-text-low underline-offset-2 outline-none hover:text-text hover:underline focus-visible:shadow-glow-md"
        >
          Inserir manualmente
        </button>
      )}

      {manualOpen && (
        <form
          ref={manualRef}
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!manualValid) return;
            onCaptured({
              code: code.trim(),
              phoneNumberId: phoneNumberId.trim(),
              wabaId: wabaId.trim(),
              phoneNumber: phoneNumber.trim() || undefined,
            });
          }}
        >
          <Input
            label="Authorization code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            hint="Sai da janela da Meta e vale por poucos minutos — cole logo após gerá-lo. É trocado por um token no servidor e nunca exibido de volta."
            required
          />
          <Input
            label="Phone Number ID"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            required
          />
          <Input label="WABA ID" value={wabaId} onChange={(e) => setWabaId(e.target.value)} required />
          <Input
            label="Telefone (opcional)"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
          />
          <div className="mt-1 flex justify-end">
            <Button type="submit" variant="primary" disabled={!manualValid}>
              Continuar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Passo 3: nome do canal (interno) → connect server-side. Sem PIN (a Meta não usa
 *  register/PIN nesses fluxos — ver `whatsapp-connect.ts`). */
function WaFinishStep({
  mode,
  signup,
  submitting,
  onBack,
  onSubmit,
}: {
  mode: WaConnectMode;
  signup: WaSignupResult | null;
  submitting: boolean;
  onBack: () => void;
  onSubmit: (input: WaConnectInput) => void;
}) {
  const [name, setName] = useState('');

  // Sem PIN em nenhum modo: a Meta rejeita /register para coexistência (SMB) e o
  // número novo é provisionado pelo próprio Embedded Signup. Só o nome (interno).
  const valid = signup !== null && name.trim() !== '';

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!signup || !valid) return;
        onSubmit({
          code: signup.code,
          phoneNumberId: signup.phoneNumberId,
          wabaId: signup.wabaId,
          phoneNumber: signup.phoneNumber,
          mode,
          name: name.trim(),
        });
      }}
    >
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 self-start rounded-sm px-1 py-0.5 font-head text-xs text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Voltar
      </button>

      {signup?.phoneNumber && (
        <p className="rounded-md border border-border-2 bg-surface-inset px-3 py-2 font-body text-xs text-text-low">
          Número selecionado:{' '}
          <span className="font-medium text-text-mid">{signup.phoneNumber}</span>
        </p>
      )}

      <Input label="Nome do canal" value={name} onChange={(e) => setName(e.target.value)} required />
      {mode === 'coexistence' && (
        <InlineNotice tone="info">
          Após conectar, as mensagens enviadas pelo app WhatsApp Business passam a aparecer no
          inbox. A sincronização do histórico pode levar alguns minutos.
        </InlineNotice>
      )}

      <div className="mt-1 flex justify-end">
        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          disabled={!valid}
          leftIcon={<Check className="size-4" aria-hidden />}
        >
          Conectar WhatsApp
        </Button>
      </div>
    </form>
  );
}

/**
 * Fluxo Instagram (Embedded Signup — INSTAGRAM.md 12.1): login Meta → lista
 * Page+IGBA → seleciona conta → conecta (subscribe webhook + cria canal +
 * mensagem de teste).
 *
 * Sem app da Meta configurado, o login não abre — mas, diferente do WhatsApp, o
 * caminho manual do IG é **completável** (ids da Página + token do painel), então
 * ele continua disponível, com o aviso explicando por que o botão sumiu (UX-01).
 */
function MetaInstagramForm({
  submitting,
  onSubmit,
  onSwitchProvider,
  onDone,
}: {
  submitting: boolean;
  onSubmit: (input: ConnectChannelInput) => void;
  onSwitchProvider: (p: ChannelProvider) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const listAccounts = useListInstagramAccounts();
  const connectIg = useConnectInstagram();
  const config = getMetaSignupConfig();

  const [accounts, setAccounts] = useState<IgAccountCandidate[] | null>(null);
  const [selected, setSelected] = useState<IgAccountCandidate | null>(null);
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<SignupFailureCopy | null>(null);

  const [igUsername, setIgUsername] = useState('');
  const [igUserId, setIgUserId] = useState('');
  const [fbPageId, setFbPageId] = useState('');
  const [accessToken, setAccessToken] = useState('');

  const handleToken = async (token: string) => {
    try {
      const res = await listAccounts.mutateAsync({ userAccessToken: token });
      setAccounts(res.accounts);
      if (res.accounts.length === 0) {
        toast({
          variant: 'error',
          title: 'Nenhuma conta elegível',
          description: 'Vincule uma conta Instagram Business ou Creator a uma Página do Facebook.',
        });
      }
    } catch {
      toast({
        variant: 'error',
        title: 'Falha ao listar contas',
        description: 'Não foi possível consultar suas Páginas na Meta. Use os campos abaixo.',
      });
    }
  };

  const connectSelected = async () => {
    if (!selected || !name.trim()) return;
    try {
      const res = await connectIg.mutateAsync({
        name: name.trim(),
        pageId: selected.pageId,
        pageAccessToken: selected.pageAccessToken,
        igUserId: selected.igUserId,
        igUsername: selected.igUsername,
        igAccountType: selected.igAccountType,
      });
      toast({
        variant: 'success',
        title: 'Instagram conectado',
        description: res.testMessageSent
          ? 'Canal ativo e mensagem de teste enviada.'
          : 'Canal ativo.',
      });
      onDone();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha ao conectar Instagram', description: message });
    }
  };

  if (accounts !== null && accounts.length > 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-body text-sm text-text-mid">
          Selecione a conta do Instagram que deseja conectar.
        </p>
        <div className="flex flex-col gap-2">
          {accounts.map((acc) => {
            const active = selected?.igUserId === acc.igUserId;
            return (
              <button
                key={acc.igUserId}
                type="button"
                onClick={() => {
                  setSelected(acc);
                  if (!name.trim()) {
                    setName(acc.igUsername ? '@' + acc.igUsername : (acc.pageName ?? ''));
                  }
                }}
                className={cn(
                  'flex items-center gap-3 rounded-md border px-4 py-3 text-left outline-none transition-colors duration-200',
                  active
                    ? 'border-accent bg-surface-2'
                    : 'border-border bg-surface-inset hover:border-border-2 hover:bg-surface-2',
                  'focus-visible:shadow-glow-md',
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-text-mid">
                  <Instagram className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-head text-sm font-semibold text-text">
                    {acc.igUsername ? '@' + acc.igUsername : acc.igUserId}
                  </span>
                  <span className="block font-body text-xs text-text-low">
                    {acc.pageName ?? 'Página do Facebook'}
                    {acc.igAccountType ? ' - ' + acc.igAccountType : ''}
                  </span>
                </span>
                {active && <Check className="ml-auto size-4 text-accent" aria-hidden />}
              </button>
            );
          })}
        </div>
        {selected && (
          <Input
            label="Nome do canal"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <div className="mt-1 flex justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw className="size-3.5" aria-hidden />}
            onClick={() => {
              setAccounts(null);
              setSelected(null);
            }}
          >
            Recomeçar
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={connectIg.isPending}
            disabled={!selected || !name.trim()}
            leftIcon={<Check className="size-4" aria-hidden />}
            onClick={() => void connectSelected()}
          >
            Conectar e testar
          </Button>
        </div>
      </div>
    );
  }

  const valid =
    name.trim() !== '' && igUserId.trim() !== '' && fbPageId.trim() !== '' && accessToken.trim() !== '';

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({
          provider: 'meta_instagram',
          name: name.trim(),
          igUsername: igUsername.trim() || undefined,
          igUserId: igUserId.trim(),
          fbPageId: fbPageId.trim(),
          accessToken: accessToken.trim(),
        });
      }}
    >
      {config.configured ? (
        <MetaLoginNotice
          failure={failure}
          busy={listAccounts.isPending}
          onFailure={setFailure}
          onCredentials={(token) => void handleToken(token)}
        />
      ) : (
        <MetaSignupUnavailable config={config} onSwitchProvider={onSwitchProvider} />
      )}

      <InlineNotice tone="info">
        {config.configured
          ? 'Após entrar com a Meta, escolha a Página e a conta Instagram Business/Creator vinculada. Prefere fazer à mão? Informe os identificadores abaixo.'
          : 'Sem o login da Meta, informe abaixo os identificadores da Página e um token de acesso — ambos obtidos no painel da Meta (Business → Páginas / Usuários do sistema).'}
      </InlineNotice>

      <Input label="Nome do canal" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input
        label="@usuário (opcional)"
        value={igUsername}
        onChange={(e) => setIgUsername(e.target.value)}
      />
      <Input
        label="IG User ID"
        value={igUserId}
        onChange={(e) => setIgUserId(e.target.value)}
        required
      />
      <Input
        label="Facebook Page ID"
        value={fbPageId}
        onChange={(e) => setFbPageId(e.target.value)}
        required
      />
      <Input
        label="Token de acesso"
        type="password"
        value={accessToken}
        onChange={(e) => setAccessToken(e.target.value)}
        hint="Cifrado no servidor; nunca exibido novamente."
        required
      />
      <SubmitRow submitting={submitting || listAccounts.isPending} disabled={!valid} />
    </form>
  );
}

/**
 * Botão de login da Meta (Instagram). Falha de popup/cancelamento vira aviso
 * ancorado com "tentar de novo" — antes, a rejeição da Promise não era tratada e
 * o usuário não recebia sinal nenhum.
 */
function MetaLoginNotice({
  failure,
  busy,
  onFailure,
  onCredentials,
}: {
  failure: SignupFailureCopy | null;
  busy: boolean;
  onFailure: (copy: SignupFailureCopy | null) => void;
  onCredentials: (token: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  const onLogin = async () => {
    onFailure(null);
    setLoading(true);
    try {
      const result = await startFbLogin('meta_instagram');
      onCredentials(result.accessToken);
    } catch (err) {
      onFailure(describeSignupFailure(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-border bg-surface-inset px-4 py-3">
        <Button
          variant="secondary"
          size="sm"
          loading={loading || busy}
          onClick={() => void onLogin()}
        >
          {failure ? 'Tentar de novo' : 'Entrar com a Meta'}
        </Button>
        <p className="mt-2 font-body text-xs text-text-low">
          Autorize o acesso na janela da Meta para listarmos suas Páginas e contas do Instagram.
        </p>
      </div>

      {failure && (
        <InlineNotice tone="danger" title={failure.title}>
          <p>{failure.why}</p>
          <p className="mt-1 text-text-mid">{failure.whatToDo}</p>
        </InlineNotice>
      )}
    </div>
  );
}

function WahaForm({
  submitting,
  onSubmit,
}: {
  submitting: boolean;
  onSubmit: (input: ConnectChannelInput) => void;
}) {
  const [name, setName] = useState('');
  const [wahaSessionId, setWahaSessionId] = useState('');
  const [apiKey, setApiKey] = useState('');

  const valid = name.trim() !== '' && wahaSessionId.trim() !== '' && apiKey.trim() !== '';

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({
          provider: 'waha',
          name: name.trim(),
          wahaSessionId: wahaSessionId.trim(),
          apiKey: apiKey.trim(),
        });
      }}
    >
      <InlineNotice tone="info">
        Crie a sessão no seu servidor WAHA e leia o QR Code pelo WhatsApp. Depois informe o
        identificador da sessão e a chave de API aqui.
      </InlineNotice>
      <Input label="Nome do canal" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input
        label="ID da sessão WAHA"
        value={wahaSessionId}
        onChange={(e) => setWahaSessionId(e.target.value)}
        required
      />
      <Input
        label="Chave de API"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        hint="Cifrada no servidor; nunca exibida novamente."
        required
      />
      <SubmitRow submitting={submitting} disabled={!valid} />
    </form>
  );
}

function SubmitRow({ submitting, disabled }: { submitting: boolean; disabled: boolean }) {
  return (
    <div className="mt-1 flex justify-end">
      <Button
        type="submit"
        variant="primary"
        loading={submitting}
        disabled={disabled}
        leftIcon={<Check className="size-4" aria-hidden />}
      >
        Conectar canal
      </Button>
    </div>
  );
}
