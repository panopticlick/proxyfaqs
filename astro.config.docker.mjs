import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import node from "@astrojs/node";
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
  ],
  output: "hybrid",
  adapter: node({
    mode: "standalone",
  }),
  build: {
    format: 'directory',
    assets: '_assets',
  },
  vite: {
    define: {
      "import.meta.env.SITE_URL": JSON.stringify(buildEnv.SITE_URL),
    },
  },
});
