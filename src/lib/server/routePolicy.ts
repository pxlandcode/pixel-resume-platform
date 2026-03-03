import type { AppRole } from '$lib/server/access';

const DATA_PATH_SUFFIX = '/__data.json';

const normalizeTrailingSlash = (pathname: string) => pathname.replace(/\/$/, '') || '/';

export const normalizePolicyPathname = (pathname: string) => {
	const normalized = normalizeTrailingSlash(pathname);
	if (normalized === '/__data.json') return '/';
	if (normalized.endsWith(DATA_PATH_SUFFIX)) {
		const basePath = normalized.slice(0, -DATA_PATH_SUFFIX.length);
		return basePath || '/';
	}
	return normalized;
};

export const isDataRequestPathname = (pathname: string) => {
	const normalized = normalizeTrailingSlash(pathname);
	return normalized === '/__data.json' || normalized.endsWith(DATA_PATH_SUFFIX);
};

export const isPublicPagePath = (pathname: string) =>
	pathname === '/login' || pathname === '/reset-password' || pathname.startsWith('/print/');

const managedAppPathPatterns: RegExp[] = [
	/^\/$/,
	/^\/users(\/.*)?$/,
	/^\/organisations(\/.*)?$/,
	/^\/settings(\/.*)?$/,
	/^\/talents(\/.*)?$/,
	/^\/resumes(\/.*)?$/,
	/^\/legal(\/.*)?$/
];

export const isManagedAppPath = (pathname: string) =>
	isPublicPagePath(pathname) || managedAppPathPatterns.some((pattern) => pattern.test(pathname));

const roleGuards: Array<{ pattern: RegExp; roles: AppRole[] }> = [
	{ pattern: /^\/$/, roles: ['admin', 'broker', 'talent', 'employer'] },
	{ pattern: /^\/users(\/.*)?$/, roles: ['admin', 'broker', 'employer'] },
	{ pattern: /^\/organisations(\/.*)?$/, roles: ['admin'] },
	{ pattern: /^\/settings(\/.*)?$/, roles: ['admin'] },
	{ pattern: /^\/talents(\/.*)?$/, roles: ['admin', 'broker', 'talent', 'employer'] },
	{ pattern: /^\/resumes(\/.*)?$/, roles: ['admin', 'broker', 'talent', 'employer'] }
];

export const guardRoute = (pathname: string, roles: AppRole[]): string | null => {
	const match = roleGuards.find((guard) => guard.pattern.test(pathname));
	if (!match) return null;

	const allowed = roles.some((role) => match.roles.includes(role));
	if (allowed) return null;

	if (roles.includes('talent') || roles.includes('employer')) {
		return '/';
	}

	return '/?unauthorized=1';
};
