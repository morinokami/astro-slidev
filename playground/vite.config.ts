// Slidev consumes this config. `vite` itself is not a direct dep here, so we
// avoid importing `defineConfig` and just export a plain config object.
export default {
  slidev: {
    components: {
      extensions: ["vue", "md", "js", "ts", "jsx", "tsx", "astro"],
      include: [/\.vue$/, /\.vue\?vue/, /\.vue\?v=/, /\.md$/, /\.md\?vue/, /\.astro$/],
    },
  },
};
