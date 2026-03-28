import type { RequestHandler } from './$types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';
import { error } from '@sveltejs/kit';
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

export const GET: RequestHandler = async ({ params, url, cookies, request, getClientAddress }) => {
	const adminClient = getSupabaseAdminClient();
	if (!adminClient) {
		throw error(503, 'Resume sharing is not configured.');
	}

	let browser: import('playwright-core').Browser | null = null;
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
		await page.waitForTimeout(200);

		const pdfBuffer = await page.pdf({
			format: 'A4',
			printBackground: true,
			preferCSSPageSize: true,
			margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
		});

		await recordSuccessfulShareDownload({
			adminClient,
			shareLinkId: access.link.id,
			requestedTokenHash: access.requestedTokenHash,
			userAgent: access.userAgent,
			referrerUrlSanitized: access.referrerUrlSanitized,
			clientIpHash: access.clientIpHash
		});

		const filename = access.link.is_anonymized
			? buildAnonymizedResumeFilename(language, 'pdf')
			: 'shared-resume.pdf';

		return new Response(new Uint8Array(pdfBuffer), {
			headers: {
				...getPublicResumeShareHeaders(),
				'content-type': 'application/pdf',
				'content-disposition': `attachment; filename="${filename}"`
			}
		});
	} catch (err) {
		if (err instanceof ResumeShareAccessError) {
			throw error(err.status, err.message);
		}
		if (err instanceof Error && 'status' in err) {
			throw err;
		}
		throw error(500, 'Could not generate the shared resume PDF.');
	} finally {
		if (browser) {
			await browser.close();
		}
	}
};
