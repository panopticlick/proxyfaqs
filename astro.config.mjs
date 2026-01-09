import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import { z } from 'zod';

const buildEnv = z
  .object({
    SITE_URL: z.string().url().default('https://proxyfaqs.com'),
    BUILD_CHUNK_SIZE: z.string().default('5000'),
    BUILD_PARALLEL: z.string().default('true'),
  })
  .parse(process.env);

const BUILD_CHUNK_SIZE = Number.parseInt(buildEnv.BUILD_CHUNK_SIZE, 10);
const BUILD_PARALLEL = buildEnv.BUILD_PARALLEL === 'true';

export default defineConfig({
  site: buildEnv.SITE_URL,
  integrations: [
    tailwind(),
    sitemap({
      filter: (page) => !page.includes('/api/'),
      changefreq: 'weekly',
      priority: 0.7,
    }),
  ],
  output: 'static',
  build: {
    format: 'directory',
    assets: '_assets',
  },
  vite: {
    define: {
      'import.meta.env.SITE_URL': JSON.stringify(buildEnv.SITE_URL),
      'import.meta.env.BUILD_CHUNK_SIZE': JSON.stringify(BUILD_CHUNK_SIZE),
    },
    // Parallel build optimization
    build: {
      minify: 'esbuild',
      target: 'es2020',
      cssMinify: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Vendor chunking for better caching
            if (id.includes('node_modules')) {
              if (id.includes('@astrojs')) {
                return 'astro-vendor';
              }
              return 'vendor';
            }
          },
        },
      },
    },
    // Optimize CSS processing
    css: {
      devSourcemap: false,
    },
  },
});
