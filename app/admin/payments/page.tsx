'use client';

import { useEffect, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { CreditCard, Loader2, Save, Shield } from 'lucide-react';
import type { PaymentConfig, SystemConfig } from '@/types';
import { toast } from '@/components/ui/toaster';

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card/60">
      <div className="flex items-center gap-3 border-b border-border/70 p-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-card/80">
          <Icon className="h-4 w-4 text-foreground/70" />
        </div>
        <h2 className="font-medium text-foreground">{title}</h2>
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </div>
  );
}

function Switch({
  checked,
  onClick,
}: {
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-6 w-12 rounded-full transition-colors ${
        checked ? 'bg-emerald-500' : 'bg-card/80'
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-foreground transition-transform ${
          checked ? 'left-7' : 'left-1'
        }`}
      />
    </button>
  );
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export default function AdminPaymentsPage() {
  const [payment, setPayment] = useState<PaymentConfig | null>(null);
  const [methodsJson, setMethodsJson] = useState('');
  const [amountOptionsJson, setAmountOptionsJson] = useState('');
  const [amountDiscountsJson, setAmountDiscountsJson] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const res = await fetch('/api/admin/settings', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载支付配置失败');

      const config = data.data as SystemConfig;
      setPayment(config.payment);
      setMethodsJson(prettyJson(config.payment.methods));
      setAmountOptionsJson(prettyJson(config.payment.amountOptions));
      setAmountDiscountsJson(prettyJson(config.payment.amountDiscounts));
    } catch (error) {
      toast({
        title: '加载失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    if (!payment) return;

    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment: {
            enabled: payment.enabled,
            serverBaseUrl: payment.serverBaseUrl,
            callbackUrl: payment.callbackUrl,
            pointsPerCny: payment.pointsPerCny,
            methodsJson,
            amountOptionsJson,
            amountDiscountsJson,
            easyPay: payment.easyPay,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '保存支付配置失败');

      const nextPayment = (data.data as SystemConfig).payment;
      setPayment(nextPayment);
      setMethodsJson(prettyJson(nextPayment.methods));
      setAmountOptionsJson(prettyJson(nextPayment.amountOptions));
      setAmountDiscountsJson(prettyJson(nextPayment.amountDiscounts));
      toast({ title: '支付配置已保存' });
    } catch (error) {
      toast({
        title: '保存失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  function patch(updater: (prev: PaymentConfig) => PaymentConfig) {
    setPayment((prev) => (prev ? updater(prev) : prev));
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-foreground/30" />
      </div>
    );
  }

  if (!payment) {
    return <div className="py-12 text-center text-foreground/50">加载支付配置失败</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extralight text-foreground sm:text-3xl">支付设置</h1>
          <p className="mt-1 text-sm text-foreground/50">配置积分充值、充值额度与易支付商户参数。</p>
        </div>
        <button
          type="button"
          onClick={saveConfig}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-background disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存支付设置
        </button>
      </div>

      <Card icon={Shield} title="通用设置">
        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/50 p-4">
          <div>
            <p className="text-sm text-foreground">启用充值支付</p>
            <p className="mt-1 text-xs text-foreground/30">关闭后用户无法创建新的充值订单。</p>
          </div>
          <Switch
            checked={payment.enabled}
            onClick={() => patch((prev) => ({ ...prev, enabled: !prev.enabled }))}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 lg:col-span-2">
            <label className="text-sm text-foreground/50">服务器地址</label>
            <input
              value={payment.serverBaseUrl}
              onChange={(event) =>
                patch((prev) => ({ ...prev, serverBaseUrl: event.target.value }))
              }
              placeholder="https://www.371181668.xyz"
              className="w-full rounded-lg border border-border/70 bg-card/60 px-4 py-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <p className="text-xs text-foreground/35">该地址用于生成支付回调地址和付款完成后的跳转地址。</p>
          </div>

          <div className="space-y-2 lg:col-span-2">
            <label className="text-sm text-foreground/50">回调地址</label>
            <input
              value={payment.callbackUrl}
              onChange={(event) =>
                patch((prev) => ({ ...prev, callbackUrl: event.target.value }))
              }
              placeholder="留空自动使用 /api/payments/notify/easypay"
              className="w-full rounded-lg border border-border/70 bg-card/60 px-4 py-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <p className="text-xs text-foreground/35">留空时默认使用服务器地址自动拼接回调地址。</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-foreground/50">积分兑换比例</label>
            <input
              type="number"
              min="1"
              value={payment.pointsPerCny}
              onChange={(event) =>
                patch((prev) => ({
                  ...prev,
                  pointsPerCny: Math.max(1, Number(event.target.value) || 1),
                }))
              }
              className="w-full rounded-lg border border-border/70 bg-card/60 px-4 py-3 text-foreground focus:outline-none"
            />
            <p className="text-xs text-foreground/35">当前为 1 元人民币 = {payment.pointsPerCny} 积分。</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-foreground/50">充值额度选项</label>
            <textarea
              value={amountOptionsJson}
              onChange={(event) => setAmountOptionsJson(event.target.value)}
              rows={7}
              className="w-full rounded-lg border border-border/70 bg-card/60 px-4 py-3 font-mono text-sm text-foreground focus:outline-none"
            />
          </div>

          <div className="space-y-2 lg:col-span-2">
            <label className="text-sm text-foreground/50">充值方式设置</label>
            <textarea
              value={methodsJson}
              onChange={(event) => setMethodsJson(event.target.value)}
              rows={5}
              className="w-full rounded-lg border border-border/70 bg-card/60 px-4 py-3 font-mono text-sm text-foreground focus:outline-none"
            />
          </div>

          <div className="space-y-2 lg:col-span-2">
            <label className="text-sm text-foreground/50">充值金额折扣配置</label>
            <textarea
              value={amountDiscountsJson}
              onChange={(event) => setAmountDiscountsJson(event.target.value)}
              rows={5}
              className="w-full rounded-lg border border-border/70 bg-card/60 px-4 py-3 font-mono text-sm text-foreground focus:outline-none"
            />
            <p className="text-xs text-foreground/35">键为充值金额，值为折扣率，例如 0.92 表示 9.2 折。</p>
          </div>
        </div>
      </Card>

      <Card icon={CreditCard} title="易支付设置">
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-4 text-sm text-sky-100">
          当前只支持易支付接口，回调地址请在通用设置中配置。
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <label className="text-sm text-foreground/50">支付地址</label>
            <input
              value={payment.easyPay.baseUrl}
              onChange={(event) =>
                patch((prev) => ({
                  ...prev,
                  easyPay: { ...prev.easyPay, baseUrl: event.target.value },
                }))
              }
              placeholder="https://ezfpy.cn"
              className="w-full rounded-lg border border-border/70 bg-card/60 px-4 py-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-foreground/50">商户 ID</label>
            <input
              value={payment.easyPay.merchantId}
              onChange={(event) =>
                patch((prev) => ({
                  ...prev,
                  easyPay: { ...prev.easyPay, merchantId: event.target.value },
                }))
              }
              placeholder="2998"
              className="w-full rounded-lg border border-border/70 bg-card/60 px-4 py-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-foreground/50">API 密钥</label>
            <input
              type="password"
              value={payment.easyPay.apiKey}
              onChange={(event) =>
                patch((prev) => ({
                  ...prev,
                  easyPay: { ...prev.easyPay, apiKey: event.target.value },
                }))
              }
              placeholder="敏感信息不会发送到前端显示"
              className="w-full rounded-lg border border-border/70 bg-card/60 px-4 py-3 text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-foreground/50">最低充值金额</label>
            <input
              type="number"
              min="1"
              value={payment.easyPay.minAmountCny}
              onChange={(event) =>
                patch((prev) => ({
                  ...prev,
                  easyPay: {
                    ...prev.easyPay,
                    minAmountCny: Math.max(1, Number(event.target.value) || 1),
                  },
                }))
              }
              className="w-full rounded-lg border border-border/70 bg-card/60 px-4 py-3 text-foreground focus:outline-none"
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
