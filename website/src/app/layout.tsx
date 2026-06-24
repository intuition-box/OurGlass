import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './global.css';
import { appName, siteUrl } from '@/lib/shared';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: appName, template: `%s | ${appName}` },
  description:
    'Recurring on-chain payments for Safe — sign once, charged per period, capped on-chain, with the agreement pinned to IPFS.',
  openGraph: { type: 'website', url: siteUrl, siteName: appName },
  twitter: { card: 'summary_large_image' },
  icons: { icon: '/logo.svg' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${sans.className}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <RootProvider
          theme={{ defaultTheme: 'dark', enableSystem: false }}
          // Static export has no /api/search route; disable hosted search for now.
          // Re-enable with the static search adapter in a follow-up.
          search={{ enabled: false }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
