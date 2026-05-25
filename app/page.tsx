import Link from 'next/link';
import { ArrowRight, Video, Image as ImageIcon, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AnimatedBackground } from '@/components/ui/animated-background';
import { getPublicSiteConfig } from '@/lib/site-config';

export default async function LandingPage() {
  const siteConfig = await getPublicSiteConfig();

  // Split the tagline into two balanced hero lines.
  const taglineParts = siteConfig.siteTagline.split(' ');
  const taglineLine1 = taglineParts.slice(0, 2).join(' ');
  const taglineLine2 = taglineParts.slice(2).join(' ');

  return (
    <div className="min-h-screen text-foreground relative flex flex-col overflow-hidden">
      {/* Animated background */}
      <AnimatedBackground variant="home" />
      
      {/* Main Content - Full viewport centered */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 relative z-10">
        <div className="max-w-5xl mx-auto text-center space-y-12 animate-rise">
          {/* Logo badge */}
          <div className="chip backdrop-blur-sm animate-float">
            <Sparkles className="w-4 h-4 text-sky-300" />
            <span className="text-sm text-foreground/70">AI 创作平台</span>
          </div>

          {/* English tagline */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-light tracking-tight leading-[1.05]">
            <span className="bg-gradient-to-r from-foreground via-foreground/80 to-foreground/60 bg-clip-text text-transparent animate-shimmer">
              {taglineLine1}
            </span>
            <br />
            <span className="bg-gradient-to-r from-sky-200 via-foreground/70 to-emerald-200 bg-clip-text text-transparent animate-shimmer" style={{ animationDelay: '0.5s' }}>
              {taglineLine2}
            </span>
          </h1>

          {/* Product description */}
          <div className="space-y-4 max-w-2xl mx-auto">
            <h2 className="text-xl md:text-2xl font-light text-foreground/80">
              {siteConfig.siteDescription}
            </h2>
            <p className="text-base md:text-lg text-foreground/50 font-light leading-relaxed">
              {siteConfig.siteSubDescription}
            </p>
          </div>

          {/* Features */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl mx-auto">
            <div className="surface group flex items-center gap-4 px-6 py-5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-sky-500/40 hover:shadow-[0_0_30px_rgba(14,165,233,0.15)]">
              <div className="w-12 h-12 bg-card/85 border border-border/70 rounded-2xl flex items-center justify-center group-hover:scale-110 group-hover:border-sky-500/30 transition-all duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                <Video className="w-5 h-5 text-sky-400 group-hover:text-sky-300 transition-colors" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-foreground tracking-wide group-hover:text-sky-200 transition-colors">Sora 视频</p>
                <p className="text-xs text-foreground/45 mt-0.5 font-light">AI 视频生成</p>
              </div>
            </div>
            <div className="surface group flex items-center gap-4 px-6 py-5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-emerald-500/40 hover:shadow-[0_0_30px_rgba(16,185,129,0.15)]">
              <div className="w-12 h-12 bg-card/85 border border-border/70 rounded-2xl flex items-center justify-center group-hover:scale-110 group-hover:border-emerald-500/30 transition-all duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                <ImageIcon className="w-5 h-5 text-emerald-400 group-hover:text-emerald-300 transition-colors" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-foreground tracking-wide group-hover:text-emerald-200 transition-colors">Gemini 图像</p>
                <p className="text-xs text-foreground/45 mt-0.5 font-light">AI 图像创作</p>
              </div>
            </div>
            <div className="surface group flex items-center gap-4 px-6 py-5 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-amber-500/40 hover:shadow-[0_0_30px_rgba(245,158,11,0.15)]">
              <div className="w-12 h-12 bg-card/85 border border-border/70 rounded-2xl flex items-center justify-center group-hover:scale-110 group-hover:border-amber-500/30 transition-all duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                <Zap className="w-5 h-5 text-amber-400 group-hover:text-amber-300 transition-colors" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-foreground tracking-wide group-hover:text-amber-200 transition-colors">角色卡</p>
                <p className="text-xs text-foreground/45 mt-0.5 font-light">视频角色提取</p>
              </div>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-5 pt-6">
            <Button 
              size="lg" 
              className="btn-premium-glow bg-gradient-to-r from-sky-400 via-indigo-500 to-emerald-500 hover:from-sky-500 hover:via-indigo-600 hover:to-emerald-600 text-white px-12 h-13 text-base font-semibold rounded-full border border-white/20 transition-all duration-300" 
              asChild
            >
              <Link href="/register">
                开始创作 <ArrowRight className="w-4 h-4 ml-2 animate-bounce-horizontal" />
              </Link>
            </Button>
            <Button 
              size="lg" 
              variant="ghost" 
              className="text-foreground/80 hover:text-foreground hover:bg-card/80 px-10 h-13 text-base rounded-full border border-border/80 backdrop-blur-sm transition-all duration-300 shadow-[0_4px_15px_rgba(0,0,0,0.15)]" 
              asChild
            >
              <Link href="/login">已有账号？登录</Link>
            </Button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-8 px-6">
        <div className="max-w-4xl mx-auto flex flex-col items-center gap-4 text-center">
          <div className="flex items-center gap-6 text-sm text-foreground/40">
            <a 
              href="https://github.com/genz27/sanhub" 
              target="_blank" 
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              GitHub
            </a>
            <span>·</span>
            <span>{siteConfig.contactEmail}</span>
          </div>
          <p className="text-xs text-foreground/30">
            {siteConfig.copyright} · {siteConfig.poweredBy}
          </p>
        </div>
      </footer>
    </div>
  );
}
