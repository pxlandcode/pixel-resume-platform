import type { Actions, PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { error, fail } from '@sveltejs/kit';
import { getResumeEditPermissions } from '$lib/server/resumes/permissions';
import { cloneResumeData, initResumeData, loadResumeData } from '$lib/server/resumes/store';
import {
	PROFILE_AVAILABILITY_SELECT,
	normalizeAvailabilityRow,
	parseAvailabilityForm,
	validateAvailability
} from '$lib/server/consultantAvailability';

const ORGANISATION_IMAGES_BUCKET = 'organisation-images';

const resolveStoragePublicUrl = (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	value: string | null | undefined
) => {
	if (!value || typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	const normalizedPath = trimmed.replace(/^\/+/, '').replace(/^organisation-images\//, '');
	const { data } = adminClient.storage
		.from(ORGANISATION_IMAGES_BUCKET)
		.getPublicUrl(normalizedPath);
	return data.publicUrl ?? null;
};

const getTargetTalentId = (formData: FormData, fallbackTalentId: string): string | null => {
	const fromTalent = formData.get('talent_id');
	if (typeof fromTalent === 'string' && fromTalent.trim()) return fromTalent.trim();
	return fallbackTalentId || null;
};

export const load: PageServerLoad = async ({ params, cookies }) => {
	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	const supabase = createSupabaseServerClient(accessToken);
	const adminClient = getSupabaseAdminClient();

	if (!supabase || !adminClient) {
		return {
			profile: null,
			availability: normalizeAvailabilityRow(null),
			resumes: [],
			fromDb: false,
			canEdit: false,
			canEditAll: false,
			isOwnProfile: false
		};
	}

	const talentId = params.personId;
	const { canView, canEdit, canEditAll, isOwnProfile } = await getResumeEditPermissions(
		supabase,
		adminClient,
		talentId
	);
	if (!canView) {
		throw error(403, 'Not authorized to view this talent.');
	}

	const [
		{ data: profile, error: profileError },
		resumesResult,
		availabilityResult,
		orgMembershipResult
	] = await Promise.all([
		adminClient
			.from('talents')
			.select('id, first_name, last_name, avatar_url, title, bio, tech_stack')
			.eq('id', talentId)
			.maybeSingle(),
		adminClient
			.from('resumes')
			.select(
				'id, talent_id, version_name, is_main, is_active, allow_word_export, preview_html, created_at, updated_at'
			)
			.eq('talent_id', talentId)
			.order('created_at', { ascending: false }),
		adminClient
			.from('profile_availability')
			.select(PROFILE_AVAILABILITY_SELECT)
			.eq('profile_id', talentId)
			.maybeSingle(),
		adminClient
			.from('organisation_talents')
			.select('organisation_id')
			.eq('talent_id', talentId)
			.maybeSingle()
	]);

	if (profileError) {
		console.warn('[resumes detail] talent error', profileError);
	}
	if (resumesResult.error) {
		console.warn('[resumes detail] resumes error', resumesResult.error);
	}
	if (availabilityResult.error) {
		console.warn('[resumes detail] profile_availability error', availabilityResult.error);
	}
	if (orgMembershipResult.error) {
		console.warn('[resumes detail] organisation_talents error', orgMembershipResult.error);
	}

	// Fetch organisation details if the talent belongs to one
	let organisationName: string | null = null;
	let organisationLogoUrl: string | null = null;
	const organisationId = orgMembershipResult.data?.organisation_id;
	if (organisationId) {
		const [orgResult, templateResult] = await Promise.all([
			adminClient.from('organisations').select('name').eq('id', organisationId).maybeSingle(),
			adminClient
				.from('organisation_templates')
				.select('main_logotype_path')
				.eq('organisation_id', organisationId)
				.maybeSingle()
		]);
		if (orgResult.error) {
			console.warn('[resumes detail] organisations error', orgResult.error);
		}
		if (templateResult.error) {
			console.warn('[resumes detail] organisation_templates error', templateResult.error);
		}
		organisationName = orgResult.data?.name ?? null;
		organisationLogoUrl = resolveStoragePublicUrl(
			adminClient,
			templateResult.data?.main_logotype_path
		);
	}

	const resumeRows = resumesResult.data ?? [];
	const resumeIds = resumeRows
		.map((row) => Number(row.id))
		.filter((id) => Number.isInteger(id) && id > 0);

	const basicsByResumeId = new Map<number, { title_en: string | null; title_sv: string | null }>();
	if (resumeIds.length > 0) {
		const { data: basicsRows, error: basicsError } = await adminClient
			.from('resume_basics')
			.select('resume_id, title_en, title_sv')
			.in('resume_id', resumeIds);

		if (basicsError) {
			console.warn('[resumes detail] resume_basics error', basicsError);
		}

		for (const row of basicsRows ?? []) {
			const resumeId = Number((row as { resume_id: unknown }).resume_id);
			if (!Number.isInteger(resumeId)) continue;
			basicsByResumeId.set(resumeId, {
				title_en:
					typeof (row as { title_en?: unknown }).title_en === 'string'
						? (row as { title_en: string }).title_en || null
						: null,
				title_sv:
					typeof (row as { title_sv?: unknown }).title_sv === 'string'
						? (row as { title_sv: string }).title_sv || null
						: null
			});
		}
	}

	const resumes = resumeRows.map((resume) => {
		const basic = basicsByResumeId.get(Number(resume.id));
		const displayVersionName =
			basic?.title_en?.trim() || basic?.title_sv?.trim() || resume.version_name || 'Main';

		return {
			id: String(resume.id),
			talent_id: resume.talent_id,
			version_name: displayVersionName,
			is_main: Boolean(resume.is_main),
			is_active: Boolean(resume.is_active ?? true),
			allow_word_export: Boolean(resume.allow_word_export ?? false),
			preview_html: resume.preview_html ?? null,
			created_at: resume.created_at ?? null,
			updated_at: resume.updated_at ?? resume.created_at ?? null
		};
	});

	return {
		profile: profile ?? null,
		availability: normalizeAvailabilityRow(availabilityResult.data),
		resumes,
		fromDb: Boolean(profile),
		canView,
		canEdit,
		canEditAll,
		isOwnProfile,
		organisation_name: organisationName,
		organisation_logo_url: organisationLogoUrl
	};
};

export const actions: Actions = {
	updateProfile: async ({ request, cookies, params }) => {
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		const adminClient = getSupabaseAdminClient();

		if (!supabase || !adminClient) {
			return fail(401, { ok: false, message: 'Unauthorized' });
		}

		const formData = await request.formData();
		const talentId = getTargetTalentId(formData, params.personId);
		const bio = formData.get('bio');
		const techStackRaw = formData.get('tech_stack');
		const avatarRaw = formData.get('avatar_url');
		const avatar_url =
			typeof avatarRaw === 'string' && avatarRaw.trim().length > 0 ? avatarRaw.trim() : null;

		if (typeof talentId !== 'string') {
			return fail(400, { ok: false, message: 'Invalid talent id' });
		}
		if (params.personId && params.personId !== talentId) {
			return fail(400, { ok: false, message: 'Mismatched talent id' });
		}
		if (typeof bio !== 'string') {
			return fail(400, { ok: false, message: 'Invalid bio' });
		}

		let techStack: unknown = null;
		if (typeof techStackRaw === 'string') {
			try {
				techStack = JSON.parse(techStackRaw);
			} catch {
				return fail(400, { ok: false, message: 'Invalid tech stack JSON' });
			}
		}

		const { canEdit } = await getResumeEditPermissions(supabase, adminClient, talentId);
		if (!canEdit) {
			return fail(403, { ok: false, message: 'Not authorized to update this profile' });
		}

		const parsedAvailability = parseAvailabilityForm(formData);
		const availabilityValidation = validateAvailability(parsedAvailability);
		if (!availabilityValidation.ok) {
			return fail(400, {
				ok: false,
				type: 'updateProfile',
				message: availabilityValidation.message
			});
		}

		const { data: updatedTalent, error } = await adminClient
			.from('talents')
			.update({ bio, tech_stack: techStack, avatar_url, updated_at: new Date().toISOString() })
			.eq('id', talentId)
			.select('user_id')
			.maybeSingle();

		if (error) {
			return fail(500, { ok: false, type: 'updateProfile', message: error.message });
		}

		if (updatedTalent?.user_id) {
			const { error: linkedUserProfileError } = await adminClient.from('user_profiles').upsert(
				{
					user_id: updatedTalent.user_id,
					avatar_url
				},
				{ onConflict: 'user_id' }
			);

			if (linkedUserProfileError) {
				return fail(500, {
					ok: false,
					type: 'updateProfile',
					message: linkedUserProfileError.message
				});
			}
		}

		const { error: profileAvailabilityError } = await adminClient
			.from('profile_availability')
			.upsert(
				{
					profile_id: talentId,
					...availabilityValidation.db,
					updated_at: new Date().toISOString()
				},
				{ onConflict: 'profile_id' }
			);

		if (profileAvailabilityError) {
			return fail(500, {
				ok: false,
				type: 'updateProfile',
				message: profileAvailabilityError.message
			});
		}

		return { ok: true, type: 'updateProfile', message: 'Profile updated.' };
	},
	createResume: async ({ request, cookies, params }) => {
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		const adminClient = getSupabaseAdminClient();

		if (!supabase || !adminClient) {
			return fail(401, { ok: false, message: 'Unauthorized' });
		}

		const formData = await request.formData();
		const talentId = getTargetTalentId(formData, params.personId);

		if (typeof talentId !== 'string') {
			return fail(400, { ok: false, message: 'Invalid talent id' });
		}

		const { canEdit } = await getResumeEditPermissions(supabase, adminClient, talentId);
		if (!canEdit) {
			return fail(403, { ok: false, message: 'Not authorized to create resumes for this talent' });
		}

		const { data: talentRow } = await adminClient
			.from('talents')
			.select('first_name, last_name')
			.eq('id', talentId)
			.maybeSingle();

		const name =
			[talentRow?.first_name, talentRow?.last_name].filter(Boolean).join(' ') || 'New resume';

		const { data, error } = await adminClient
			.from('resumes')
			.insert({
				talent_id: talentId,
				version_name: 'New Resume',
				is_main: false,
				is_active: true,
				allow_word_export: false,
				preview_html: null
			})
			.select('id')
			.single();

		if (error || !data?.id) {
			return fail(500, { ok: false, message: error?.message ?? 'Failed to create resume' });
		}

		try {
			await initResumeData(adminClient, String(data.id), talentId, name);
		} catch (initError) {
			await adminClient.from('resumes').delete().eq('id', data.id);
			return fail(500, {
				ok: false,
				message: initError instanceof Error ? initError.message : 'Failed to initialize resume'
			});
		}

		return { ok: true, id: data.id };
	},
	updateResumeOrder: async ({ request, cookies, params }) => {
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		const adminClient = getSupabaseAdminClient();

		if (!supabase || !adminClient) {
			return fail(401, { ok: false, message: 'Unauthorized' });
		}

		const formData = await request.formData();
		const talentId = getTargetTalentId(formData, params.personId);
		const orderRaw = formData.get('resume_order');

		if (typeof talentId !== 'string') {
			return fail(400, { ok: false, message: 'Invalid talent id' });
		}
		if (typeof orderRaw !== 'string') {
			return fail(400, { ok: false, message: 'Invalid order payload' });
		}

		let orderedIds: string[] = [];
		try {
			const parsed = JSON.parse(orderRaw);
			if (Array.isArray(parsed)) {
				orderedIds = parsed.filter((id) => typeof id === 'string');
			}
		} catch {
			return fail(400, { ok: false, message: 'Invalid order JSON' });
		}

		if (orderedIds.length === 0) {
			return fail(400, { ok: false, message: 'Empty order' });
		}

		const { canEdit } = await getResumeEditPermissions(supabase, adminClient, talentId);
		if (!canEdit) {
			return fail(403, { ok: false, message: 'Not authorized to reorder resumes for this talent' });
		}

		await adminClient.from('resumes').update({ is_main: false }).eq('talent_id', talentId);
		await adminClient
			.from('resumes')
			.update({ is_main: true })
			.eq('talent_id', talentId)
			.eq('id', orderedIds[0]);

		return { ok: true };
	},

	copyResume: async ({ request, cookies, params }) => {
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		const adminClient = getSupabaseAdminClient();

		if (!supabase || !adminClient) {
			return fail(401, { ok: false, message: 'Unauthorized' });
		}

		const formData = await request.formData();
		const resumeId = formData.get('resume_id');
		const talentId = params.personId;

		if (typeof resumeId !== 'string') {
			return fail(400, { ok: false, message: 'Invalid resume id' });
		}

		const { canEdit } = await getResumeEditPermissions(supabase, adminClient, talentId);
		if (!canEdit) {
			return fail(403, { ok: false, message: 'Not authorized to copy this resume' });
		}

		const { data: original, error: fetchError } = await adminClient
			.from('resumes')
			.select('id, talent_id, version_name, is_active, allow_word_export, preview_html')
			.eq('id', resumeId)
			.eq('talent_id', talentId)
			.maybeSingle();

		if (fetchError || !original) {
			return fail(404, { ok: false, message: 'Resume not found' });
		}

		let copyTitle = `${original.version_name ?? 'Resume'} (Copy)`;
		try {
			const sourceData = await loadResumeData(adminClient, resumeId);
			const title =
				typeof sourceData.title === 'string'
					? sourceData.title.trim()
					: (sourceData.title.en || sourceData.title.sv || '').trim();
			if (title) {
				copyTitle = `${title} (Copy)`;
			}
		} catch {
			// Keep metadata fallback title.
		}

		const { data: inserted, error: insertError } = await adminClient
			.from('resumes')
			.insert({
				talent_id: talentId,
				version_name: copyTitle,
				is_main: false,
				is_active: original.is_active ?? true,
				allow_word_export: original.allow_word_export ?? false,
				preview_html: original.preview_html ?? null
			})
			.select('id')
			.single();

		if (insertError || !inserted?.id) {
			return fail(500, { ok: false, message: insertError?.message ?? 'Failed to copy resume' });
		}

		try {
			await cloneResumeData(adminClient, resumeId, String(inserted.id), talentId);
		} catch (cloneError) {
			await adminClient.from('resumes').delete().eq('id', inserted.id);
			return fail(500, {
				ok: false,
				message: cloneError instanceof Error ? cloneError.message : 'Failed to copy resume data'
			});
		}

		return { ok: true, id: inserted.id };
	},

	deleteResume: async ({ request, cookies, params }) => {
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		const adminClient = getSupabaseAdminClient();

		if (!supabase || !adminClient) {
			return fail(401, { ok: false, message: 'Unauthorized' });
		}

		const formData = await request.formData();
		const resumeId = formData.get('resume_id');
		const talentId = params.personId;

		if (typeof resumeId !== 'string') {
			return fail(400, { ok: false, message: 'Invalid resume id' });
		}

		const { canEdit } = await getResumeEditPermissions(supabase, adminClient, talentId);
		if (!canEdit) {
			return fail(403, { ok: false, message: 'Not authorized to delete this resume' });
		}

		const { data: existing } = await adminClient
			.from('resumes')
			.select('id, talent_id, is_main')
			.eq('id', resumeId)
			.eq('talent_id', talentId)
			.maybeSingle();

		if (!existing) {
			return fail(404, { ok: false, message: 'Resume not found' });
		}

		const { error } = await adminClient
			.from('resumes')
			.delete()
			.eq('id', resumeId)
			.eq('talent_id', talentId);

		if (error) {
			return fail(500, { ok: false, message: error.message });
		}

		if (existing.is_main) {
			const { data: remaining } = await adminClient
				.from('resumes')
				.select('id')
				.eq('talent_id', talentId)
				.order('created_at', { ascending: false })
				.limit(1);

			if (remaining && remaining.length > 0) {
				await adminClient.from('resumes').update({ is_main: true }).eq('id', remaining[0].id);
			}
		}

		return { ok: true };
	}
};
