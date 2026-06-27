import type { Metadata } from 'next';
import { RedeemMount } from '@/redeem/RedeemMount';
import { appName } from '@/lib/shared';

export const metadata: Metadata = {
  title: `Claim a payment | ${appName}`,
  description:
    'Load a signed subscription or stream and redeem it on-chain — the payee charges, capped by the signed caveat.',
};

// Standalone biller console: its own full-screen header and wallet flow, served
// outside the (home) nav/footer chrome.
export default function RedeemPage() {
  return <RedeemMount />;
}
