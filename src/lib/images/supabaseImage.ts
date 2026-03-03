import { env } from '$env/dynamic/public';

const OBJECT_PUBLIC_SEGMENT = '/storage/v1/object/public';
const OBJECT_PUBLIC_PATH_SEGMENT = '/storage/v1/object/public/';
const RENDER_PUBLIC_SEGMENT = '/storage/v1/render/image/public';
const RENDER_PUBLIC_PATH_SEGMENT = '/storage/v1/render/image/public/';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const normalizeUrl = (value: string | null | undefined): string | undefined => {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	return trimTrailingSlash(trimmed);
};

const buildDefaultPublicImageBaseUrl = () => {
	const publicSupabaseUrl = normalizeUrl(env.PUBLIC_SUPABASE_URL);
	if (!publicSupabaseUrl) return undefined;
	return `${publicSupabaseUrl}${OBJECT_PUBLIC_SEGMENT}`;
};

export const SUPABASE_IMAGE_BASE_URL =
	normalizeUrl(env.PUBLIC_SUPABASE_IMAGE_BASE_URL) ?? buildDefaultPublicImageBaseUrl();

export const SUPABASE_IMAGE_RENDER_BASE_URL = SUPABASE_IMAGE_BASE_URL?.includes(
	OBJECT_PUBLIC_SEGMENT
)
	? SUPABASE_IMAGE_BASE_URL.replace(OBJECT_PUBLIC_SEGMENT, RENDER_PUBLIC_SEGMENT)
	: undefined;

export type TransformOptions = {
	width?: number;
	height?: number;
	quality?: number;
	resize?: 'cover' | 'contain' | 'fill';
};

const appendTransformParams = (params: URLSearchParams, options: TransformOptions) => {
	if (typeof options.width === 'number' && Number.isFinite(options.width) && options.width > 0) {
		params.set('width', String(Math.round(options.width)));
	}
	if (typeof options.height === 'number' && Number.isFinite(options.height) && options.height > 0) {
		params.set('height', String(Math.round(options.height)));
	}
	if (
		typeof options.quality === 'number' &&
		Number.isFinite(options.quality) &&
		options.quality > 0
	) {
		params.set('quality', String(Math.round(options.quality)));
	}
	if (options.resize) {
		params.set('resize', options.resize);
	}
};

const appendMissingTransformParams = (params: URLSearchParams, options: TransformOptions) => {
	if (
		typeof options.width === 'number' &&
		Number.isFinite(options.width) &&
		options.width > 0 &&
		!params.has('width')
	) {
		params.set('width', String(Math.round(options.width)));
	}
	if (
		typeof options.height === 'number' &&
		Number.isFinite(options.height) &&
		options.height > 0 &&
		!params.has('height')
	) {
		params.set('height', String(Math.round(options.height)));
	}
	if (
		typeof options.quality === 'number' &&
		Number.isFinite(options.quality) &&
		options.quality > 0 &&
		!params.has('quality')
	) {
		params.set('quality', String(Math.round(options.quality)));
	}
	if (options.resize && !params.has('resize')) {
		params.set('resize', options.resize);
	}
};

const normalizeSupabasePath = (path: string) => path.replace(/^\/+/, '');

export const getOriginalImageUrl = (url: string | null | undefined) => url?.trim() ?? '';

export const buildSupabaseImageSrc = (path: string, options?: TransformOptions) => {
	const encodedPath = encodeURI(normalizeSupabasePath(path));

	if (options && SUPABASE_IMAGE_RENDER_BASE_URL) {
		const params = new URLSearchParams();
		appendTransformParams(params, options);
		const query = params.toString();
		return `${SUPABASE_IMAGE_RENDER_BASE_URL}/${encodedPath}${query ? `?${query}` : ''}`;
	}

	return SUPABASE_IMAGE_BASE_URL ? `${SUPABASE_IMAGE_BASE_URL}/${encodedPath}` : encodedPath;
};

