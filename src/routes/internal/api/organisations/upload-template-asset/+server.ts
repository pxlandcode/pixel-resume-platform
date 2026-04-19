import { randomUUID } from 'node:crypto';
import { json, type RequestHandler } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { invalidateOrganisationContextCache } from '$lib/server/organisationContextCache';
import { getActorAccessContext } from '$lib/server/access';

const ORGANISATION_IMAGES_BUCKET = 'organisation-images';
const MAX_ORGANISATION_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEMPLATE_ASSET_SLOTS = ['main_logotype_path', 'accent_logo_path', 'end_logo_path'] as const;

type TemplateAssetSlot = (typeof TEMPLATE_ASSET_SLOTS)[number];

const isValidUuid = (value: string | null | undefined) =>
	typeof value === 'string' && UUID_REGEX.test(value);

const isTemplateAssetSlot = (value: string | null | undefined): value is TemplateAssetSlot =>
	typeof value === 'string' && TEMPLATE_ASSET_SLOTS.includes(value as TemplateAssetSlot);

const normalizeFilenameSegment = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'asset';

const getFileExtension = (file: File) => {
	const name = file.name?.trim() ?? '';
	const dotIndex = name.lastIndexOf('.');
	if (dotIndex >= 0 && dotIndex < name.length - 1) {
		return name.slice(dotIndex).toLowerCase();
	}
	if (file.type === 'image/svg+xml') return '.svg';
	if (file.type === 'image/png') return '.png';
	if (file.type === 'image/jpeg') return '.jpg';
	if (file.type === 'image/webp') return '.webp';
	if (file.type === 'image/gif') return '.gif';
	if (file.type === 'image/avif') return '.avif';
	return '';
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();

	if (!supabase || !adminClient) {
		return json({ message: 'You are not authenticated.' }, { status: 401 });
	}

	const formData = await request.formData();
	const organisationIdRaw = formData.get('organisation_id');
	const assetSlotRaw = formData.get('asset_slot');
	const file = formData.get('file');

	const organisationId = typeof organisationIdRaw === 'string' ? organisationIdRaw : null;
	const assetSlot = typeof assetSlotRaw === 'string' ? assetSlotRaw : null;

	if (!isValidUuid(organisationId)) {
		return json({ message: 'Invalid organisation id.' }, { status: 400 });
	}
	if (!isTemplateAssetSlot(assetSlot)) {
		return json({ message: 'Invalid asset slot.' }, { status: 400 });
	}

	const actor = await getActorAccessContext(supabase, adminClient);
	if (!actor.userId) {
		return json({ message: 'You are not authenticated.' }, { status: 401 });
	}

	const canManageOrganisation =
		actor.isAdmin || (actor.isOrganisationAdmin && actor.homeOrganisationId === organisationId);
	if (!canManageOrganisation) {
		return json(
			{ message: 'You do not have permission to upload branding assets for this organisation.' },
			{ status: 403 }
		);
	}

	if (!(file instanceof File)) {
		return json({ message: 'Image file is required.' }, { status: 400 });
	}
	if (file.size <= 0) {
		return json({ message: 'Uploaded file is empty.' }, { status: 400 });
	}
	if (file.size > MAX_ORGANISATION_IMAGE_SIZE_BYTES) {
		return json({ message: 'Image must be 10MB or smaller.' }, { status: 400 });
	}

	const extension = getFileExtension(file);
	const mimeLooksLikeImage = file.type.startsWith('image/');
	const extensionLooksLikeImage = /\.(svg|png|jpe?g|webp|gif|avif|bmp|tiff?|ico)$/i.test(extension);
	if (!mimeLooksLikeImage && !extensionLooksLikeImage) {
		return json({ message: 'Please choose an image file.' }, { status: 400 });
	}

	const objectName = normalizeFilenameSegment(file.name || 'asset');
	const objectPath = `${organisationId}/${assetSlot}/${Date.now()}-${randomUUID()}-${objectName}${extension}`;
	const payload = new Uint8Array(await file.arrayBuffer());

	const { error: uploadError } = await adminClient.storage
		.from(ORGANISATION_IMAGES_BUCKET)
		.upload(objectPath, payload, {
			contentType: file.type || 'application/octet-stream',
			cacheControl: '3600',
			upsert: false
		});

	if (uploadError) {
		return json({ message: uploadError.message }, { status: 500 });
	}

	const { error: templateError } = await adminClient.from('organisation_templates').upsert(
		{
			organisation_id: organisationId,
			[assetSlot]: objectPath,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'organisation_id' }
	);

	if (templateError) {
		await adminClient.storage.from(ORGANISATION_IMAGES_BUCKET).remove([objectPath]);
		return json({ message: templateError.message }, { status: 500 });
	}

	const { data: publicUrlData } = adminClient.storage
		.from(ORGANISATION_IMAGES_BUCKET)
		.getPublicUrl(objectPath);

	invalidateOrganisationContextCache(organisationId);

	return json({
		path: objectPath,
		url: publicUrlData.publicUrl ?? null,
		organisation_id: organisationId,
		asset_slot: assetSlot
	});
};
