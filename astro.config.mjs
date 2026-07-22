import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { DEFAULT_SITE_URL } from './src/lib/site-url.mjs';

const site = process.env.SITE_URL ?? DEFAULT_SITE_URL;

export default defineConfig({
  site,
  output: 'static',
  integrations: [sitemap()],
});
