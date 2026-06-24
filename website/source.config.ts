import { defineCollections, defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
  },
  meta: {
    schema: metaSchema,
  },
});

export const blog = defineCollections({
  type: 'doc',
  dir: 'content/blog',
  schema: pageSchema.extend({
    // Accept a single author or a list of co-authors.
    author: z.string().or(z.array(z.string())),
    date: z.string().date().or(z.date()),
    tags: z.array(z.string()).optional(),
    // Accepts a full URL (external CDN) or a local path under /public.
    cover_image: z.string().optional(),
  }),
});

export default defineConfig({
  mdxOptions: {},
});
