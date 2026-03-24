import type { RequestHandler } from './$types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { error, json } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient,
	getSupabasePublishableKey,
	getSupabaseUrl
} from '$lib/server/supabase';
import { ResumeService } from '$lib/services/resume';
import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';
import { getResumeEditPermissions } from '$lib/server/resumes/permissions';
import { assertAcceptedForSensitiveAction } from '$lib/server/legalGate';
import { writeAuditLog } from '$lib/server/legalService';
import { resolveResumeExportPolicy } from '$lib/server/resumes/exportPolicy';

const isServerless =
	Boolean(process.env.NETLIFY) ||
	Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
	Boolean(process.env.VERCEL) ||
	Boolean(process.env.CF_PAGES);
const DEFAULT_PDF_TARGET_MAX_BYTES = 1024 * 1024;
const parsedTargetSize = Number.parseInt(process.env.PDF_TARGET_MAX_BYTES ?? '', 10);
const PDF_TARGET_MAX_BYTES =
	Number.isFinite(parsedTargetSize) && parsedTargetSize >= 300 * 1024
		? parsedTargetSize
		: DEFAULT_PDF_TARGET_MAX_BYTES;
const PDF_IMAGE_BASE_MAX_WIDTH = 1000;
const PDF_IMAGE_BASE_MAX_HEIGHT = 1000;
const PDF_IMAGE_BASE_QUALITY = 0.72;
const PDF_IMAGE_AGGRESSIVE_MAX_WIDTH = 760;
const PDF_IMAGE_AGGRESSIVE_MAX_HEIGHT = 760;
const PDF_IMAGE_AGGRESSIVE_QUALITY = 0.62;
const PDF_IMAGE_EXTREME_MAX_WIDTH = 560;
const PDF_IMAGE_EXTREME_MAX_HEIGHT = 560;
const PDF_IMAGE_EXTREME_QUALITY = 0.46;
const PDF_AVATAR_GENTLE_MAX_WIDTH = 460;
const PDF_AVATAR_GENTLE_MAX_HEIGHT = 460;
const PDF_AVATAR_GENTLE_QUALITY = 0.8;
const PDF_AVATAR_LAST_RESORT_MAX_WIDTH = 360;
const PDF_AVATAR_LAST_RESORT_MAX_HEIGHT = 360;
const PDF_AVATAR_LAST_RESORT_QUALITY = 0.72;
const PDF_ALLOW_SVG_RASTERIZATION = process.env.PDF_ALLOW_SVG_RASTERIZATION === '1';
const RESUME_EXPORTS_BUCKET = (process.env.RESUME_EXPORTS_BUCKET ?? 'resume-exports').trim();
const EXPORT_SIGNED_URL_TTL_SECONDS = 60 * 10;

const toSafePathSegment = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 120) || 'resume';

const isHttpError = (err: unknown): err is { status: number } =>
	!!err && typeof err === 'object' && 'status' in err;

const resolveLocalChromePath = (): string | null => {
	const envPath =
		process.env.CHROMIUM_EXECUTABLE_PATH ||
		process.env.CHROME_PATH ||
		process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
	if (envPath && existsSync(envPath)) {
		return envPath;
	}

	const home = process.env.HOME ?? '';
	const platform = process.platform;
	const candidates =
		platform === 'darwin'
			? [
					'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
					'/Applications/Chromium.app/Contents/MacOS/Chromium',
					...(home
						? [join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')]
						: [])
				]
			: platform === 'win32'
				? [
						process.env.PROGRAMFILES
							? join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe')
							: '',
						process.env['PROGRAMFILES(X86)']
							? join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe')
							: '',
						process.env.LOCALAPPDATA
							? join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')
							: '',
						process.env.PROGRAMFILES
							? join(process.env.PROGRAMFILES, 'Chromium/Application/chrome.exe')
							: ''
					]
				: [
						'/usr/bin/google-chrome',
						'/usr/bin/google-chrome-stable',
						'/usr/bin/chromium',
						'/usr/bin/chromium-browser'
					];

	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) {
			return candidate;
		}
	}

	return null;
};

