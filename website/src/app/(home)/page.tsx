import Link from 'next/link';
import { SafeAppRedirect } from '@/components/safe-app-redirect';
import { redeemRoute, safeGlobalUrl } from '@/lib/shared';

const FEATURES: Array<{ lead: string; rest: string }> = [
  { lead: 'Sign once', rest: 'remove the monthly signing burden from your signers' },
  { lead: 'Capped on-chain', rest: 'never above the agreed amount, never twice' },
  { lead: 'Non-custodial', rest: 'funds stay in your Safe until the moment of charge' },
  { lead: 'Charged every period', rest: 'by the receiver, no subsequent signers needed' },
  { lead: 'Revocable', rest: 'cancel any agreement on-chain, at any time' },
];

export default function Home() {
  return (
    <>
      {/* When framed by Safe, hand off to the Vite app under /safe-app. */}
      <SafeAppRedirect />

      <section className="relative flex min-h-[calc(100vh-56px)] flex-col overflow-hidden px-6 pb-14 pt-12 sm:px-12">
        {/* signature: a thin live stream down the right edge */}
        <div className="stream-edge absolute right-0 top-0 z-20 h-full w-1" aria-hidden="true" />

        {/* background video — right half, full height, faded into the base */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 right-0 z-0 overflow-hidden" aria-hidden="true">
          <video className="hero-video h-full w-full object-cover" src="/hero.mp4" autoPlay muted loop playsInline />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, var(--color-base) 0%, rgba(10,10,11,0) 45%), linear-gradient(180deg, var(--color-base) 0%, rgba(10,10,11,0) 18%), linear-gradient(0deg, var(--color-base) 0%, rgba(10,10,11,0) 22%)',
            }}
          />
        </div>

        <div className="relative z-10 mt-12 max-w-[880px]">
          <h1 className="text-[clamp(40px,5.2vw,64px)] font-semibold leading-[1.12] tracking-[-1.5px]">
            Recurring payments
            <br />
            for DAO treasuries.
          </h1>

          <div className="mt-10 flex flex-wrap items-center gap-[18px]">
            <Link
              href={redeemRoute}
              className="group inline-flex items-stretch gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-line)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-base)]"
            >
              <span className="inline-flex h-12 items-center rounded-full bg-[#f5f5f7] px-7 text-base font-semibold text-[#111] transition-opacity group-hover:opacity-90">
                Claim your payment
              </span>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-[14px] bg-[#f5f5f7] text-[#111] transition-[border-radius,opacity] duration-200 group-hover:rounded-full group-hover:opacity-90">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M4 12h16" />
                  <path d="M13 5l7 7-7 7" />
                </svg>
              </span>
            </Link>

            <a
              href={safeGlobalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 items-center rounded-full border border-fd-border px-6 text-base font-medium text-fd-foreground transition-colors hover:bg-fd-accent"
            >
              Add to your Safe
            </a>
          </div>
        </div>

        <div className="relative z-10 mt-auto flex flex-col gap-3.5 pt-[120px]">
          {FEATURES.map((f) => (
            <p key={f.lead} className="text-[17px] text-fd-muted-foreground">
              <b className="mr-1.5 font-semibold text-fd-foreground">{f.lead}</b>
              {f.rest}
            </p>
          ))}
        </div>
      </section>
    </>
  );
}
