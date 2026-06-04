import { NextRequest, NextResponse } from 'next/server';
import { createUser, getSystemConfig } from '@/lib/db';
import {
  normalizeEmail,
  validateEmailPolicy,
  verifyEmailCode,
} from '@/lib/email-verification';
import { checkRateLimit, RateLimitConfig } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const rateLimit = checkRateLimit(request, RateLimitConfig.AUTH, 'auth-register');
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: rateLimit.headers }
      );
    }

    const { name, email, password, emailCode } = await request.json();
    const normalizedEmail = normalizeEmail(email);

    if (!name || !normalizedEmail || !password) {
      return NextResponse.json(
        { error: '请填写所有必填字段' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: '密码至少需要 6 个字符' },
        { status: 400 }
      );
    }

    // 检查是否允许注册
    const config = await getSystemConfig();
    if (!config.registerEnabled) {
      return NextResponse.json(
        { error: '当前不开放注册' },
        { status: 403 }
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

    if (
      config.emailVerification.enabled &&
      !verifyEmailCode(normalizedEmail, emailCode)
    ) {
      return NextResponse.json(
        { error: '邮箱验证码错误或已过期' },
        { status: 400 }
      );
    }

    // 创建用户
    const user = await createUser(normalizedEmail, password, name);

    return NextResponse.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '注册失败' },
      { status: 500 }
    );
  }
}
