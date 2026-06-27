import type { Metadata } from 'next';
import { StandaloneRedeem } from '@/redeem/StandaloneRedeem';
import { appName } from '@/lib/shared';

export const metadata: Metadata = {
  title: `Claim a payment | ${appName}`,
  description:
    'Load a signed subscription or stream and redeem it on-chain — the payee charges, capped by the signed caveat.',
};

export default function RedeemPage() {
  return <StandaloneRedeem />;
}
