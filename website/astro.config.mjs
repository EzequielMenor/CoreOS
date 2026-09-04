import { defineConfig } from "astro/config";

export default defineConfig({
	site: "https://github.com/EzequielMenor/CoreOS",
	trailingSlash: "never",

	vite: {
		build: {
			rolldownOptions: {
				tsconfig: "./tsconfig.json",
			},
		},
	},
});
