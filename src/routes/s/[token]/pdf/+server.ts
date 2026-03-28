import type { RequestHandler } from './$types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';
import { error, json } from '@sveltejs/kit';
import { buildAnonymizedResumeFilename } from '$lib/resumes/anonymize';
import { getSupabaseAdminClient } from '$lib/server/supabase';
import {
	getPublicResumeShareHeaders,
	getResumeShareCookieName,
	recordSuccessfulShareDownload,
	resolvePublicResumeShareDownload,
	ResumeShareAccessError
} from '$lib/server/resumeShares';

const isServerless =
	Boolean(process.env.NETLIFY) ||
	Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
	Boolean(process.env.VERCEL) ||
	Boolean(process.env.CF_PAGES);
const RESUME_EXPORTS_BUCKET = (process.env.RESUME_EXPORTS_BUCKET ?? 'resume-exports').trim();
const EXPORT_SIGNED_URL_TTL_SECONDS = 60 * 10;

const toSafePathSegment = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 120) || 'resume';

const buildShareExportObjectPath = ({
	shareLinkId,
	resumeId,
	filename
}: {
	shareLinkId: string;
	resumeId: string;
	filename: string;
}) => {
	const safeFilename = toSafePathSegment(filename.replace(/\.pdf$/i, ''));
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	return `resume-share-exports/${toSafePathSegment(shareLinkId)}/${toSafePathSegment(resumeId)}/${timestamp}-${safeFilename}.pdf`;
};

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
		margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
	});
};

const waitForFonts = async (page: import('playwright-core').Page) => {
	await page
		.waitForFunction(
			() => {
				if (!('fonts' in document) || !document.fonts) return true;
				return document.fonts.status === 'loaded';
			},
			{ timeout: 15_000 }
		)
		.catch(() => null);
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
) => {
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
			if (!src) continue;
			const lowerSrc = src.toLowerCase();
			const looksSvg =
				lowerSrc.startsWith('data:image/svg') ||
				lowerSrc.endsWith('.svg') ||
				lowerSrc.includes('.svg?');
			if (looksSvg && !includeSvg) continue;

			const width = img.naturalWidth;
			const height = img.naturalHeight;
			if (!width || !height) continue;
			if (!reencodeAll && width <= maxWidth && height <= maxHeight) continue;

			const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
			const nextWidth = Math.max(1, Math.round(width * ratio));
			const nextHeight = Math.max(1, Math.round(height * ratio));

			const canvas = document.createElement('canvas');
			canvas.width = nextWidth;
			canvas.height = nextHeight;
			const ctx = canvas.getContext('2d');
			if (!ctx) continue;

			let bitmap: ImageBitmap | null = null;
			try {
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
						if (blobLooksSvg && !includeSvg) continue;
						try {
							bitmap = await createImageBitmap(blob);
						} catch {
							// Fall back to drawing the existing image element.
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
			} catch {
				// Ignore per-image failures and continue rendering.
			} finally {
				bitmap?.close();
			}
		}
	}, options);
};