const launchBrowser = async (): Promise<import('playwright-core').Browser> => {
	if (!isServerless) {
		const localExecutablePath = resolveLocalChromePath();
		if (!localExecutablePath) {
			throw new Error(
				'Local Chromium executable not found. Set CHROME_PATH or PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.'
			);
		}
		return playwrightChromium.launch({ executablePath: localExecutablePath, headless: true });
	}

	const executablePath = await chromium.executablePath();
	if (!executablePath) {
		throw new Error('Chromium executable path not found');
	}

	const headless = chromium.headless === undefined ? true : Boolean(chromium.headless);
	const launchArgs = Array.isArray(chromium.args) ? [...chromium.args] : [];
	launchArgs.push('--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage');

	return playwrightChromium.launch({
		executablePath,
		headless,
		args: launchArgs
	});
};

const buildPdfBuffer = async (page: import('playwright-core').Page): Promise<Buffer> => {
	return page.pdf({
		format: 'A4',
		printBackground: true,
		preferCSSPageSize: true,
		margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
	});
};

const tryDownsampleLargeImages = async (
	page: import('playwright-core').Page,
	options: {
		maxWidth: number;
		maxHeight: number;
		quality: number;
		reencodeAll?: boolean;
		includeSvg?: boolean;
		preserveTransparency?: boolean;
	}
): Promise<{
	optimized: number;
	failed: number;
	skipped: number;
}> => {
	return page.evaluate(async (downsampleOptions) => {
		const waitForLoad = (img: HTMLImageElement) =>
			new Promise<void>((resolve) => {
				if (img.complete) {
					resolve();
					return;
				}
				img.addEventListener('load', () => resolve(), { once: true });
				img.addEventListener('error', () => resolve(), { once: true });
			});

		const maxWidth = Math.max(1, Math.round(downsampleOptions.maxWidth));
		const maxHeight = Math.max(1, Math.round(downsampleOptions.maxHeight));
		const quality = Math.min(1, Math.max(0.3, downsampleOptions.quality));
		const reencodeAll = Boolean(downsampleOptions.reencodeAll);
		const includeSvg = Boolean(downsampleOptions.includeSvg);
		const preserveTransparency = downsampleOptions.preserveTransparency !== false;
		let optimized = 0;
		let failed = 0;
		let skipped = 0;
		const images = Array.from(document.images);
		const hasTransparentPixels = (
			ctx: CanvasRenderingContext2D,
			width: number,
			height: number
		): boolean => {
			try {
				const imageData = ctx.getImageData(0, 0, width, height);
				const { data } = imageData;
				const sampleStep = Math.max(1, Math.floor(Math.max(width, height) / 128));
				for (let y = 0; y < height; y += sampleStep) {
					for (let x = 0; x < width; x += sampleStep) {
						const alpha = data[(y * width + x) * 4 + 3];
						if (alpha < 250) {
							return true;
						}
					}
				}
			} catch {
				// Ignore sampling failures and fall back to lossy mode.
			}
			return false;
		};

		for (const img of images) {
			await waitForLoad(img);

			const src = img.currentSrc || img.src;
			if (!src) {
				skipped += 1;
				continue;
			}
			const lowerSrc = src.toLowerCase();
			const looksSvg =
				lowerSrc.startsWith('data:image/svg') ||
				lowerSrc.endsWith('.svg') ||
				lowerSrc.includes('.svg?');
			if (looksSvg && !includeSvg) {
				skipped += 1;
				continue;
			}

			const width = img.naturalWidth;
			const height = img.naturalHeight;
			if (!width || !height) {
				failed += 1;
				continue;
			}

			if (!reencodeAll && width <= maxWidth && height <= maxHeight) {
				skipped += 1;
				continue;
			}

			const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
			const nextWidth = Math.max(1, Math.round(width * ratio));
			const nextHeight = Math.max(1, Math.round(height * ratio));

			const canvas = document.createElement('canvas');
			canvas.width = nextWidth;
			canvas.height = nextHeight;
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				failed += 1;
				continue;
			}

			let bitmap: ImageBitmap | null = null;
			try {
				// Fetching through JS avoids canvas tainting from cross-origin image tags,
				// and lets us recompress logos/image assets too.
				if (!src.startsWith('data:')) {
					const imageResponse = await fetch(src, {
						method: 'GET',
						mode: 'cors',
						credentials: 'omit',
						cache: 'force-cache'
					});
					if (imageResponse.ok) {
						const blob = await imageResponse.blob();
						const blobType = (blob.type || '').toLowerCase();
						const blobLooksSvg = blobType.includes('svg');
						if (blobLooksSvg && !includeSvg) {
							skipped += 1;
							continue;
						}
						try {
							bitmap = await createImageBitmap(blob);
						} catch (bitmapErr) {
							console.warn('[pdf] Failed to create bitmap from fetched image blob', bitmapErr);
						}
					}
				}

				if (bitmap) {
					ctx.drawImage(bitmap, 0, 0, nextWidth, nextHeight);
				} else {
					ctx.drawImage(img, 0, 0, nextWidth, nextHeight);
				}

				const hasTransparency =
					preserveTransparency && hasTransparentPixels(ctx, nextWidth, nextHeight);
				let dataUrl = '';
				if (hasTransparency) {
					const webpDataUrl = canvas.toDataURL(
						'image/webp',
						Math.min(0.82, Math.max(0.5, quality))
					);
					dataUrl = webpDataUrl.startsWith('data:image/webp')
						? webpDataUrl
						: canvas.toDataURL('image/png');
				} else {
					dataUrl = canvas.toDataURL('image/jpeg', quality);
				}
				img.src = dataUrl;
				img.removeAttribute('srcset');
				img.loading = 'eager';
				img.decoding = 'sync';
				optimized += 1;
			} catch (err) {
				console.warn('[pdf] Failed to downsample image in page context', err);
				failed += 1;
			} finally {
				bitmap?.close();
			}
		}

		return { optimized, failed, skipped };
	}, options);
};

