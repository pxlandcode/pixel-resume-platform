import { json, error, type RequestHandler } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';

const sanitizeName = (value: string) => {
	const nameWithoutExtension = value.replace(/\.[^/.]+$/, '');
	const extension = value.includes('.') ? value.slice(value.lastIndexOf('.')) : '';
	const normalized =
		nameWithoutExtension
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'upload';

	return { normalized, extension };
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	const supabaseUserClient = createSupabaseServerClient(accessToken);

	if (!supabaseUserClient) {
		throw error(401, 'You are not authenticated.');
	}

	const adminClient = getSupabaseAdminClient();

	if (!adminClient) {
		throw error(500, 'Storage client is not configured.');
	}

	const { data: userData, error: userError } = await supabaseUserClient.auth.getUser();

	if (userError || !userData.user) {
		throw error(401, 'Unable to resolve the signed-in user.');
	}

	const formData = await request.formData();
	const file = formData.get('file');

	if (!(file instanceof File)) {
		throw error(400, 'File payload is required.');
	}

	const arrayBuffer = await file.arrayBuffer();
	const fileBytes = new Uint8Array(arrayBuffer);
	const { normalized, extension } = sanitizeName(file.name || 'upload');
	const objectPath = `avatars/${userData.user.id}/${Date.now()}-${normalized}${extension}`;

	const { error: uploadError } = await adminClient.storage.from('avatars').upload(objectPath, fileBytes, {
		contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
		upsert: false
	});

	if (uploadError) {
		console.error('[users/upload-avatar] Failed to store file', uploadError);
		throw error(500, uploadError.message);
	}

	const { data: publicUrlData, error: publicUrlError } = adminClient.storage
		.from('avatars')
		.getPublicUrl(objectPath);

	if (publicUrlError || !publicUrlData?.publicUrl) {
		console.error('[users/upload-avatar] Failed to generate public URL', publicUrlError);
		throw error(500, 'Upload succeeded but the public URL could not be generated.');
	}

	return json({
		url: publicUrlData.publicUrl,
		path: objectPath
	});
};
