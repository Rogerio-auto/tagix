'use client';

/**
 * Painel de customização do dashboard (F8-S04, DASHBOARD §6). Lista os cards que o
 * role do member vê e permite: esconder/mostrar, reordenar (subir/descer) e definir
 * o período padrão. Persiste via PATCH /api/members/me/dashboard-layout (reusa o hook
 * de S03). Cards obrigatórios (definidos pelo ADMIN) aparecem travados — não podem
 * ser escondidos (espelha o guard do backend).
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, X } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/cn';
import { useDashboard, useUpdateDashboardLayout } from '../queries';
import { useDashboardConfig } from './queries';

const PERIODS: readonly { value: string; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: '90d', label: 'Últimos 90 dias' },
  { value: 'mtd', label: 'Mês atual' },
  { value: 'ytd', label: 'Ano atual' },
];

interface CardItem {
  key: string;
  label: string;
}

export function CustomizeDashboardDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const { toast } = useToast();
  const dashboard = useDashboard();
  const config = useDashboardConfig(open);
  const update = useUpdateDashboardLayout();

  const role = dashboard.data?.role;
  const requiredKeys = useMemo(
    () => new Set(role ? config.data?.config.requiredByRole[role] ?? [] : []),
    [config.data, role],
  );

  const allCards: CardItem[] = useMemo(
    () => (dashboard.data?.cards ?? []).map((c) => ({ key: c.key, label: c.label })),
    [dashboard.data],
  );

  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<string>('30d');

  useEffect(() => {
    if (!open || !dashboard.data) return;
    const prefs = dashboard.data.layoutPreferences;
    const knownKeys = allCards.map((c) => c.key);
    const ordered = [
      ...prefs.order.filter((k) => knownKeys.includes(k)),
      ...knownKeys.filter((k) => !prefs.order.includes(k)),
    ];
    setOrder(ordered);
    setHidden(new Set(prefs.hidden));
    setPeriod(prefs.period ?? '30d');
  }, [open, dashboard.data, allCards]);

  if (!open) return null;

  const labelOf = (key: string) => allCards.find((c) => c.key === key)?.label ?? key;

  const move = (index: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const toggleHidden = (key: string) => {
    if (requiredKeys.has(key)) return; // obrigatório: não esconde.
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    try {
      await update.mutateAsync({ hidden: [...hidden], order, period });
      toast({ variant: 'success', title: 'Dashboard atualizado.' });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast({ variant: 'error', title: 'Um card obrigatório não pode ser escondido.' });
        return;
      }
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} aria-hidden />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-surface"
        role="dialog"
        aria-label="Personalizar dashboard"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-head text-base font-semibold text-text">Personalizar dashboard</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-text-low hover:text-text">
            <X className="size-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <label className="mb-4 flex flex-col gap-1 text-sm text-text-mid">
            Período padrão
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-low">Cards</h3>
          <ul className="flex flex-col gap-1">
            {order.map((key, i) => {
              const required = requiredKeys.has(key);
              const isHidden = hidden.has(key);
              return (
                <li
                  key={key}
                  className={cn(
                    'flex items-center gap-2 rounded-md border border-border px-3 py-2',
                    isHidden && 'opacity-50',
                  )}
                >
                  <span className="flex-1 truncate text-sm text-text">{labelOf(key)}</span>
                  {required && (
                    <span title="Obrigatório (definido pelo admin)">
                      <Lock className="size-4 text-text-low" aria-label="Obrigatório" />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Subir"
                    className="text-text-low hover:text-text disabled:opacity-30"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === order.length - 1}
                    aria-label="Descer"
                    className="text-text-low hover:text-text disabled:opacity-30"
                  >
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleHidden(key)}
                    disabled={required}
                    aria-label={isHidden ? 'Mostrar card' : 'Esconder card'}
                    className="text-text-low hover:text-text disabled:opacity-30"
                  >
                    {isHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={update.isPending} onClick={() => void save()}>
            {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        </footer>
      </aside>
    </>
  );
}