const ensureAvatarReady = async (
	page: import('playwright-core').Page
): Promise<{ found: boolean; loaded: boolean; currentSrc: string | null }> => {
	return page.evaluate(async () => {
		const avatar = document.querySelector('[data-debug="avatar-image"]') as HTMLImageElement | null;
		if (!avatar) return { found: false, loaded: false, currentSrc: null };

		const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
		const waitForLoad = (img: HTMLImageElement) =>
			new Promise<void>((resolve) => {
				if (img.complete) {
					resolve();
					return;
				}
				img.addEventListener('load', () => resolve(), { once: true });
				img.addEventListener('error', () => resolve(), { once: true });
			});

		for (let i = 0; i < 60; i += 1) {
			if (avatar.complete && avatar.naturalWidth > 0) {
				return {
					found: true,
					loaded: true,
					currentSrc: avatar.currentSrc || avatar.src || null
				};
			}
			await wait(50);
		}

		// If the optimized source failed, forcing plain src often recovers quickly.
		if (avatar.getAttribute('srcset')) {
			const fallbackSrc = avatar.getAttribute('data-fallback-src');
			avatar.removeAttribute('srcset');
			if (fallbackSrc && fallbackSrc.trim().length > 0) {
				avatar.src = fallbackSrc;
			}
			await waitForLoad(avatar);
		}

		return {
			found: true,
			loaded: avatar.complete && avatar.naturalWidth > 0,
			currentSrc: avatar.currentSrc || avatar.src || null
		};
	});
};

