import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';
import { Footer } from '@/components/footer';
import { WalletProviders } from '@/components/wallet/wallet-providers';
import { ConnectButton } from '@/components/wallet/connect-button';

export default function Layout({ children }: LayoutProps<'/'>) {
  const base = baseOptions();
  return (
    <WalletProviders>
      <HomeLayout
        {...base}
        links={[...(base.links ?? []), { type: 'custom', secondary: true, children: <ConnectButton /> }]}
      >
        <div className="flex flex-1 flex-col">
          <div className="flex-1">{children}</div>
          <Footer />
        </div>
      </HomeLayout>
    </WalletProviders>
  );
}