export const GET: RequestHandler = async ({ params, url, cookies, request, getClientAddress }) => {
	const adminClient = getSupabaseAdminClient();
	if (!adminClient) {
		throw error(503, 'Resume sharing is not configured.');
	}

	let browser: import('playwright-core').Browser | null = null;
	let uploadedObjectPath: string | null = null;
	try {
		const access = await resolvePublicResumeShareDownload({
			adminClient,
			cookies,
			token: params.token,
			requestEvent: {
				request,
				getClientAddress
			}
		});
		const prepareOnly = url.searchParams.get('prepare') === '1';

		browser = await launchBrowser();
		const page = await browser.newPage({
			viewport: { width: 1123, height: 1587 }
		});

		const sessionCookie = cookies.get(getResumeShareCookieName(access.link.id)) ?? null;
		if (sessionCookie) {
			await page.context().addCookies([
				{
					name: getResumeShareCookieName(access.link.id),
					value: sessionCookie,
					domain: new URL(url.origin).hostname,
					path: `/s/${encodeURIComponent(params.token)}`,
					httpOnly: true,
					sameSite: 'Lax' as const,
					secure: url.protocol === 'https:'
				}
			]);
		}

		const language = url.searchParams.get('lang') === 'en' ? 'en' : 'sv';
		const target = new URL(`/s/${encodeURIComponent(params.token)}`, url.origin);
		target.searchParams.set('lang', language);
		target.searchParams.set('print', '1');
		const response = await page.goto(target.toString(), { waitUntil: 'networkidle' });
		if (!response || !response.ok()) {
			throw error(response?.status() ?? 500, 'Could not load the shared resume for PDF rendering.');
		}

		await page.emulateMedia({ media: 'print', colorScheme: 'light' });
		await page.waitForSelector('.resume-print-page', { timeout: 15_000 });
		await waitForFonts(page);
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
		await tryDownsampleLargeImages(page, {
			maxWidth: 1000,
			maxHeight: 1000,
			quality: 0.72
		}).catch(() => null);
		await page.waitForTimeout(200);

		const pdfBuffer = await buildPdfBuffer(page);

		const filename = access.link.is_anonymized
			? buildAnonymizedResumeFilename(language, 'pdf')
			: 'shared-resume.pdf';
		if (!RESUME_EXPORTS_BUCKET) {
			throw error(500, 'Resume exports bucket is not configured.');
		}

		const objectPath = buildShareExportObjectPath({
			shareLinkId: access.link.id,
			resumeId: access.link.resume_id,
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
			console.error('[share-pdf] Failed to upload generated PDF to storage', {
				shareLinkId: access.link.id,
				bucket: RESUME_EXPORTS_BUCKET,
				objectPath,
				error: uploadError.message
			});
			throw error(500, 'Could not store the shared resume PDF.');
		}
		uploadedObjectPath = objectPath;

		const { data: signedData, error: signedUrlError } = await adminClient.storage
			.from(RESUME_EXPORTS_BUCKET)
			.createSignedUrl(objectPath, EXPORT_SIGNED_URL_TTL_SECONDS, { download: filename });
		if (signedUrlError || !signedData?.signedUrl) {
			console.error('[share-pdf] Failed to create signed URL for generated PDF', {
				shareLinkId: access.link.id,
				bucket: RESUME_EXPORTS_BUCKET,
				objectPath,
				error: signedUrlError?.message ?? 'missing signed URL'
			});
			await adminClient.storage.from(RESUME_EXPORTS_BUCKET).remove([objectPath]);
			uploadedObjectPath = null;
			throw error(500, 'Could not prepare the shared resume download.');
		}

		await recordSuccessfulShareDownload({
			adminClient,
			shareLinkId: access.link.id,
			requestedTokenHash: access.requestedTokenHash,
			userAgent: access.userAgent,
			referrerUrlSanitized: access.referrerUrlSanitized,
			clientIpHash: access.clientIpHash
		});

		const expiresAt = new Date(Date.now() + EXPORT_SIGNED_URL_TTL_SECONDS * 1000).toISOString();
		const responseHeaders = getPublicResumeShareHeaders();

		if (prepareOnly) {
			return json(
				{
					ok: true,
					filename,
					downloadUrl: signedData.signedUrl,
					expiresAt
				},
				{ headers: responseHeaders }
			);
		}

		return new Response(null, {
			status: 303,
			headers: {
				...responseHeaders,
				location: signedData.signedUrl
			}
		});
	} catch (err) {
		if (uploadedObjectPath) {
			await adminClient.storage.from(RESUME_EXPORTS_BUCKET).remove([uploadedObjectPath]);
			uploadedObjectPath = null;
		}
		if (err instanceof ResumeShareAccessError) {
			throw error(err.status, err.message);
		}
		if (err instanceof Error && 'status' in err) {
			throw err;
		}
		console.error('[share-pdf] Failed to generate shared resume PDF', err);
		throw error(500, 'Could not generate the shared resume PDF.');
	} finally {
		if (browser) {
			await browser.close();
		}
	}
};