const tryCompressAvatarImage = async (
	page: import('playwright-core').Page,
	options: {
		maxWidth: number;
		maxHeight: number;
		quality: number;
	}
): Promise<{ changed: boolean; reason?: string; width?: number; height?: number }> => {
	return page.evaluate(async (avatarOptions) => {
		const avatar = document.querySelector('[data-debug="avatar-image"]') as HTMLImageElement | null;
		if (!avatar) return { changed: false, reason: 'avatar-not-found' };

		const waitForLoad = (img: HTMLImageElement) =>
			new Promise<void>((resolve) => {
				if (img.complete) {
					resolve();
					return;
				}
				img.addEventListener('load', () => resolve(), { once: true });
				img.addEventListener('error', () => resolve(), { once: true });
			});

		await waitForLoad(avatar);

		const width = avatar.naturalWidth;
		const height = avatar.naturalHeight;
		if (!width || !height) {
			return { changed: false, reason: 'avatar-not-loaded' };
		}

		const maxWidth = Math.max(1, Math.round(avatarOptions.maxWidth));
		const maxHeight = Math.max(1, Math.round(avatarOptions.maxHeight));
		const quality = Math.min(1, Math.max(0.5, avatarOptions.quality));
		const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
		const nextWidth = Math.max(1, Math.round(width * ratio));
		const nextHeight = Math.max(1, Math.round(height * ratio));

		const canvas = document.createElement('canvas');
		canvas.width = nextWidth;
		canvas.height = nextHeight;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return { changed: false, reason: 'missing-canvas-context' };
		}

		try {
			ctx.drawImage(avatar, 0, 0, nextWidth, nextHeight);
			avatar.src = canvas.toDataURL('image/jpeg', quality);
			avatar.removeAttribute('srcset');
			avatar.loading = 'eager';
			avatar.decoding = 'sync';
			return { changed: true, width: nextWidth, height: nextHeight };
		} catch (err) {
			console.warn('[pdf] Failed to compress avatar image in page context', err);
			return { changed: false, reason: 'compression-failed' };
		}
	}, options);
};

const buildExportObjectPath = ({
	userId,
	resumeId,
	filename
}: {
	userId: string;
	resumeId: string;
	filename: string;
}): string => {
	const safeFilename = toSafePathSegment(filename.replace(/\.pdf$/i, ''));
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	return `resume-exports/${toSafePathSegment(userId)}/${toSafePathSegment(resumeId)}/${timestamp}-${safeFilename}.pdf`;
};

