'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Info,
  Instagram,
  MessageSquarePlus,
  RefreshCw,
  Repeat2,
} from 'lucide-react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/cn';
import { PROVIDER_META, PROVIDER_ORDER } from '../constants';
import {
  isFbSdkAvailable,
  startFbLogin,
  startWhatsAppSignup,
  type WaConnectMode,
  type WaSignupResult,
} from '../fb-login';
import {
  useConnectChannel,
  useConnectInstagram,
  useConnectWhatsApp,
  useListInstagramAccounts,
} from '../queries';
import type {
  ChannelProvider,
  ConnectChannelInput,
  IgAccountCandidate,
  WaConnectInput,
} from '../types';

type Step = 'provider' | 'connect';

export interface ConnectWizardProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Assistente de conexão multi-step num único painel (UX §2.3 — wizard em Modal,
 * sem modais aninhados). Passo 1: escolher provider. Passo 2: conectar.
 *
 * Meta (WhatsApp/IG): botão de login da Meta (Embedded Signup real via `fb-login`)
 * com fallback para entrada manual quando as envs `NEXT_PUBLIC_META_*` não estão
 * configuradas no ambiente.
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
  onDone,
}: {
  provider: ChannelProvider;
  onBack: () => void;
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

      {provider === 'meta_whatsapp' && <MetaWhatsAppFlow onDone={onDone} />}
      {provider === 'meta_instagram' && (
        <MetaInstagramForm submitting={connect.isPending} onSubmit={submit} onDone={onDone} />
      )}
      {provider === 'waha' && <WahaForm submitting={connect.isPending} onSubmit={submit} />}
    </div>
  );
}

