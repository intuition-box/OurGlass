import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Analytics',
  description: 'On-chain, verifiable metrics for OurGlass agreements — coming soon.',
};

export default function AnalyticsPage() {
  return (
    <section className="relative mx-auto flex min-h-[calc(100vh-56px)] max-w-3xl flex-col justify-center px-6 py-24 md:px-8">
      {/* signature stream rail */}
      <div className="stream-edge absolute left-0 top-0 h-full w-px" aria-hidden="true" />

      <span className="inline-flex w-fit items-center gap-2 rounded-full border border-fd-border px-3 py-1 text-xs font-medium text-[color:var(--accent)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
        Coming soon
      </span>

      <h1 className="mt-6 text-4xl font-semibold tracking-tight md:text-5xl">Analytics</h1>

      <p className="mt-4 max-w-xl text-lg text-fd-muted-foreground">
        A decentralized, verifiable view of OurGlass activity — charge and claim
        counts, token volume over time, broken down by agreement, receiver, payer,
        and token. All derived from public on-chain data, with no private backend.
      </p>

      <p className="mt-3 max-w-xl text-sm text-fd-muted-foreground">
        Read the approach in the{' '}
        <Link href="/docs/analytics" className="text-fd-foreground underline underline-offset-4 hover:text-[color:var(--accent)]">
          analytics design notes
        </Link>
        .
      </p>
    </section>
  );
}