const PDF_FILENAME = async (id: string, organisationSlug: string | null) => {
	try {
		const resume = await ResumeService.getResume(id);
		if (!resume) {
			console.error('[pdf] Resume not found for ID:', id);
			return 'Resume.pdf';
		}
		const person = await ResumeService.getPerson(resume.personId);
		const nameSlug = toSafePathSegment(person?.name ?? 'resume');
		const orgSlug = toSafePathSegment(organisationSlug ?? '');
		const filename = orgSlug ? `${nameSlug}-${orgSlug}-resume.pdf` : `${nameSlug}-resume.pdf`;
		console.log('[pdf] Generated filename:', filename);
		return filename;
	} catch (err) {
		console.error('[pdf] Error generating filename:', err);
		return 'Resume.pdf';
	}
};

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const resumeId = params.id;
	if (!resumeId) {
		throw error(400, 'Invalid resume id');
	}
	const lang = url.searchParams.get('lang') ?? 'sv';
	const debugEnabled = url.searchParams.get('debug') === '1';
	console.log('[pdf debug] request received', {
		resumeId,
		lang,
		debugEnabled,
		query: url.search
	});
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();
	if (!supabase || !adminClient) {
		throw error(401, 'Unauthorized');
	}

	const { data: resumeOwner } = await adminClient
		.from('resumes')
		.select('talent_id')
		.eq('id', resumeId)
		.maybeSingle();
	if (!resumeOwner?.talent_id) {
		throw error(404, 'Resume not found');
	}

	const permissions = await getResumeEditPermissions(supabase, adminClient, resumeOwner.talent_id);
	if (!permissions.canView) {
		throw error(403, 'Not authorized to view this resume.');
	}
	if (!permissions.userId) {
		throw error(401, 'Unauthorized');
	}

	await assertAcceptedForSensitiveAction({
		adminClient,
		userId: permissions.userId,
		homeOrganisationId: permissions.homeOrganisationId
	});

	const exportPolicy = await resolveResumeExportPolicy(adminClient, permissions);
	const auditOrganisationId =
		exportPolicy.sourceOrganisationId ?? exportPolicy.targetOrganisationId ?? null;
	if (!auditOrganisationId) {
		throw error(400, 'Resume export requires a linked source or target organisation.');
	}
	let sourceOrganisationSlug: string | null = null;
	if (exportPolicy.sourceOrganisationId) {
		const { data: sourceOrg, error: sourceOrgError } = await adminClient
			.from('organisations')
			.select('slug')
			.eq('id', exportPolicy.sourceOrganisationId)
			.maybeSingle();
		if (sourceOrgError) {
			console.warn('[pdf] Could not resolve source organisation slug', {
				resumeId,
				sourceOrganisationId: exportPolicy.sourceOrganisationId,
				error: sourceOrgError.message
			});
		} else {
			const rawSlug = (sourceOrg as { slug?: string } | null)?.slug ?? '';
			sourceOrganisationSlug = rawSlug.trim().length > 0 ? rawSlug.trim() : null;
		}
	}

	let browser: import('playwright-core').Browser | null = null;
	let uploadedObjectPath: string | null = null;

	try {
		browser = await launchBrowser();

		const page = await browser.newPage({
			viewport: { width: 1123, height: 1587 }
		});
		if (debugEnabled) {
			page.on('console', (message) => {
				console.log('[pdf debug][page console]', {
					type: message.type(),
					text: message.text()
				});
			});
			page.on('pageerror', (pageError) => {
				console.error('[pdf debug][page error]', pageError);
			});
			page.on('requestfailed', (request) => {
				console.warn('[pdf debug][request failed]', {
					url: request.url(),
					method: request.method(),
					failure: request.failure()?.errorText ?? 'unknown'
				});
			});
		}

		// Use the print route
		const target = new URL(`/print/resumes/${resumeId}`, url.origin);
		target.searchParams.set('lang', lang);
		target.searchParams.set(
			'template',
			exportPolicy.templateUsed === 'target' ? 'target' : 'source'
		);
		if (debugEnabled) {
			target.searchParams.set('debug', '1');
		}
		const targetUrl = target.toString();
		console.log('[pdf debug] rendering target url', targetUrl);

		let accessToken = cookies.get(AUTH_COOKIE_NAMES.access);
		const refreshToken = cookies.get(AUTH_COOKIE_NAMES.refresh);

		if (!accessToken && refreshToken) {
			try {
				const supabaseUrl = getSupabaseUrl();
				const publishableKey = getSupabasePublishableKey();
				if (!supabaseUrl || !publishableKey) {
					console.error(
						'[pdf] Missing Supabase URL or publishable key for refresh token exchange.'
					);
				} else {
					const supabase = createClient(supabaseUrl, publishableKey, {
						auth: {
							persistSession: false,
							autoRefreshToken: false,
							detectSessionInUrl: false
						}
					});
					const { data, error: refreshError } = await supabase.auth.refreshSession({
						refresh_token: refreshToken
					});

					if (!refreshError && data.session) {
						accessToken = data.session.access_token;
					}
				}
			} catch (err) {
				console.error('[pdf] Error during token refresh:', err);
			}
		}

		if (!accessToken) {
			throw error(401, 'Unauthorized: missing access token for PDF rendering.');
		}

		await page.context().addCookies([
			{
				name: AUTH_COOKIE_NAMES.access,
				value: accessToken,
				domain: new URL(url.origin).hostname,
				path: '/',
				httpOnly: true,
				sameSite: 'Lax' as const
			},
			...(refreshToken
				? [
						{
							name: AUTH_COOKIE_NAMES.refresh,
							value: refreshToken,
							domain: new URL(url.origin).hostname,
							path: '/',
							httpOnly: true,
							sameSite: 'Lax' as const
						}
					]
				: [])
		]);

		const response = await page.goto(targetUrl, { waitUntil: 'networkidle' });
		if (!response || !response.ok()) {
			throw error(response?.status() ?? 500, 'Failed to load resume page for PDF rendering.');
		}
		console.log('[pdf debug] page loaded', {
			status: response.status(),
			url: response.url()
		});

		await page.emulateMedia({ media: 'print', colorScheme: 'light' });
		await page.waitForSelector('.resume-print-page', { timeout: 15_000 });
		await page
			.waitForSelector('.resume-print-page.page-2-plus', { timeout: 15_000 })
			.catch(() => null);
		await page.waitForSelector('.pdf-mode', { timeout: 5_000 }).catch(() => null);
		await page
			.waitForFunction(() => (document as Document).fonts?.ready, { timeout: 5_000 })
			.catch(() => null);
		await page
			.waitForFunction(
				() =>
					Array.from(document.images).every((img) => {
						if (!img.complete) return false;
						return img.naturalWidth > 0;
					}),
				{ timeout: 15_000 }
			)
			.catch(() => null);

		await page.waitForFunction(
			() => {
				const el = document.querySelector('.resume-print-page');
				if (!el) return false;
				return (el as HTMLElement).innerText.trim().length > 0;
			},
			{ timeout: 15_000 }
		);
		if (debugEnabled) {
			const domSummary = await page.evaluate(() => {
				const summaryEl = document.querySelector('[data-debug="summary"]') as HTMLElement | null;
				const avatarImg = document.querySelector(
					'[data-debug="avatar-image"]'
				) as HTMLImageElement | null;
				const nameEl = document.querySelector('.page-1 h1') as HTMLElement | null;
				const titleEl = document.querySelector('.page-1 h2') as HTMLElement | null;
				const highlightedCount = document.querySelectorAll(
					'[data-debug="highlighted-item"]'
				).length;
				const experienceCount = document.querySelectorAll('[data-debug="experience-item"]').length;

				return {
					nameText: nameEl?.innerText?.trim() ?? '',
					titleText: titleEl?.innerText?.trim() ?? '',
					summaryLength: summaryEl?.innerText?.trim().length ?? 0,
					highlightedCount,
					experienceCount,
					avatar: avatarImg
						? {
								src: avatarImg.currentSrc || avatarImg.src,
								complete: avatarImg.complete,
								naturalWidth: avatarImg.naturalWidth,
								naturalHeight: avatarImg.naturalHeight
							}
						: null
				};
			});
			console.log('[pdf debug] dom summary before pdf()', domSummary);
		}

		// Force white background and convert oklch/lab colors to rgb for PDF compatibility.
		await page.evaluate(() => {
			document.documentElement.classList.remove('dark');
			document.body.classList.remove('dark');
			document.documentElement.style.background = '#ffffff';
			document.body.style.background = '#ffffff';

			const toRgb = (value: string) => {
				if (!value) return value;
				const el = document.createElement('div');
				el.style.color = value;
				document.body.appendChild(el);
				const resolved = getComputedStyle(el).color;
				el.remove();
				return resolved || value;
			};

			const resume = document.querySelector('.resume-print-page') as HTMLElement | null;
			if (resume) {
				const walker = document.createTreeWalker(resume, NodeFilter.SHOW_ELEMENT, null);
				while (walker.nextNode()) {
					const el = walker.currentNode as HTMLElement;
					const computed = getComputedStyle(el);
					const color = computed.color || '';
					const bg = computed.backgroundColor || '';
					if (color.startsWith('oklch') || color.startsWith('lch') || color.startsWith('lab')) {
						el.style.color = toRgb(color);
					}
					if (
						bg &&
						bg !== 'rgba(0, 0, 0, 0)' &&
						(bg.startsWith('oklch') || bg.startsWith('lch') || bg.startsWith('lab'))
					) {
						el.style.backgroundColor = toRgb(bg);
					}
				}
			}
		});
		await page.waitForTimeout(200);
		const avatarStatus = await ensureAvatarReady(page);
		console.log('[pdf] avatar status before PDF render', {
			resumeId,
			...avatarStatus
		});
		const baselineDownsampleResult = await tryDownsampleLargeImages(page, {
			maxWidth: PDF_IMAGE_BASE_MAX_WIDTH,
			maxHeight: PDF_IMAGE_BASE_MAX_HEIGHT,
			quality: PDF_IMAGE_BASE_QUALITY,
			reencodeAll: false,
			includeSvg: false,
			preserveTransparency: true
		});
		console.log('[pdf] baseline image downsample result', {
			resumeId,
			...baselineDownsampleResult,
			maxWidth: PDF_IMAGE_BASE_MAX_WIDTH,
			maxHeight: PDF_IMAGE_BASE_MAX_HEIGHT,
			quality: PDF_IMAGE_BASE_QUALITY,
			targetMaxBytes: PDF_TARGET_MAX_BYTES
		});
		await page.waitForTimeout(80);

		let pdfBuffer = await buildPdfBuffer(page);
		if (pdfBuffer.byteLength > PDF_TARGET_MAX_BYTES) {
			console.warn('[pdf] PDF is above target, starting aggressive optimization', {
				resumeId,
				size: pdfBuffer.byteLength,
				targetMaxBytes: PDF_TARGET_MAX_BYTES
			});
		}
		const compressionProfiles = [
			{
				label: 'aggressive-raster',
				maxWidth: PDF_IMAGE_AGGRESSIVE_MAX_WIDTH,
				maxHeight: PDF_IMAGE_AGGRESSIVE_MAX_HEIGHT,
				quality: PDF_IMAGE_AGGRESSIVE_QUALITY,
				reencodeAll: false,
				includeSvg: false,
				preserveTransparency: true
			},
			{
				label: 'aggressive-reencode',
				maxWidth: PDF_IMAGE_AGGRESSIVE_MAX_WIDTH,
				maxHeight: PDF_IMAGE_AGGRESSIVE_MAX_HEIGHT,
				quality: PDF_IMAGE_AGGRESSIVE_QUALITY - 0.06,
				reencodeAll: true,
				includeSvg: false,
				preserveTransparency: true
			},
			{
				label: 'extreme-logos-included',
				maxWidth: PDF_IMAGE_EXTREME_MAX_WIDTH,
				maxHeight: PDF_IMAGE_EXTREME_MAX_HEIGHT,
				quality: PDF_IMAGE_EXTREME_QUALITY,
				reencodeAll: true,
				includeSvg: PDF_ALLOW_SVG_RASTERIZATION,
				preserveTransparency: true
			}
		] as const;

		for (const profile of compressionProfiles) {
			if (pdfBuffer.byteLength <= PDF_TARGET_MAX_BYTES) break;
			const downsampleResult = await tryDownsampleLargeImages(page, profile);
			console.log('[pdf] image downsample result', {
				resumeId,
				profile: profile.label,
				...downsampleResult,
				maxWidth: profile.maxWidth,
				maxHeight: profile.maxHeight,
				quality: profile.quality,
				reencodeAll: profile.reencodeAll,
				includeSvg: profile.includeSvg
			});
			await page.waitForTimeout(100);
			pdfBuffer = await buildPdfBuffer(page);
			console.log('[pdf] size after downsample profile', {
				resumeId,
				profile: profile.label,
				size: pdfBuffer.byteLength,
				targetMaxBytes: PDF_TARGET_MAX_BYTES
			});
		}

		if (pdfBuffer.byteLength > PDF_TARGET_MAX_BYTES) {
			const avatarProfiles = [
				{
					label: 'avatar-gentle',
					maxWidth: PDF_AVATAR_GENTLE_MAX_WIDTH,
					maxHeight: PDF_AVATAR_GENTLE_MAX_HEIGHT,
					quality: PDF_AVATAR_GENTLE_QUALITY
				},
				{
					label: 'avatar-last-resort',
					maxWidth: PDF_AVATAR_LAST_RESORT_MAX_WIDTH,
					maxHeight: PDF_AVATAR_LAST_RESORT_MAX_HEIGHT,
					quality: PDF_AVATAR_LAST_RESORT_QUALITY
				}
			] as const;
			for (const avatarProfile of avatarProfiles) {
				if (pdfBuffer.byteLength <= PDF_TARGET_MAX_BYTES) break;
				const avatarCompressResult = await tryCompressAvatarImage(page, avatarProfile);
				console.warn('[pdf] PDF still above target, avatar fallback pass', {
					resumeId,
					size: pdfBuffer.byteLength,
					targetMaxBytes: PDF_TARGET_MAX_BYTES,
					profile: avatarProfile.label,
					maxWidth: avatarProfile.maxWidth,
					maxHeight: avatarProfile.maxHeight,
					quality: avatarProfile.quality,
					avatarChanged: avatarCompressResult.changed,
					avatarReason: avatarCompressResult.reason,
					avatarWidth: avatarCompressResult.width,
					avatarHeight: avatarCompressResult.height
				});
				if (avatarCompressResult.changed) {
					await page.waitForTimeout(50);
					pdfBuffer = await buildPdfBuffer(page);
					console.log('[pdf] size after avatar profile', {
						resumeId,
						profile: avatarProfile.label,
						size: pdfBuffer.byteLength,
						targetMaxBytes: PDF_TARGET_MAX_BYTES
					});
				}
			}
		}
		if (pdfBuffer.byteLength > PDF_TARGET_MAX_BYTES) {
			console.warn('[pdf] Could not reach target size after all optimization passes', {
				resumeId,
				size: pdfBuffer.byteLength,
				targetMaxBytes: PDF_TARGET_MAX_BYTES
			});
		}

		const filename = await PDF_FILENAME(resumeId, sourceOrganisationSlug);
		console.log('[pdf] Response filename:', filename, 'type:', typeof filename);
		if (!RESUME_EXPORTS_BUCKET) {
			throw error(500, 'Resume exports bucket is not configured.');
		}

		const objectPath = buildExportObjectPath({
			userId: permissions.userId,
			resumeId,
			filename
		});
		const { error: uploadError } = await adminClient.storage
			.from(RESUME_EXPORTS_BUCKET)
			.upload(objectPath, pdfBuffer, {
				contentType: 'application/pdf',
				cacheControl: '120',
				upsert: false
			});
		if (uploadError) {
			console.error('[pdf] Failed to upload generated PDF to storage', {
				resumeId,
				bucket: RESUME_EXPORTS_BUCKET,
				objectPath,
				error: uploadError.message
			});
			throw error(500, 'Could not store generated PDF.');
		}
		uploadedObjectPath = objectPath;

		const { data: signedData, error: signedUrlError } = await adminClient.storage
			.from(RESUME_EXPORTS_BUCKET)
			.createSignedUrl(objectPath, EXPORT_SIGNED_URL_TTL_SECONDS, { download: filename });
		if (signedUrlError || !signedData?.signedUrl) {
			console.error('[pdf] Failed to create signed URL for generated PDF', {
				resumeId,
				bucket: RESUME_EXPORTS_BUCKET,
				objectPath,
				error: signedUrlError?.message ?? 'missing signed URL'
			});
			await adminClient.storage.from(RESUME_EXPORTS_BUCKET).remove([objectPath]);
			uploadedObjectPath = null;
			throw error(500, 'Could not prepare PDF download link.');
		}

		const auditResult = await writeAuditLog({
			actorUserId: exportPolicy.actorUserId,
			organisationId: auditOrganisationId,
			actionType: 'RESUME_EXPORT',
			resourceType: 'resume',
			resourceId: resumeId,
			metadata: {
				resume_id: resumeId,
				template_used: exportPolicy.templateUsed,
				source_org_id: exportPolicy.sourceOrganisationId,
				target_org_id: exportPolicy.targetOrganisationId,
				format: 'pdf',
				size_bytes: pdfBuffer.byteLength,
				storage_bucket: RESUME_EXPORTS_BUCKET,
				storage_object_path: objectPath
			}
		});
		if (!auditResult.ok) {
			await adminClient.storage.from(RESUME_EXPORTS_BUCKET).remove([objectPath]);
			uploadedObjectPath = null;
			throw error(500, auditResult.error || 'Could not write resume export audit log.');
		}

		return json({
			ok: true,
			filename,
			sizeBytes: pdfBuffer.byteLength,
			downloadUrl: signedData.signedUrl,
			expiresAt: new Date(Date.now() + EXPORT_SIGNED_URL_TTL_SECONDS * 1000).toISOString()
		});
	} catch (err) {
		if (uploadedObjectPath) {
			await adminClient.storage.from(RESUME_EXPORTS_BUCKET).remove([uploadedObjectPath]);
			uploadedObjectPath = null;
		}
		console.error('[pdf] Failed to generate PDF', err);
		if (isHttpError(err)) {
			throw err;
		}
		throw error(500, 'Could not generate PDF.');
	} finally {
		if (browser) {
			await browser.close();
		}
	}
};
