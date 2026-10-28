import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// The app is a fully static single-page app: all data comes from Supabase at runtime,
// so it can be hosted anywhere (GitHub Pages by default, see .github/workflows/deploy.yml).
// BASE_PATH is set by the deploy workflow to `/<repo-name>` for GitHub Pages project sites.
const base = (process.env.BASE_PATH ?? '') as '' | `/${string}`;

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// 404.html is what GitHub Pages serves for unknown paths, so deep links work.
			adapter: adapter({ fallback: '404.html' }),
			paths: { base }
		})
	]
});
