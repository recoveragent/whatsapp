'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Calendar,
  Download,
  Eye,
  History,
  Loader2,
  RefreshCw,
  Wallet,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { formatDateInr, formatInrFromPaise } from '@/lib/wallet/format';
import type { WalletDailyRow, WalletTransaction } from '@/lib/wallet/types';
import { RechargeDialog } from '@/components/wallet/recharge-dialog';

type ViewTab = 'daily' | 'transactions';
type TypeFilter = 'all' | 'credit' | 'debit';

export function WalletPanel() {
  const { canEditSettings } = useAuth();
  const [balancePaise, setBalancePaise] = useState(0);
  const [gstRate, setGstRate] = useState(0.18);
  const [rechargeEnabled, setRechargeEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewTab>('daily');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [daily, setDaily] = useState<WalletDailyRow[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayTransactions, setDayTransactions] = useState<WalletTransaction[]>([]);
  const [rechargeOpen, setRechargeOpen] = useState(false);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (dateFrom) params.set('from', new Date(dateFrom).toISOString());
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      params.set('to', end.toISOString());
    }
    return params.toString();
  }, [typeFilter, dateFrom, dateTo]);

  const loadWallet = useCallback(async () => {
    const res = await fetch('/api/wallet');
    if (!res.ok) throw new Error('Failed to load wallet');
    const data = await res.json();
    setBalancePaise(Number(data.balancePaise ?? 0));
    setGstRate(Number(data.gstRate ?? 0.18));
    setRechargeEnabled(Boolean(data.rechargeEnabled));
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await loadWallet();
      const dailyUrl = queryParams ? `/api/wallet/daily?${queryParams}` : '/api/wallet/daily';
      const txParams = new URLSearchParams(queryParams);
      txParams.set('limit', '100');
      const [dailyRes, txRes] = await Promise.all([
        fetch(dailyUrl),
        fetch(`/api/wallet/transactions?${txParams}`),
      ]);
      if (!dailyRes.ok || !txRes.ok) {
        const dailyErr = dailyRes.ok ? null : await dailyRes.json().catch(() => null);
        const txErr = txRes.ok ? null : await txRes.json().catch(() => null);
        throw new Error(
          (dailyErr as { error?: string } | null)?.error ??
            (txErr as { error?: string } | null)?.error ??
            'Failed to load history',
        );
      }
      const dailyData = await dailyRes.json();
      const txData = await txRes.json();
      setDaily(dailyData.daily ?? []);
      setTransactions(txData.transactions ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load wallet');
    } finally {
      setLoading(false);
    }
  }, [loadWallet, queryParams]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openDayDetails = async (date: string) => {
    setSelectedDay(date);
    const start = new Date(date);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    const params = new URLSearchParams({
      from: start.toISOString(),
      to: end.toISOString(),
      limit: '200',
    });
    const res = await fetch(`/api/wallet/transactions?${params}`);
    if (!res.ok) {
      toast.error('Failed to load day details');
      return;
    }
    const data = await res.json();
    setDayTransactions(data.transactions ?? []);
  };

  const exportCsv = () => {
    const rows = transactions.map((t) => [
      formatDateInr(t.createdAt),
      t.description,
      t.type === 'credit' ? formatInrFromPaise(t.amountPaise) : '',
      t.type === 'debit' ? formatInrFromPaise(t.amountPaise) : '',
      formatInrFromPaise(t.balanceAfterPaise),
      t.status,
    ]);
    const header = ['Date', 'Description', 'Credit', 'Debit', 'Balance', 'Status'];
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wallet-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRechargeSuccess = async () => {
    setRechargeOpen(false);
    toast.success('Wallet recharged successfully');
    await loadData();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <History className="size-5 text-primary" />
            Transaction History
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            View your recent wallet transactions
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEditSettings && rechargeEnabled ? (
            <Button onClick={() => setRechargeOpen(true)}>
              <Wallet className="size-4" />
              Recharge
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="border-border">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <CardTitle className="text-base">Wallet balance</CardTitle>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {formatInrFromPaise(balancePaise)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-muted-foreground" />
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 w-36"
                aria-label="From date"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 w-36"
                aria-label="To date"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadData()}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="size-4" />
              Export Usage
            </Button>
            <div className="flex rounded-lg border border-border p-0.5">
              {(['all', 'credit', 'debit'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setTypeFilter(f)}
                  className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    typeFilter === f
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'credit' ? 'Credits' : 'Debits'}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="mb-4 flex gap-4 border-b border-border">
            {(['daily', 'transactions'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setView(tab)}
                className={`border-b-2 px-1 pb-2 text-sm font-medium capitalize transition-colors ${
                  view === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : view === 'daily' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Date</th>
                    <th className="pb-3 pr-4 font-medium">Description</th>
                    <th className="pb-3 pr-4 font-medium">Credit</th>
                    <th className="pb-3 pr-4 font-medium">Debit</th>
                    <th className="pb-3 pr-4 font-medium">Balance</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        No transactions yet
                      </td>
                    </tr>
                  ) : (
                    daily.map((row) => (
                      <tr key={row.date} className="border-b border-border/60">
                        <td className="py-3 pr-4">{formatDateInr(row.date)}</td>
                        <td className="py-3 pr-4">
                          {row.transactionCount} transaction
                          {row.transactionCount === 1 ? '' : 's'}
                        </td>
                        <td className="py-3 pr-4">
                          {row.creditPaise > 0 ? formatInrFromPaise(row.creditPaise) : '–'}
                        </td>
                        <td className="py-3 pr-4">
                          {row.debitPaise > 0 ? formatInrFromPaise(row.debitPaise) : '–'}
                        </td>
                        <td className="py-3 pr-4">
                          {formatInrFromPaise(row.balanceAfterPaise)}
                        </td>
                        <td className="py-3 pr-4">Completed</td>
                        <td className="py-3">
                          <button
                            type="button"
                            onClick={() => void openDayDetails(row.date)}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <Eye className="size-3.5" />
                            Details
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Date</th>
                    <th className="pb-3 pr-4 font-medium">Description</th>
                    <th className="pb-3 pr-4 font-medium">Credit</th>
                    <th className="pb-3 pr-4 font-medium">Debit</th>
                    <th className="pb-3 pr-4 font-medium">Balance</th>
                    <th className="pb-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        No transactions yet
                      </td>
                    </tr>
                  ) : (
                    transactions.map((t) => (
                      <tr key={t.id} className="border-b border-border/60">
                        <td className="py-3 pr-4">{formatDateInr(t.createdAt)}</td>
                        <td className="py-3 pr-4">{t.description}</td>
                        <td className="py-3 pr-4">
                          {t.type === 'credit' ? formatInrFromPaise(t.amountPaise) : '–'}
                        </td>
                        <td className="py-3 pr-4">
                          {t.type === 'debit' ? formatInrFromPaise(t.amountPaise) : '–'}
                        </td>
                        <td className="py-3 pr-4">
                          {formatInrFromPaise(t.balanceAfterPaise)}
                        </td>
                        <td className="py-3 capitalize">{t.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedDay ? (
        <Card className="border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Details — {formatDateInr(selectedDay)}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setSelectedDay(null)}>
              Close
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {dayTransactions.map((t) => (
                <li key={t.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                  <span>{t.description}</span>
                  <span className={t.type === 'credit' ? 'text-green-600' : 'text-foreground'}>
                    {t.type === 'credit' ? '+' : '−'}
                    {formatInrFromPaise(t.amountPaise)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <RechargeDialog
        open={rechargeOpen}
        onOpenChange={setRechargeOpen}
        gstRate={gstRate}
        onSuccess={handleRechargeSuccess}
      />
    </div>
  );
}