export const transformSupabasePublicUrl = (
	url: string | null | undefined,
	options?: TransformOptions
) => {
	if (!url) return '';

	const trimmedUrl = url.trim();
	if (!trimmedUrl) return '';

	const renderUrl = trimmedUrl.includes(OBJECT_PUBLIC_PATH_SEGMENT)
		? trimmedUrl.replace(OBJECT_PUBLIC_PATH_SEGMENT, RENDER_PUBLIC_PATH_SEGMENT)
		: trimmedUrl;

	if (!options || renderUrl === trimmedUrl) {
		return renderUrl;
	}

	const hashIndex = renderUrl.indexOf('#');
	const hash = hashIndex >= 0 ? renderUrl.slice(hashIndex) : '';
	const withoutHash = hashIndex >= 0 ? renderUrl.slice(0, hashIndex) : renderUrl;
	const queryIndex = withoutHash.indexOf('?');
	const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
	const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';
	const params = new URLSearchParams(query);
	appendMissingTransformParams(params, options);
	const nextQuery = params.toString();

	return `${base}${nextQuery ? `?${nextQuery}` : ''}${hash}`;
};

const uniqueSortedWidths = (widths: readonly number[]) =>
	Array.from(new Set(widths.filter((width) => Number.isFinite(width) && width > 0))).sort(
		(a, b) => a - b
	);

export const buildSupabaseImageSrcSet = (
	path: string,
	widths: readonly number[],
	options: Omit<TransformOptions, 'width'> = {}
) => {
	if (!SUPABASE_IMAGE_RENDER_BASE_URL) return undefined;

	const candidates = uniqueSortedWidths(widths);
	if (candidates.length === 0) return undefined;

	return candidates
		.map((width) => `${buildSupabaseImageSrc(path, { ...options, width })} ${width}w`)
		.join(', ');
};

export const transformSupabasePublicUrlSrcSet = (
	url: string | null | undefined,
	widths: readonly number[],
	options: Omit<TransformOptions, 'width'> = {}
) => {
	if (!url || !url.includes(OBJECT_PUBLIC_PATH_SEGMENT)) return undefined;

	const candidates = uniqueSortedWidths(widths);
	if (candidates.length === 0) return undefined;

	return candidates
		.map((width) => `${transformSupabasePublicUrl(url, { ...options, width })} ${width}w`)
		.join(', ');
};

export const supabaseImagePresets = {
	gallery: { width: 1280, quality: 80, resize: 'contain' as const },
	avatarCard: { width: 640, height: 640, quality: 78, resize: 'cover' as const },
	avatarList: { width: 96, height: 96, quality: 72, resize: 'cover' as const },
	avatarProfile: { width: 720, height: 720, quality: 80, resize: 'cover' as const },
	avatarPrint: { width: 480, height: 480, quality: 74, resize: 'contain' as const }
};

export const supabaseImageSrcsetWidths = {
	gallery: [320, 480, 640, 768, 1024, 1280] as const,
	avatarCard: [240, 320, 480, 640, 768] as const,
	avatarList: [40, 72, 96, 128] as const,
	avatarProfile: [240, 320, 480, 640, 768] as const,
	avatarPrint: [160, 240, 320, 480] as const
};

export const supabaseImageSizes = {
	avatarCard: '(min-width: 1280px) 24vw, (min-width: 1024px) 32vw, (min-width: 640px) 48vw, 100vw',
	avatarProfile: '(min-width: 1024px) 320px, (min-width: 768px) 280px, 52vw',
	avatarPrint: '170px'
} as const;

export const applyImageFallbackOnce = (
	event: Event,
	fallbackUrl: string | null | undefined
): void => {
	const target = event.currentTarget as HTMLImageElement | null;
	if (!target) return;

	const fallbackSrc = fallbackUrl?.trim();
	if (!fallbackSrc) {
		target.removeAttribute('srcset');
		return;
	}

	const currentSrc = target.currentSrc || target.src;
	const hasSrcset = Boolean(target.getAttribute('srcset'));
	if (currentSrc === fallbackSrc && !hasSrcset) {
		return;
	}

	target.removeAttribute('srcset');
	target.src = fallbackSrc;
};
