import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { blogSource } from '@/lib/blog-source';
import { siteUrl } from '@/lib/shared';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const abs = (path: string) => new URL(path, siteUrl).toString();

  const staticRoutes = ['/', '/docs', '/blog'].map((route) => ({ url: abs(route) }));
  const docRoutes = source.getPages().map((page) => ({ url: abs(page.url) }));
  const blogRoutes = blogSource.getPages().map((post) => ({ url: abs(post.url) }));

  return [...staticRoutes, ...docRoutes, ...blogRoutes];
}
