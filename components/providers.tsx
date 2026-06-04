'use client';

import { Toaster } from '@/components/ui/toaster';
import { SiteConfigProvider, type ExtendedSiteConfig } from '@/components/providers/site-config-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';

interface ProvidersProps {
  children: React.ReactNode;
  initialSiteConfig?: ExtendedSiteConfig;
}

export function Providers({ children, initialSiteConfig }: ProvidersProps) {
  return (
    <ThemeProvider>
      <SiteConfigProvider initialConfig={initialSiteConfig}>
        {children}
        <Toaster />
      </SiteConfigProvider>
    </ThemeProvider>
  );
}
