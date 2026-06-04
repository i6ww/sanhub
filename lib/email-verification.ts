import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { EmailVerificationConfig } from '@/types';

interface StoredEmailCode {
  code: string;
  expires: number;
  attempts: number;
}

const emailCodeStore = new Map<string, StoredEmailCode>();
const MAX_VERIFY_ATTEMPTS = 5;

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function validateEmailPolicy(
  email: string,
  config: EmailVerificationConfig
): { ok: true } | { ok: false; error: string } {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: '邮箱格式不正确' };
  }

  const [localPart, domainPart] = email.split('@');
  const domain = domainPart.toLowerCase();

  if (config.aliasRestrictionEnabled && localPart.includes('+')) {
    return { ok: false, error: '当前不允许使用邮箱别名注册' };
  }

  if (config.domainWhitelistEnabled) {
    const allowedDomains = parseDomainList(config.allowedDomains);
    if (allowedDomains.length === 0) {
      return { ok: false, error: '邮箱域名白名单尚未配置' };
    }

    if (!allowedDomains.includes(domain)) {
      return { ok: false, error: '该邮箱域名不允许注册' };
    }
  }

  return { ok: true };
}

export async function sendEmailVerificationCode(
  email: string,
  siteName: string,
  config: EmailVerificationConfig
): Promise<void> {
  const smtp = config.smtp;
  const fromEmail = smtp.fromEmail || smtp.username;

  if (!smtp.host || !smtp.port || !smtp.username || !smtp.password || !fromEmail) {
    throw new Error('SMTP 配置不完整');
  }

  cleanupExpiredCodes();

  const code = createVerificationCode();
  const expires = Date.now() + config.codeExpiresMinutes * 60 * 1000;
  emailCodeStore.set(email, { code, expires, attempts: 0 });

  const transportOptions: SMTPTransport.Options = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.username,
      pass: smtp.password,
    },
  };

  if (smtp.authLogin) {
    transportOptions.authMethod = 'LOGIN';
  }

  const transporter = nodemailer.createTransport(transportOptions);
  const displayName = siteName || 'SANHUB';

  await transporter.sendMail({
    from: `"${displayName}" <${fromEmail}>`,
    to: email,
    subject: `${displayName} 邮箱验证码`,
    text: `Your verification code is ${code}. It expires in ${config.codeExpiresMinutes} minutes.`,
    html: buildEmailHtml(displayName, code, config.codeExpiresMinutes),
  });
}

export function verifyEmailCode(email: string, code: unknown): boolean {
  const normalizedCode = typeof code === 'string' ? code.trim() : '';
  const stored = emailCodeStore.get(email);

  if (!stored) return false;

  if (stored.expires < Date.now()) {
    emailCodeStore.delete(email);
    return false;
  }

  if (stored.attempts >= MAX_VERIFY_ATTEMPTS) {
    emailCodeStore.delete(email);
    return false;
  }

  stored.attempts += 1;

  if (stored.code !== normalizedCode) {
    return false;
  }

  emailCodeStore.delete(email);
  return true;
}

function parseDomainList(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

function createVerificationCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function cleanupExpiredCodes(): void {
  const now = Date.now();
  for (const [email, stored] of Array.from(emailCodeStore.entries())) {
    if (stored.expires < now) {
      emailCodeStore.delete(email);
    }
  }
}

function buildEmailHtml(siteName: string, code: string, expiresMinutes: number): string {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin: 0 0 16px;">${siteName}</h2>
      <p>Your verification code is:</p>
      <div style="font-size: 28px; letter-spacing: 6px; font-weight: 700; margin: 16px 0;">${code}</div>
      <p>This code expires in ${expiresMinutes} minutes.</p>
      <p style="color: #6b7280;">If you did not request this code, you can ignore this email.</p>
    </div>
  `;
}
