'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ArrowRight, Gift, Sparkles, Mail } from 'lucide-react';
import { Captcha } from '@/components/ui/captcha';
import { AnimatedBackground } from '@/components/ui/animated-background';
import { useSiteConfig } from '@/components/providers/site-config-provider';

export default function RegisterPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const siteConfig = useSiteConfig();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [sendingEmailCode, setSendingEmailCode] = useState(false);
  const [emailCodeCooldown, setEmailCodeCooldown] = useState(0);
  const [captchaId, setCaptchaId] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // defaultBalance now comes from siteConfig
  const defaultBalance = siteConfig.defaultBalance;

  // 已登录用户自动跳转
  useEffect(() => {
    if (status === 'authenticated' && session) {
      router.replace('/create');
    }
  }, [status, session, router]);

  useEffect(() => {
    if (emailCodeCooldown <= 0) return;

    const timer = window.setTimeout(() => {
      setEmailCodeCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [emailCodeCooldown]);

  const handleCaptchaChange = useCallback((id: string, code: string) => {
    setCaptchaId(id);
    setCaptchaCode(code);
  }, []);

  const handleSendEmailCode = async () => {
    setError('');

    if (!email) {
      setError('请先输入邮箱');
      return;
    }

    setSendingEmailCode(true);
    try {
      const res = await fetch('/api/auth/email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || '验证码发送失败');
      }

      setEmailCodeCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败');
    } finally {
      setSendingEmailCode(false);
    }
  };

  // 如果正在检查登录状态，显示加载中
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-foreground/50">加载中...</div>
      </div>
    );
  }

  // 已登录则不渲染注册表单（等待跳转）
  if (status === 'authenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-foreground/50">正在跳转...</div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }

    if (password.length < 6) {
      setError('密码至少需要 6 个字符');
      return;
    }

    if (siteConfig.emailVerificationEnabled && !emailCode) {
      setError('请输入邮箱验证码');
      return;
    }

    // 验证码检查
    if (!captchaCode || captchaCode.length !== 4) {
      setError('请输入4位验证码');
      return;
    }

    setLoading(true);

    try {
      // 先验证验证码
      const captchaRes = await fetch('/api/captcha/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: captchaId, code: captchaCode }),
      });
      
      const captchaData = await captchaRes.json();
      if (!captchaData.success) {
        setError('验证码错误');
        handleCaptchaChange('', '');
        return;
      }

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, emailCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '注册失败');
      }

      router.push('/login?registered=true');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden text-foreground">
      {/* 动态背景 */}
      <AnimatedBackground variant="auth" />
      
      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 relative z-10">
        <div className="w-full max-w-sm space-y-6">
          {/* Logo */}
          <div className="text-center space-y-4 animate-rise">
            <Link href="/" className="inline-block group">
              <div className="flex items-center justify-center gap-2 mb-2">
                <div className="w-10 h-10 bg-gradient-to-br from-sky-500/25 to-emerald-500/25 border border-border/70 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Sparkles className="w-5 h-5 text-foreground/80" />
                </div>
              </div>
              <h1 className="text-3xl font-light tracking-wider text-foreground">{siteConfig.siteName}</h1>
            </Link>
            <p className="text-foreground/40 text-sm">创建账号，开启创作之旅</p>
          </div>

          {/* Bonus hint */}
          <div className="flex items-center justify-center gap-2 py-2.5 px-5 bg-gradient-to-r from-sky-500/10 to-emerald-500/10 border border-border/70 rounded-full mx-auto w-fit backdrop-blur-sm">
            <Gift className="w-4 h-4 text-sky-300" />
            <span className="text-sm text-foreground/70">新用户赠送 <span className="text-foreground font-medium">{defaultBalance}</span> 积分</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-foreground/50 uppercase tracking-wider">昵称</label>
              <input
                type="text"
                placeholder="您的昵称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-4 py-3 bg-input/70 border border-border/70 rounded-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-border focus:ring-2 focus:ring-ring/30 transition-colors text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-foreground/50 uppercase tracking-wider">邮箱</label>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-input/70 border border-border/70 rounded-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-border focus:ring-2 focus:ring-ring/30 transition-colors text-sm"
              />
            </div>
            {siteConfig.emailVerificationEnabled && (
              <div className="space-y-1.5">
                <label className="text-xs text-foreground/50 uppercase tracking-wider">邮箱验证码</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="6 位验证码"
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value)}
                    required
                    className="min-w-0 flex-1 px-4 py-3 bg-input/70 border border-border/70 rounded-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-border focus:ring-2 focus:ring-ring/30 transition-colors text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleSendEmailCode}
                    disabled={sendingEmailCode || emailCodeCooldown > 0}
                    className="flex h-[46px] min-w-[112px] items-center justify-center gap-2 rounded-lg border border-border/70 bg-card/70 px-3 text-sm text-foreground transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {sendingEmailCode ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                    <span>{emailCodeCooldown > 0 ? `${emailCodeCooldown}s` : '发送'}</span>
                  </button>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs text-foreground/50 uppercase tracking-wider">密码</label>
              <input
                type="password"
                placeholder="至少 6 个字符"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 bg-input/70 border border-border/70 rounded-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-border focus:ring-2 focus:ring-ring/30 transition-colors text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-foreground/50 uppercase tracking-wider">确认密码</label>
              <input
                type="password"
                placeholder="再次输入密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full px-4 py-3 bg-input/70 border border-border/70 rounded-lg text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-border focus:ring-2 focus:ring-ring/30 transition-colors text-sm"
              />
            </div>

            <Captcha onCaptchaChange={handleCaptchaChange} />

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-foreground text-background rounded-full font-medium hover:opacity-90 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  注册中...
                </>
              ) : (
                <>
                  创建账号
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="text-center text-sm">
            <span className="text-foreground/40">已有账号？</span>{' '}
            <Link href="/login" className="text-foreground/80 hover:text-foreground transition-colors">
              立即登录
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-6 text-center">
        <p className="text-xs text-foreground/30">{siteConfig.copyright}</p>
      </footer>
    </div>
  );
}
