import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isUserOrOrgPagesRepo = repoName.endsWith('.github.io');
const hasCustomDomain = existsSync('public/CNAME');
const buildId =
	process.env.BUILD_ID ??
	process.env.GITHUB_SHA?.slice(0, 12) ??
	`${Date.now()}`;

export default defineConfig({
	base:
		process.env.GITHUB_ACTIONS === 'true'
			? hasCustomDomain || isUserOrOrgPagesRepo
				? '/'
				: `/${repoName}/`
			: '/',
	plugins: [
		{
			name: 'cache-bust-public-main-entry',
			transformIndexHtml(html) {
				const cacheBusted = `/main.js?v=${encodeURIComponent(buildId)}`;
				return html.replace(/\/main\.js(?:\?[^"'>]*)?/g, cacheBusted);
			},
		},
	],
});
