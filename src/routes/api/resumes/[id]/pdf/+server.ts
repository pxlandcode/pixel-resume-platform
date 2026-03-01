import type { RequestHandler } from './$types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
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

const isServerless =
	Boolean(process.env.NETLIFY) ||
	Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
	Boolean(process.env.VERCEL) ||
	Boolean(process.env.CF_PAGES);

const toSafeFilename = (value: string) =>
	value
		.replace(/[\\/:*?"<>|]+/g, '')
		.trim()
		.replace(/\s+/g, ' ') || 'resume';

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

const PDF_FILENAME = async (id: string, lang: string) => {
	try {
		const resume = await ResumeService.getResume(id);
		if (!resume) {
			console.error('[pdf] Resume not found for ID:', id);
			return 'Resume.pdf';
		}
		const person = await ResumeService.getPerson(resume.personId);
		const name = toSafeFilename(person?.name ?? 'resume');
		const kind = lang === 'sv' ? 'CV' : 'Resume';
		const filename = `${name} - Pixel&Code - ${kind}.pdf`;
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

	let browser: import('playwright-core').Browser | null = null;

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

		const pdfBuffer = await page.pdf({
			format: 'A4',
			printBackground: true,
			preferCSSPageSize: true,
			margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
		});

		const filename = await PDF_FILENAME(resumeId, lang);
		console.log('[pdf] Response filename:', filename, 'type:', typeof filename);

		return new Response(new Uint8Array(pdfBuffer), {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="${filename}"`
			}
		});
	} catch (err) {
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
