import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { blogSource } from '@/lib/blog-source';
import { getMDXComponents } from '@/components/mdx';
import { blogRoute } from '@/lib/shared';
import { formatAuthors, formatDate } from '@/lib/format';

export function generateStaticParams() {
  return blogSource.getPages().map((post) => ({ slug: post.slugs[0] }));
}

export async function generateMetadata(props: PageProps<'/blog/[slug]'>): Promise<Metadata> {
  const params = await props.params;
  const post = blogSource.getPage([params.slug]);
  if (!post) return {};
  return {
    title: post.data.title,
    description: post.data.description,
  };
}

export default async function BlogPostPage(props: PageProps<'/blog/[slug]'>) {
  const params = await props.params;
  const post = blogSource.getPage([params.slug]);
  if (!post) notFound();

  const MDX = post.data.body;

  return (
    <article className="max-w-[710px] mx-auto w-full px-6 md:px-8 pt-16 pb-24">
      <Link
        href={blogRoute}
        className="inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground hover:text-fd-foreground no-underline mb-8"
      >
        <ArrowLeft className="size-4" />
        Back to blog
      </Link>

      <header className="mb-10">
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight m-0">{post.data.title}</h1>
        {post.data.description && (
          <p className="text-lg text-fd-muted-foreground mt-4 m-0">{post.data.description}</p>
        )}
        <div className="flex items-center gap-3 mt-6 text-sm text-fd-muted-foreground flex-wrap">
          <span className="font-medium text-fd-foreground">{formatAuthors(post.data.author)}</span>
          <span aria-hidden>·</span>
          <time dateTime={new Date(post.data.date).toISOString()}>{formatDate(post.data.date)}</time>
          {post.data.tags && post.data.tags.length > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{post.data.tags.join(', ')}</span>
            </>
          )}
        </div>
      </header>

      <div className="prose prose-invert max-w-none">
        <MDX components={getMDXComponents()} />
      </div>
    </article>
  );
}
