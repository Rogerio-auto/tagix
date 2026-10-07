import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { DeliveryStep, type DeliveryStepProps } from './DeliveryStep';
import { applyHoursPreset, emptyDeliveryStep, type DeliveryStepValue } from './model';

// JSX clássico no vitest do @hm/web (ambiente node): o React precisa ser global.
Reflect.set(globalThis, 'React', React);

// Quarta, 07/10/2026, 10:00 em Brasília.
const NOW = new Date('2026-10-07T13:00:00Z');

function render(
  patch: Partial<DeliveryStepValue> = {},
  props: Partial<Omit<DeliveryStepProps, 'value' | 'onChange'>> = {},
): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const value: DeliveryStepValue = { ...emptyDeliveryStep('America/Sao_Paulo'), ...patch };
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <DeliveryStep
        value={value}
        onChange={() => undefined}
        mode="single"
        campaignId={null}
        audienceSize={1_200}
        channelHealth={{ quality: 'GREEN', providerDailyLimit: 10_000 }}
        now={NOW}
        {...props}
      />
    </QueryClientProvider>,
  );
}

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

describe('DeliveryStep — linguagem', () => {
  it('escolha principal é Enviar agora ou Agendar', () => {
    const html = render();
    expect(html).toContain('Enviar agora');
    expect(html).toContain('Agendar');
  });

  it('não usa termo técnico na interface', () => {
    const text = visibleText(render({ pace: 'custom', customRate: 45, dailyLimitEnabled: true }));
    for (const word of ['send window', 'janela de envio', 'rate', 'tier', 'broadcast', 'drip']) {
      expect(text).not.toMatch(new RegExp(`\\b${word}\\b`, 'u'));
    }
  });

  it('ritmos mostram quando termina, não só mensagens por minuto', () => {
    const html = render();
    expect(html).toContain('Recomendado');
    expect(html).toMatch(/Termina (hoje|amanhã)/u);
  });
});

describe('DeliveryStep — teclado', () => {
  it('cada grupo é um radiogroup com um único ponto de Tab (no escolhido)', () => {
    const html = render();
    const groups = html.split('role="radiogroup"').slice(1);
    expect(groups.length).toBe(3);
    for (const group of groups) {
      const chunk = group.split('</div>')[0] ?? '';
      const radios = chunk.match(/role="radio"/gu) ?? [];
      const tabbable = chunk.match(/tabindex="0"/gu) ?? [];
      expect(radios.length).toBeGreaterThan(1);
      expect(tabbable.length).toBe(1);
    }
    expect(html).toMatch(/aria-checked="true"[^>]*tabindex="0"/u);
  });

  it('campos de data e hora são nativos e rotulados', () => {
    const html = render({ start: 'scheduled', scheduleDate: '2026-10-08', scheduleTime: '09:00' });
    expect(html).toContain('type="date"');
    expect(html).toContain('type="time"');
    expect(html).toContain('>Dia<');
    expect(html).toContain('>Hora<');
  });

  it('editor semanal: cada horário diz o dia e a faixa', () => {
    const value = applyHoursPreset(emptyDeliveryStep('America/Sao_Paulo'), 'business');
    const html = render({ ...value, windows: value.windows.slice(0, 4) });
    expect(html).toContain('Horários por dia da semana');
    expect(html).toContain('aria-label="Segunda, faixa 1: começa às"');
  });
});

describe('DeliveryStep — celular', () => {
  it('resumo compacto no topo só abaixo de md; alvos ≥ 44 px; campos ≥ 16 px', () => {
    const html = render({ start: 'scheduled', scheduleDate: '2026-10-08', scheduleTime: '09:00' });
    expect(html).toMatch(/class="[^"]*md:hidden[^"]*"/u);
    expect(html).toMatch(/role="radio"[^>]*class="[^"]*min-h-11/u);
    expect(html).toMatch(/type="date"[^>]*class="[^"]*h-11[^"]*text-base/u);
    // O layout de duas colunas só liga em telas largas.
    expect(html).toContain('lg:grid-cols-[minmax(0,1fr)_22rem]');
  });
});

describe('DeliveryStep — agendamento e fuso', () => {
  it('confirma o horário por extenso com o fuso e o deslocamento', () => {
    const html = render({ start: 'scheduled', scheduleDate: '2026-10-08', scheduleTime: '09:00' });
    expect(html).toContain('amanhã às 09:00');
    expect(html).toContain('GMT-3');
  });

  it('DST: horário inexistente avisa ao lado do campo', () => {
    const html = render({
      start: 'scheduled',
      scheduleDate: '2027-03-14',
      scheduleTime: '02:30',
      timezone: 'America/New_York',
    });
    expect(html).toContain('esse horário não existe');
    expect(html).toContain('03:30');
  });

  it('fuso inválido: erro em três partes, opção marcada como não reconhecida', () => {
    const html = render({ timezone: 'Mars/Olympus_Mons' });
    expect(html).toContain('Mars/Olympus_Mons (não reconhecido)');
    expect(html).toContain('não é reconhecido');
    expect(html).toContain('configuração antiga');
    expect(html).toContain('role="alert"');
  });

  it('horário que já passou aparece na hora (sem esperar o avanço)', () => {
    const html = render({ start: 'scheduled', scheduleDate: '2026-10-07', scheduleTime: '08:00' });
    expect(html).toContain('Esse horário já passou');
  });
});

describe('DeliveryStep — resumo reage ao contexto', () => {
  it('qualidade em alerta: metade do ritmo dita no resumo', () => {
    const html = render({}, { channelHealth: { quality: 'YELLOW', providerDailyLimit: 10_000 } });
    expect(html).toContain('O número está em alerta de qualidade');
    expect(html).toContain('(metade, pelo alerta)');
  });

  it('limite diário menor que o público: alerta de divisão em dias', () => {
    const html = render({ dailyLimitEnabled: true, dailyLimit: 500, hoursEnabled: false });
    expect(html).toContain('O envio vai ser dividido em 3 dias');
    expect(html).toContain('Até 500 — o seu limite');
  });

  it('público maior que a capacidade do número: perigo', () => {
    const html = render({}, { audienceSize: 20_000 });
    expect(html).toContain('O público é maior que o que o número alcança por dia');
  });

  it('sem público: vazio que leva ao público', () => {
    const html = render({}, { audienceSize: null, onEditAudience: () => undefined });
    expect(html).toContain('Defina o público para ver a previsão');
    expect(html).toContain('Ir para o público');
  });

  it('com rascunho e sem público local: skeleton enquanto carrega', () => {
    const html = render(
      {},
      { audienceSize: undefined, campaignId: 'c1', channelHealth: undefined },
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Calculando o envio');
  });
});
