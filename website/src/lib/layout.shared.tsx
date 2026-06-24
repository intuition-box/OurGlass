import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from '@/components/logo';
import { XIcon } from '@/components/brand-icons';
import { analyticsRoute, blogRoute, docsRoute, githubUrl, redeemRoute, twitterUrl } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo size={22} />,
    },
    links: [
      { text: 'Docs', url: docsRoute, active: 'nested-url' },
      { text: 'Blog', url: blogRoute, active: 'nested-url' },
      { text: 'Analytics', url: analyticsRoute, active: 'nested-url' },
      { text: 'Claim a payment', url: redeemRoute, active: 'none' },
      {
        type: 'icon',
        text: 'X',
        label: 'Follow us on X',
        url: twitterUrl,
        external: true,
        icon: <XIcon className="size-4" />,
      },
    ],
    githubUrl,
    // Dark-first; the toggle stays hidden until a light theme is designed.
    themeSwitch: { enabled: false },
  };
}
