import { fail, redirect, type Actions } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { createClient } from '@supabase/supabase-js';
import { AUTH_COOKIE_NAMES } from '$lib/server/supabase';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '$env/static/private';

const cookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: !dev
};

const parseString = (value: FormDataEntryValue | null) =>
	typeof value === 'string' ? value.trim() : '';

const parseNumber = (value: FormDataEntryValue | null) => {
	if (typeof value !== 'string' || value.length === 0) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const formData = await request.formData();
		const password = parseString(formData.get('password'));
		const confirm = parseString(formData.get('confirm_password'));
		const accessToken = parseString(formData.get('access_token'));
		const refreshToken = parseString(formData.get('refresh_token'));
		const expiresAt = parseNumber(formData.get('expires_at'));
		const expiresIn = parseNumber(formData.get('expires_in'));

		if (!password || password.length < 8) {
			return fail(400, { ok: false, message: 'Password must be at least 8 characters long.' });
		}

		if (password !== confirm) {
			return fail(400, { ok: false, message: 'Passwords do not match.' });
		}

		if (!accessToken || !refreshToken) {
			return fail(400, {
				ok: false,
				message: 'This reset link is invalid or has expired. Please request a new email.'
			});
		}

		const now = Math.floor(Date.now() / 1000);

		if (expiresAt && expiresAt <= now) {
			return fail(400, {
				ok: false,
				message: 'This reset link has expired. Please request a new email.'
			});
		}

		const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			auth: {
				persistSession: false,
				autoRefreshToken: false
			}
		});

		const { data: sessionData, error: setError } = await supabase.auth.setSession({
			access_token: accessToken,
			refresh_token: refreshToken
		});

		if (setError || !sessionData.session) {
			return fail(400, {
				ok: false,
				message: setError?.message ?? 'This reset link is no longer valid. Please request a new email.'
			});
		}

		const { error: updateError } = await supabase.auth.updateUser({ password });

		if (updateError) {
			return fail(500, { ok: false, message: updateError.message });
		}

		const session = sessionData.session;

		const computedMaxAge = (() => {
			const exp = session.expires_at ?? expiresAt;
			if (exp) {
				return Math.max(exp - now, 120);
			}
			if (expiresIn) {
				return Math.max(expiresIn, 120);
			}
			return 60 * 60;
		})();

		cookies.set(AUTH_COOKIE_NAMES.access, session.access_token, {
			...cookieOptions,
			maxAge: computedMaxAge
		});
		cookies.set(AUTH_COOKIE_NAMES.refresh, session.refresh_token ?? refreshToken, {
			...cookieOptions,
			maxAge: 60 * 60 * 24 * 30
		});

		return redirect(303, '/');
	}
};
