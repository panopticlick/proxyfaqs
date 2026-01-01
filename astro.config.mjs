import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://proxyfaqs.com",
  integrations: [
    tailwind(),
    sitemap({
      filter: (page) => !page.includes("/api/"),
      changefreq: "weekly",
      priority: 0.7,
    }),
  ],
  output: "static",
  build: {
    format: "directory",
  },
  vite: {
    define: {
      "import.meta.env.SITE_URL": JSON.stringify(
        process.env.SITE_URL || "https://proxyfaqs.com",
      ),
    },
  },
});
