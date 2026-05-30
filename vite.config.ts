import { defineConfig } from 'vite';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const isUserOrOrgPagesRepo = repoName.endsWith('.github.io');

export default defineConfig({
	base:
		process.env.GITHUB_ACTIONS === 'true'
			? isUserOrOrgPagesRepo
				? '/'
				: `/${repoName}/`
			: '/',
});
