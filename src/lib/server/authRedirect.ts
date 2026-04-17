const ALLOWED_APP_REDIRECT_PATTERN =
	/^\/(?:$|users(?:\/.*)?$|talents(?:\/.*)?$|resumes(?:\/.*)?$|organisations(?:\/.*)?$|settings(?:\/.*)?$|legal(?:\/.*)?$)/;

export const isAllowedAppRedirect = (value: unknown): value is string =>
	typeof value === 'string' && ALLOWED_APP_REDIRECT_PATTERN.test(value);

export const normalizeAppRedirect = (value: unknown, fallback = '/') =>
	isAllowedAppRedirect(value) ? value : fallback;

const readForwardedHeaderValue = (headers: Headers, name: string) =>
	headers
		.get(name)
		?.split(',')
		.map((value) => value.trim())
		.find(Boolean) ?? null;

export const resolvePublicOrigin = (payload: { url: URL; headers: Headers }) => {
	const forwardedHost = readForwardedHeaderValue(payload.headers, 'x-forwarded-host');
	const forwardedProto = readForwardedHeaderValue(payload.headers, 'x-forwarded-proto');

	if (forwardedHost) {
		return `${forwardedProto ?? 'https'}://${forwardedHost}`;
	}

	return payload.url.origin;
};
