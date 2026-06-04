import {
  completePaymentOrder,
  getPaymentOrderByOutTradeNo,
  getSystemConfig,
} from '@/lib/db';
import {
  easyPaySearchParamsToPayload,
  verifyEasyPaySign,
} from '@/lib/easypay';

function moneyToCents(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return -1;
  return Math.round(parsed * 100);
}

export async function handleEasyPayCallback(searchParams: URLSearchParams): Promise<{
  ok: boolean;
  message: string;
  outTradeNo?: string;
  credited?: boolean;
}> {
  const config = await getSystemConfig();
  const payload = easyPaySearchParamsToPayload(searchParams);

  if (!config.payment.enabled) {
    return { ok: false, message: 'payment disabled' };
  }

  if (!verifyEasyPaySign(payload, config.payment.easyPay.apiKey)) {
    return { ok: false, message: 'invalid sign' };
  }

  if (payload.pid !== config.payment.easyPay.merchantId) {
    return { ok: false, message: 'invalid merchant id' };
  }

  if (payload.trade_status !== 'TRADE_SUCCESS') {
    return { ok: false, message: 'payment not successful' };
  }

  if (!payload.out_trade_no) {
    return { ok: false, message: 'missing out_trade_no' };
  }

  const order = await getPaymentOrderByOutTradeNo(payload.out_trade_no);
  if (!order) {
    return { ok: false, message: 'order not found', outTradeNo: payload.out_trade_no };
  }

  if (payload.money && moneyToCents(payload.money) !== order.paidAmountCents) {
    return { ok: false, message: 'amount mismatch', outTradeNo: payload.out_trade_no };
  }

  const result = await completePaymentOrder({
    outTradeNo: payload.out_trade_no,
    providerTradeNo: payload.trade_no,
    rawNotify: JSON.stringify(payload),
  });

  return {
    ok: true,
    message: 'success',
    outTradeNo: payload.out_trade_no,
    credited: result.credited,
  };
}
