
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import mdx from '@astrojs/mdx';
import netlify from '@astrojs/netlify';

export default defineConfig({
  output: 'static',
  integrations: [tailwind(), mdx()],
  adapter: netlify(),
  site: 'https://whitcooper.com',
});
