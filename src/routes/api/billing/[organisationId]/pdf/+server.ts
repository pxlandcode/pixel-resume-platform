import type { RequestHandler } from './$types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabasePublishableKey,
	getSupabaseUrl
} from '$lib/server/supabase';
import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';
import { canAccessOrganisationBilling, getCurrentBillingPeriodMonth, normalizePeriodMonth } from '$lib/server/billing';

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
	if (envPath && existsSync(envPath)) return envPath;

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
							: ''
					]
				: [
						'/usr/bin/google-chrome',
						'/usr/bin/google-chrome-stable',
						'/usr/bin/chromium',
						'/usr/bin/chromium-browser'
					];

	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) return candidate;
	}

	return null;
};

const launchBrowser = async (): Promise<import('playwright-core').Browser> => {
	if (!isServerless) {
		const executablePath = resolveLocalChromePath();
		if (!executablePath) {
			throw new Error(
				'Local Chromium executable not found. Set CHROME_PATH or PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.'
			);
		}
		return playwrightChromium.launch({ executablePath, headless: true });
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

const sanitizeFilePart = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '') || 'billing';

export const GET: RequestHandler = async ({ params, url, cookies, locals }) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!adminClient || !actor.userId) {
		throw error(401, 'Unauthorized');
	}

	const organisationId = params.organisationId;
	if (!canAccessOrganisationBilling(actor, organisationId)) {
		throw error(403, 'Forbidden');
	}

	const selectedMonth =
		normalizePeriodMonth(url.searchParams.get('month')) ?? getCurrentBillingPeriodMonth();

	const { data: organisation, error: organisationError } = await adminClient
		.from('organisations')
		.select('id, name, slug')
		.eq('id', organisationId)
		.maybeSingle();
	if (organisationError) {
		throw error(500, organisationError.message);
	}
	if (!organisation) {
		throw error(404, 'Organisation not found');
	}

	let browser: import('playwright-core').Browser | null = null;

	try {
		browser = await launchBrowser();
		const page = await browser.newPage({
			viewport: { width: 1240, height: 1754 }
		});

		let accessToken = cookies.get(AUTH_COOKIE_NAMES.access);
		const refreshToken = cookies.get(AUTH_COOKIE_NAMES.refresh);

		if (!accessToken && refreshToken) {
			const supabaseUrl = getSupabaseUrl();
			const publishableKey = getSupabasePublishableKey();
			if (supabaseUrl && publishableKey) {
				const supabase = createClient(supabaseUrl, publishableKey, {
					auth: {
						persistSession: false,
						autoRefreshToken: false,
						detectSessionInUrl: false
					}
				});
				const { data } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
				accessToken = data.session?.access_token ?? undefined;
			}
		}

		if (!accessToken) {
			const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
			if (!supabase) throw error(401, 'Unauthorized');
			const session = await supabase.auth.getSession();
			accessToken = session.data.session?.access_token ?? undefined;
		}

		if (!accessToken) {
			throw error(401, 'Unauthorized');
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

		const target = new URL(`/print/billing/${organisationId}`, url.origin);
		target.searchParams.set('month', selectedMonth.slice(0, 7));

		const response = await page.goto(target.toString(), { waitUntil: 'networkidle' });
		if (!response || !response.ok()) {
			throw error(response?.status() ?? 500, 'Failed to load billing print page.');
		}

		await page.emulateMedia({ media: 'print', colorScheme: 'light' });
		await page.waitForSelector('.billing-print-page', { timeout: 15_000 });
		await page
			.waitForFunction(() => (document as Document).fonts?.ready, { timeout: 5_000 })
			.catch(() => null);

		const pdf = await page.pdf({
			format: 'A4',
			printBackground: true,
			preferCSSPageSize: true,
			margin: {
				top: '0mm',
				right: '0mm',
				bottom: '0mm',
				left: '0mm'
			}
		});

		const filename = `${sanitizeFilePart(organisation.slug || organisation.name)}-${selectedMonth.slice(0, 7)}-billing.pdf`;

		return new Response(new Uint8Array(pdf), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="${filename}"`,
				'Cache-Control': 'private, no-store'
			}
		});
	} finally {
		await browser?.close().catch(() => undefined);
	}
};
