'use client';

import { useState } from 'react';
import { ArrowLeft, Check, Instagram, RefreshCw } from 'lucide-react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/cn';
import { PROVIDER_META, PROVIDER_ORDER } from '../constants';
import { isFbSdkAvailable, startFbLogin } from '../fb-login';
import { useConnectChannel, useConnectInstagram, useListInstagramAccounts } from '../queries';
import type { ChannelProvider, ConnectChannelInput, IgAccountCandidate } from '../types';

type Step = 'provider' | 'connect';

export interface ConnectWizardProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Assistente de conexão multi-step num único painel (UX §2.3 — wizard em Modal,
 * sem modais aninhados). Passo 1: escolher provider. Passo 2: conectar.
 *
 * Meta (WhatsApp/IG): botão de login da Meta (seam `fb-login`, hoje stub) com
 * fallback para entrada manual. Os passos específicos de Instagram (seleção de
 * conta/página) estão STUBADOS — ver TODO no passo de conexão.
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

      {provider === 'meta_whatsapp' && (
        <MetaWhatsAppForm submitting={connect.isPending} onSubmit={submit} />
      )}
      {provider === 'meta_instagram' && (
        <MetaInstagramForm submitting={connect.isPending} onSubmit={submit} onDone={onDone} />
      )}
      {provider === 'waha' && <WahaForm submitting={connect.isPending} onSubmit={submit} />}
    </div>
  );
}

/** Botão de login da Meta + fallback manual. Hoje o SDK é stub → só manual. */
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

function MetaWhatsAppForm({
  submitting,
  onSubmit,
}: {
  submitting: boolean;
  onSubmit: (input: ConnectChannelInput) => void;
}) {
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');

  const valid =
    name.trim() && phoneNumberId.trim() && wabaId.trim() && accessToken.trim();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit({
          provider: 'meta_whatsapp',
          name: name.trim(),
          phoneNumber: phoneNumber.trim() || undefined,
          phoneNumberId: phoneNumberId.trim(),
          wabaId: wabaId.trim(),
          accessToken: accessToken.trim(),
        });
      }}
    >
      <MetaLoginNotice provider="meta_whatsapp" onCredentials={setAccessToken} />
      <Input label="Nome do canal" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input
        label="Telefone (opcional)"
        value={phoneNumber}
        onChange={(e) => setPhoneNumber(e.target.value)}
      />
      <Input
        label="Phone Number ID"
        value={phoneNumberId}
        onChange={(e) => setPhoneNumberId(e.target.value)}
        required
      />
      <Input label="WABA ID" value={wabaId} onChange={(e) => setWabaId(e.target.value)} required />
      <Input
        label="Token de acesso"
        type="password"
        value={accessToken}
        onChange={(e) => setAccessToken(e.target.value)}
        hint="Cifrado no servidor; nunca exibido novamente."
        required
      />
      <SubmitRow submitting={submitting} disabled={!valid} />
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
