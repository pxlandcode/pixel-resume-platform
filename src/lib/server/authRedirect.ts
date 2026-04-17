const ALLOWED_APP_REDIRECT_PATTERN =
	/^\/(?:$|users(?:\/.*)?$|talents(?:\/.*)?$|resumes(?:\/.*)?$|organisations(?:\/.*)?$|settings(?:\/.*)?$|legal(?:\/.*)?$)/;

export const isAllowedAppRedirect = (value: unknown): value is string =>
	typeof value === 'string' && ALLOWED_APP_REDIRECT_PATTERN.test(value);

export const normalizeAppRedirect = (value: unknown, fallback = '/') =>
	isAllowedAppRedirect(value) ? value : fallback;
