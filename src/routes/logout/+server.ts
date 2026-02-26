import { redirect, type RequestHandler } from '@sveltejs/kit';
import { clearAuthCookies } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ cookies }) => {
	clearAuthCookies(cookies);
	throw redirect(303, '/login');
};
