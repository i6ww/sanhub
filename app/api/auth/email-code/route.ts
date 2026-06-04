import { NextRequest, NextResponse } from 'next/server';
import { getSystemConfig, getUserByEmail } from '@/lib/db';
import {
  normalizeEmail,
  sendEmailVerificationCode,
  validateEmailPolicy,
} from '@/lib/email-verification';
import { checkRateLimit, RateLimitConfig } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request, RateLimitConfig.AUTH, 'auth-email-code');
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: rateLimit.headers }
      );
    }

    const { email } = await request.json();
    const normalizedEmail = normalizeEmail(email);
    const config = await getSystemConfig();

    if (!config.registerEnabled) {
      return NextResponse.json(
        { error: '当前不开放注册' },
        { status: 403 }
      );
    }

    if (!config.emailVerification.enabled) {
      return NextResponse.json(
        { error: '邮箱验证码未启用' },
        { status: 400 }
      );
    }

    const emailPolicy = validateEmailPolicy(
      normalizedEmail,
      config.emailVerification
    );
    if (!emailPolicy.ok) {
      return NextResponse.json(
        { error: emailPolicy.error },
        { status: 400 }
      );
    }

    const existingUser = await getUserByEmail(normalizedEmail);
    if (existingUser) {
      return NextResponse.json(
        { error: '该邮箱已被注册' },
        { status: 409 }
      );
    }

    await sendEmailVerificationCode(
      normalizedEmail,
      config.siteConfig.siteName,
      config.emailVerification
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Email verification code error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '验证码发送失败' },
      { status: 500 }
    );
  }
}
