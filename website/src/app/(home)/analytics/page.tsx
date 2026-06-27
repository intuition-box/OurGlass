import type { Metadata } from 'next';
import { AnalyticsMount } from '@/analytics/AnalyticsMount';

export const metadata: Metadata = {
  title: 'Analytics',
  description:
    'On-chain, verifiable metrics for OurGlass — charge and claim counts, token volume, and breakdowns read straight from the OurGlass enforcer instances, no backend.',
};

export default function AnalyticsPage() {
  return <AnalyticsMount />;
}
