import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import cloudflare from "@astrojs/cloudflare";
import { z } from "zod";

const buildEnv = z
  .object({
    SITE_URL: z.string().url().default("https://proxyfaqs.com"),
  })
  .parse(process.env);

export default defineConfig({
  site: buildEnv.SITE_URL,
  integrations: [
    tailwind(),
    sitemap({
      filter: (page) => !page.includes("/api/"),
      changefreq: "weekly",
      priority: 0.7,
    }),
  ],
  output: "hybrid",
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
    },
  }),
  build: {
    format: "directory",
  },
  vite: {
    define: {
      "import.meta.env.SITE_URL": JSON.stringify(buildEnv.SITE_URL),
    },
  },
});
