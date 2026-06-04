import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import { Providers } from '@/components/providers';
import { getPublicSiteConfig } from '@/lib/site-config';

// Disable caching to always get fresh config
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const siteConfig = await getPublicSiteConfig();
  
  return {
    title: `${siteConfig.siteName} - AI 内容生成平台`,
    description: siteConfig.siteDescription,
    icons: {
      icon: '/favicon.ico',
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialSiteConfig = await getPublicSiteConfig();
  
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {`
            try {
              var theme = localStorage.getItem('sanhub-theme') || 'system';
              var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
              var resolved = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
              document.documentElement.classList.toggle('dark', resolved === 'dark');
              document.documentElement.dataset.theme = resolved;
            } catch (error) {}
          `}
        </Script>
      </head>
      <body className="antialiased">
        <Providers initialSiteConfig={initialSiteConfig}>{children}</Providers>
      </body>
    </html>
  );
}
