import astroSlidev from "astro-slidev";
import { defineConfig } from "vite";

export default defineConfig({
  // @ts-expect-error:
  slidev: {
    components: {
      extensions: ["vue", "astro"],
    },
  },
  plugins: [astroSlidev()],
});