/** Botão de login da Meta + fallback manual (manual quando o SDK não está configurado). */
function MetaLoginNotice({
  provider,
  onCredentials,
}: {
  provider: 'meta_whatsapp' | 'meta_instagram';
  onCredentials: (token: string) => void;
}) {
  const sdkReady = isFbSdkAvailable();
  const [loading, setLoading] = useState(false);

  const onLogin = async () => {
    setLoading(true);
    try {
      const result = await startFbLogin(provider);
      onCredentials(result.accessToken);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-surface-inset px-4 py-3">
      <Button
        variant="secondary"
        size="sm"
        loading={loading}
        disabled={!sdkReady}
        onClick={() => void onLogin()}
      >
        Entrar com a Meta
      </Button>
      <p className="mt-2 font-body text-xs text-text-low">
        {sdkReady
          ? 'Autorize o acesso na janela da Meta para preencher as credenciais automaticamente.'
          : 'Login da Meta indisponível neste ambiente. Cole as credenciais manualmente abaixo (token e ids do painel da Meta).'}
      </p>
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
 *   2. Embedded Signup (FB Login) → captura code/phoneNumberId/wabaId; fallback
 *      manual quando o SDK da Meta não está disponível no ambiente.
 *   3. PIN (6 dígitos) + nome → POST /api/channels/whatsapp/connect.
 *
 * Multi-step dentro do mesmo painel do wizard (UX §2.3 — sem modal full-screen,
 * sem modal aninhado). Voltar não perde os dados já capturados (UX §2.8).
 */
function MetaWhatsAppFlow({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const connect = useConnectWhatsApp();

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

  if (step === 'mode') {
    return (
      <WaModeStep
        selected={mode}
        onSelect={setMode}
        onNext={() => setStep('signup')}
      />
    );
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
      <p className="font-body text-sm text-text-mid">
        Como você quer conectar o WhatsApp oficial?
      </p>
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
        <p className="flex gap-2 rounded-md border border-border-2 bg-surface-inset px-3 py-2 font-body text-xs text-text-low">
          <Info className="mt-0.5 size-3.5 shrink-0 text-text-mid" aria-hidden />
          <span>
            As mensagens que você enviar pelo app WhatsApp Business continuam funcionando e também
            aparecem aqui no inbox. O histórico já existente pode levar alguns minutos para
            sincronizar.
          </span>
        </p>
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
 * Passo 2: Embedded Signup (FB Login). Quando o SDK da Meta está disponível,
 * o botão dispara o Signup e captura code/ids; senão, cai no modo manual (colar
 * code + ids do painel da Meta), que é o mesmo contrato do backend.
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
  const { toast } = useToast();
  const sdkReady = isFbSdkAvailable();
  const [loading, setLoading] = useState(false);
  // Quando o Embedded Signup está disponível, a entrada manual fica recolhida
  // atrás de um link; sem SDK, ela aparece direto (único caminho possível).
  const [manualOpen, setManualOpen] = useState(!sdkReady);

  const [code, setCode] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  const onSignup = async () => {
    setLoading(true);
    try {
      const result = await startWhatsAppSignup(mode);
      onCaptured(result);
    } catch {
      toast({
        variant: 'error',
        title: 'Embedded Signup indisponível',
        description: 'Informe os dados manualmente abaixo (code e ids do painel da Meta).',
      });
    } finally {
      setLoading(false);
    }
  };

  const manualValid = code.trim() && phoneNumberId.trim() && wabaId.trim();

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

      {sdkReady && (
        <div className="rounded-md border border-border bg-surface-inset px-4 py-3">
          <Button
            variant="primary"
            size="sm"
            loading={loading}
            onClick={() => void onSignup()}
          >
            {mode === 'coexistence' ? 'Conectar número existente' : 'Conectar com a Meta'}
          </Button>
          <p className="mt-2 font-body text-xs text-text-low">
            Conclua o Embedded Signup na janela da Meta — vamos capturar o número e a conta
            automaticamente.
          </p>
        </div>
      )}

      {sdkReady && !manualOpen && (
        <button
          type="button"
          onClick={() => setManualOpen(true)}
          className="self-start rounded-sm px-1 py-0.5 font-head text-xs text-text-low underline-offset-2 outline-none hover:text-text hover:underline focus-visible:shadow-glow-md"
        >
          Inserir manualmente
        </button>
      )}

      {!sdkReady && (
        <p className="rounded-md border border-border-2 bg-surface-inset px-3 py-2 font-body text-xs text-text-low">
          Login da Meta indisponível neste ambiente. Cole abaixo o code e os ids obtidos no painel
          da Meta.
        </p>
      )}

      {manualOpen && (
      <form
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
          hint="Trocado por um token no servidor; nunca exibido de volta."
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

/** Passo 3: PIN (6 dígitos) + nome do canal → connect server-side. */
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
  const [pin, setPin] = useState('');

  const isCoexistence = mode === 'coexistence';
  const pinValid = /^\d{6}$/.test(pin);
  // Número novo (cloud_api) é provisionado pelo Embedded Signup → não pede PIN.
  const valid = signup !== null && name.trim() !== '' && (!isCoexistence || pinValid);

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
          ...(isCoexistence ? { pin } : {}),
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
          Número selecionado: <span className="font-medium text-text-mid">{signup.phoneNumber}</span>
        </p>
      )}

      <Input
        label="Nome do canal"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      {isCoexistence && (
        <Input
          label="PIN do WhatsApp (6 dígitos)"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          hint="PIN de verificação em duas etapas do número existente. Se nunca definiu, escolha um agora na Meta."
          error={pin !== '' && !pinValid ? 'O PIN precisa ter exatamente 6 dígitos.' : undefined}
          required
        />
      )}

      {mode === 'coexistence' && (
        <p className="flex gap-2 rounded-md border border-border-2 bg-surface-inset px-3 py-2 font-body text-xs text-text-low">
          <Info className="mt-0.5 size-3.5 shrink-0 text-text-mid" aria-hidden />
          <span>
            Após conectar, as mensagens enviadas pelo app WhatsApp Business passam a aparecer no
            inbox. A sincronização do histórico pode levar alguns minutos.
          </span>
        </p>
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
 * Fluxo Instagram (Embedded Signup — INSTAGRAM.md 12.1): login Meta -> lista
 * Page+IGBA -> seleciona conta -> conecta (subscribe webhook + cria canal +
 * mensagem de teste). Mantem fallback manual quando o SDK da Meta nao esta
 * disponivel no ambiente.
 */
function MetaInstagramForm({
  submitting,
  onSubmit,
  onDone,
}: {
  submitting: boolean;
  onSubmit: (input: ConnectChannelInput) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const listAccounts = useListInstagramAccounts();
  const connectIg = useConnectInstagram();

  const [accounts, setAccounts] = useState<IgAccountCandidate[] | null>(null);
  const [selected, setSelected] = useState<IgAccountCandidate | null>(null);
  const [name, setName] = useState('');

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
          title: 'Nenhuma conta elegivel',
          description: 'Vincule uma conta Instagram Business ou Creator a uma Pagina do Facebook.',
        });
      }
    } catch {
      toast({
        variant: 'error',
        title: 'Falha ao listar contas',
        description: 'Nao foi possivel consultar suas Paginas na Meta. Tente o modo manual.',
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
        description: res.testMessageSent ? 'Canal ativo e mensagem de teste enviada.' : 'Canal ativo.',
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
                    {acc.pageName ?? 'Pagina do Facebook'}
                    {acc.igAccountType ? ' - ' + acc.igAccountType : ''}
                  </span>
                </span>
                {active && <Check className="ml-auto size-4 text-accent" aria-hidden />}
              </button>
            );
          })}
        </div>
        {selected && (
          <Input label="Nome do canal" value={name} onChange={(e) => setName(e.target.value)} required />
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
            Recomecar
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

  const valid = name.trim() && igUserId.trim() && fbPageId.trim() && accessToken.trim();
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
      <MetaLoginNotice provider="meta_instagram" onCredentials={(token) => void handleToken(token)} />
      <p className="rounded-md border border-border-2 bg-surface-inset px-3 py-2 font-body text-xs text-text-low">
        Apos entrar com a Meta, escolha a Pagina e a conta Instagram Business/Creator vinculada. Sem
        login disponivel? Informe os identificadores manualmente abaixo.
      </p>
      <Input label="Nome do canal" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label="@usuario (opcional)" value={igUsername} onChange={(e) => setIgUsername(e.target.value)} />
      <Input label="IG User ID" value={igUserId} onChange={(e) => setIgUserId(e.target.value)} required />
      <Input label="Facebook Page ID" value={fbPageId} onChange={(e) => setFbPageId(e.target.value)} required />
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

  const valid = name.trim() && wahaSessionId.trim() && apiKey.trim();

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
      <p className="rounded-md border border-border-2 bg-surface-inset px-3 py-2 font-body text-xs text-text-low">
        Crie a sessão no seu servidor WAHA e leia o QR Code pelo WhatsApp. Depois informe o
        identificador da sessão e a chave de API aqui.
      </p>
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
