import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  // Static export: the site is landing + docs + blog with no dynamic data, so it
  // ships as static files served by Caddy alongside the Vite Safe App. Keeps the
  // container single-process (no Node runtime) and the Coolify config unchanged.
  output: 'export',
  reactStrictMode: true,
  // This repo nests a second package (the Vite app) with its own lockfile;
  // pin the Turbopack root to the website so Next picks the right workspace.
  turbopack: { root: import.meta.dirname },
  // next/image cannot use the optimizer under static export.
  images: { unoptimized: true },
};

export default withMDX(config);
