import crypto from 'crypto';
import type { PaymentConfig, PaymentOrder } from '@/types';

export interface EasyPayNotifyPayload {
  pid?: string;
  trade_no?: string;
  out_trade_no?: string;
  type?: string;
  name?: string;
  money?: string;
  trade_status?: string;
  sign?: string;
  sign_type?: string;
  [key: string]: string | undefined;
}

export function formatMoney(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

export function signEasyPayParams(
  params: Record<string, string | number | undefined>,
  apiKey: string
): string {
  const preSign = buildVerifyParams(params);
  return crypto
    .createHash('md5')
    .update(`${preSign}${apiKey}`, 'utf8')
    .digest('hex');
}

export function verifyEasyPaySign(
  params: Record<string, string | undefined>,
  apiKey: string
): boolean {
  if (!params.sign) return false;
  return signEasyPayParams(params, apiKey) === params.sign;
}

export function buildEasyPaySubmitUrl(input: {
  config: PaymentConfig;
  order: PaymentOrder;
  siteName: string;
  notifyUrl: string;
  returnUrl: string;
}): string {
  const baseUrl = input.config.easyPay.baseUrl.replace(/\/+$/, '');
  const params: Record<string, string> = {
    money: formatMoney(input.order.paidAmountCents),
    name: `${input.siteName || 'SANHUB'} 积分充值`,
    notify_url: input.notifyUrl,
    out_trade_no: input.order.outTradeNo,
    pid: input.config.easyPay.merchantId,
    return_url: input.returnUrl,
    sitename: input.siteName || 'SANHUB',
    type: input.order.paymentType,
  };
  const sign = signEasyPayParams(params, input.config.easyPay.apiKey);
  const search = new URLSearchParams({
    ...params,
    sign,
    sign_type: 'MD5',
  });

  return `${baseUrl}/submit.php?${search.toString()}`;
}

export function easyPaySearchParamsToPayload(
  searchParams: URLSearchParams
): EasyPayNotifyPayload {
  const payload: EasyPayNotifyPayload = {};
  searchParams.forEach((value, key) => {
    payload[key] = value;
  });
  return payload;
}

function buildVerifyParams(
  params: Record<string, string | number | undefined>
): string {
  return Object.entries(params)
    .filter(([key, value]) => {
      return key !== 'sign' && key !== 'sign_type' && value !== undefined && value !== '';
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}
