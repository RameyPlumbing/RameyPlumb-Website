// @ts-check
import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel/serverless";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://rameyplumb.com",
  output: "hybrid",
  adapter: vercel({
    webAnalytics: { enabled: true },
    imageService: true,
  }),
  vite: {
    // Cast because @tailwindcss/vite ships its own Vite type version which can
    // disagree with Astro's bundled Vite types. Runtime is fine.
    plugins: [/** @type {any} */ (tailwindcss())],
  },
});
