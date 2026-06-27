'use client';

import dynamic from 'next/dynamic';

// Reads on-chain logs at runtime, so it must not run during static prerender.
const AnalyticsDashboard = dynamic(() => import('./AnalyticsDashboard').then((m) => m.AnalyticsDashboard), {
  ssr: false,
  loading: () => <div className="min-h-[calc(100vh-56px)]" />,
});

export function AnalyticsMount() {
  return <AnalyticsDashboard />;
}
