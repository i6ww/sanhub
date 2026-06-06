'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { CreditCard, Loader2, Wallet } from 'lucide-react';
import { toast } from '@/components/ui/toaster';
import { formatBalance } from '@/lib/utils';

interface PublicPaymentConfig {
  enabled: boolean;
  pointsPerCny: number;
  methods: { color: string; name: string; type: string }[];
  amountOptions: number[];
  amountDiscounts: Record<string, number>;
  minAmountCny: number;
}

function formatCurrency(amount: number): string {
  return `¥${Math.max(0.01, amount).toFixed(2)}`;
}

export default function RechargePage() {
  const { data: session, update: updateSession } = useSession();
  const searchParams = useSearchParams();
  const [paymentConfig, setPaymentConfig] = useState<PublicPaymentConfig | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState(10);
  const [paymentType, setPaymentType] = useState('alipay');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);

  useEffect(() => {
    loadPaymentConfig();
  }, []);

  useEffect(() => {
    const paymentResult = searchParams.get('payment');
    if (!paymentResult) return;

    if (paymentResult === 'success') {
      toast({ title: '支付成功', description: '积分到账后余额会自动刷新' });
      updateSession();
    } else {
      toast({ title: '支付未完成', variant: 'destructive' });
    }
  }, [searchParams, updateSession]);

  const loadPaymentConfig = async () => {
    try {
      setConfigLoading(true);
      const res = await fetch('/api/payments/config', { cache: 'no-store' });
      if (!res.ok) return;

      const data = await res.json();
      const config = data.data as PublicPaymentConfig;
      setPaymentConfig(config);
      setRechargeAmount(config.amountOptions[0] || config.minAmountCny || 10);
      setPaymentType(config.methods[0]?.type || 'alipay');
    } catch {
      // ignore
    } finally {
      setConfigLoading(false);
    }
  };

  const handleCreatePayment = async () => {
    if (!paymentConfig?.enabled) {
      toast({ title: '充值功能未启用', variant: 'destructive' });
      return;
    }

    setPaymentLoading(true);
    try {
      const res = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCny: rechargeAmount, paymentType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建支付订单失败');

      window.location.href = data.data.paymentUrl;
    } catch (err) {
      toast({
        title: '创建支付失败',
        description: err instanceof Error ? err.message : '未知错误',
        variant: 'destructive',
      });
    } finally {
      setPaymentLoading(false);
    }
  };

  if (!session?.user) {
    return null;
  }

  const paymentDiscount = paymentConfig?.amountDiscounts[String(rechargeAmount)] || 1;
  const paidAmount = Math.max(0.01, rechargeAmount * paymentDiscount);
  const rechargePoints = Math.round(
    rechargeAmount * (paymentConfig?.pointsPerCny || 100)
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-light text-foreground">{'\u5728\u7ebf\u5145\u503c'}</h1>
        <p className="mt-1 text-sm text-foreground/50">
          {'\u9009\u62e9\u5145\u503c\u91d1\u989d\u548c\u652f\u4ed8\u65b9\u5f0f\uff0c\u5145\u503c\u6210\u529f\u540e\u79ef\u5206\u81ea\u52a8\u5230\u8d26'}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <div className="surface p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/15">
              <Wallet className="h-5 w-5 text-sky-300" />
            </div>
            <div>
              <p className="text-sm text-foreground/45">{'\u5f53\u524d\u4f59\u989d'}</p>
              <p className="text-2xl font-light text-foreground">
                {formatBalance(session.user.balance)}
                <span className="ml-1 text-sm text-foreground/40">{'\u79ef\u5206'}</span>
              </p>
            </div>
          </div>
          {paymentConfig?.enabled && (
            <div className="mt-5 rounded-xl border border-border/70 bg-card/50 p-4 text-sm text-foreground/55">
              {'1 \u5143\u4eba\u6c11\u5e01 = '}
              <span className="text-foreground">
                {formatBalance(paymentConfig.pointsPerCny)}
              </span>
              {' \u79ef\u5206'}
            </div>
          )}
        </div>

        <div className="surface overflow-hidden">
          <div className="border-b border-border/70 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/15">
                <CreditCard className="h-5 w-5 text-sky-300" />
              </div>
              <div>
                <h2 className="text-lg font-medium text-foreground">{'\u5145\u503c\u4e2d\u5fc3'}</h2>
                <p className="text-sm text-foreground/40">{'\u652f\u6301\u540e\u53f0\u914d\u7f6e\u7684\u5145\u503c\u65b9\u5f0f\u548c\u91d1\u989d\u5957\u9910'}</p>
              </div>
            </div>
          </div>

          <div className="p-6">
            {configLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/45">
                <Loader2 className="h-4 w-4 animate-spin" />
                {'\u6b63\u5728\u8bfb\u53d6\u5145\u503c\u914d\u7f6e'}
              </div>
            ) : !paymentConfig?.enabled ? (
              <div className="rounded-xl border border-border/70 bg-card/40 px-4 py-10 text-center text-sm text-foreground/45">
                {'\u5145\u503c\u529f\u80fd\u6682\u672a\u542f\u7528'}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="space-y-2">
                    <label className="text-sm uppercase tracking-wider text-foreground/50">{'\u5145\u503c\u91d1\u989d'}</label>
                    <div className="relative">
                      <input
                        type="number"
                        min={paymentConfig.minAmountCny}
                        value={rechargeAmount}
                        onChange={(event) =>
                          setRechargeAmount(Math.max(paymentConfig.minAmountCny, Number(event.target.value) || paymentConfig.minAmountCny))
                        }
                        className="w-full rounded-xl border border-border/70 bg-input/70 px-4 py-3 text-foreground outline-none transition-colors focus:border-border focus:ring-2 focus:ring-ring/30"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-foreground/40">{'\u5143'}</span>
                    </div>
                    <p className="text-sm text-foreground/50">
                      {'\u53ef\u83b7\u5f97 '}
                      <span className="text-foreground">{formatBalance(rechargePoints)}</span>
                      {' \u79ef\u5206'}
                      {paymentDiscount < 1 && (
                        <span className="ml-2 text-emerald-300">
                          {'\u5b9e\u4ed8 '}
                          {formatCurrency(paidAmount)}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm uppercase tracking-wider text-foreground/50">{'\u652f\u4ed8\u65b9\u5f0f'}</label>
                    <div className="flex flex-wrap gap-2">
                      {paymentConfig.methods.map((method) => (
                        <button
                          key={method.type}
                          type="button"
                          onClick={() => setPaymentType(method.type)}
                          className={`flex h-12 items-center gap-2 rounded-xl border px-4 text-sm transition-colors ${
                            paymentType === method.type
                              ? 'border-sky-400/60 bg-sky-500/15 text-sky-200'
                              : 'border-border/70 bg-card/60 text-foreground/70 hover:bg-card/80'
                          }`}
                        >
                          <CreditCard className="h-4 w-4" />
                          {method.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {paymentConfig.amountOptions.map((amount) => {
                    const discount = paymentConfig.amountDiscounts[String(amount)] || 1;
                    const actual = amount * discount;
                    return (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setRechargeAmount(amount)}
                        className={`min-h-[96px] rounded-xl border p-4 text-left transition-colors ${
                          rechargeAmount === amount
                            ? 'border-sky-400/60 bg-sky-500/15'
                            : 'border-border/70 bg-card/60 hover:bg-card/80'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-lg font-medium text-foreground">
                            {amount}
                            {' \u5143'}
                          </p>
                          {discount < 1 && (
                            <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                              {(discount * 10).toFixed(1)}
                              {'\u6298'}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-xs text-foreground/45">
                          {'\u5b9e\u4ed8 '}
                          {formatCurrency(actual)}
                        </p>
                        <p className="mt-1 text-xs text-foreground/45">
                          {'\u5230\u8d26 '}
                          {formatBalance(Math.round(amount * paymentConfig.pointsPerCny))}
                          {' \u79ef\u5206'}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={handleCreatePayment}
                  disabled={paymentLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-6 py-3 font-medium text-background transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {paymentLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  {'\u7acb\u5373\u5145\u503c'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
