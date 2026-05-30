import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isUserOrOrgPagesRepo = repoName.endsWith('.github.io');
const hasCustomDomain = existsSync('public/CNAME');

export default defineConfig({
	base:
		process.env.GITHUB_ACTIONS === 'true'
			? hasCustomDomain || isUserOrOrgPagesRepo
				? '/'
				: `/${repoName}/`
			: '/',
});
