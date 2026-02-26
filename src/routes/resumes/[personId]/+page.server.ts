import type { Actions, PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { fail } from '@sveltejs/kit';
import { getResumeEditPermissions } from '$lib/server/resumes/permissions';
import {
	PROFILE_AVAILABILITY_SELECT,
	normalizeAvailabilityRow,
	parseAvailabilityForm,
	validateAvailability
} from '$lib/server/consultantAvailability';

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

	const { canEdit, canEditAll, isOwnProfile } = await getResumeEditPermissions(
		supabase,
		adminClient,
		params.personId
	);

	const [{ data: profile, error: profileError }, resumesResult, profileAvailabilityResult] =
		await Promise.all([
			adminClient
				.from('profiles')
				.select('id, first_name, last_name, avatar_url, title, bio, tech_stack')
				.eq('id', params.personId)
				.maybeSingle(),
			(async () => {
				if (!adminClient) return { data: null, error: new Error('Admin client unavailable') };
				try {
					const { data, error } = await adminClient
						.from('resumes')
						.select(
							'id, user_id, version_name, is_main, is_active, allow_word_export, content, preview_html, created_at, updated_at'
						)
						.eq('user_id', params.personId)
						.order('created_at', { ascending: false });

					return { data, error };
				} catch (err) {
					return { data: null, error: err as Error };
				}
			})(),
			(async () => {
				if (!adminClient) return { data: null, error: new Error('Admin client unavailable') };
				try {
					const { data, error } = await adminClient
						.from('profile_availability')
						.select(PROFILE_AVAILABILITY_SELECT)
						.eq('profile_id', params.personId)
						.maybeSingle();

					return { data, error };
				} catch (err) {
					return { data: null, error: err as Error };
				}
			})()
		]);

	if (profileError) {
		console.warn('[resumes detail] profile error', profileError);
	}
	if (resumesResult.error) {
		console.warn('[resumes detail] resumes error', resumesResult.error);
	}
	if (profileAvailabilityResult.error) {
		console.warn(
			'[resumes detail] profile_availability error',
			profileAvailabilityResult.error
		);
	}

	// Helper to extract English title from content
	const getEnglishTitle = (content: any): string | null => {
		const title = content?.title;
		if (!title) return null;
		if (typeof title === 'string') return title;
		if (typeof title === 'object' && title.en) return title.en;
		return null;
	};

	const resumes =
		resumesResult.data?.map((r) => ({
			id: String(r.id),
			user_id: r.user_id,
			version_name: getEnglishTitle(r.content) ?? r.version_name ?? 'Main',
			is_main: Boolean(r.is_main),
			is_active: Boolean(r.is_active ?? true),
			allow_word_export: Boolean(r.allow_word_export ?? false),
			content: r.content,
			preview_html: r.preview_html ?? null,
			created_at: r.created_at ?? null,
			updated_at: r.updated_at ?? r.created_at ?? null
		})) ?? [];

	return {
		profile: profile ?? null,
		availability: normalizeAvailabilityRow(profileAvailabilityResult.data ?? null),
		resumes,
		fromDb: Boolean(profile),
		canEdit,
		canEditAll,
		isOwnProfile
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
		const personId = formData.get('person_id') ?? params.personId;
		const bio = formData.get('bio');
		const techStackRaw = formData.get('tech_stack');

		if (typeof personId !== 'string') {
			return fail(400, { ok: false, message: 'Invalid user id' });
		}
		if (params.personId && params.personId !== personId) {
			return fail(400, { ok: false, message: 'Mismatched user id' });
		}
		if (typeof bio !== 'string') {
			return fail(400, { ok: false, message: 'Invalid bio' });
		}

		let techStack: unknown = null;
		if (typeof techStackRaw === 'string') {
			try {
				techStack = JSON.parse(techStackRaw);
			} catch (err) {
				return fail(400, { ok: false, message: 'Invalid tech stack JSON' });
			}
		}

		const { canEdit } = await getResumeEditPermissions(supabase, adminClient, personId);

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

		const { error } = await adminClient
			.from('profiles')
			.update({ bio, tech_stack: techStack })
			.eq('id', personId);

		if (error) {
			return fail(500, { ok: false, type: 'updateProfile', message: error.message });
		}

		const { error: profileAvailabilityError } = await adminClient.from('profile_availability').upsert(
			{
				profile_id: personId,
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
		const personId = formData.get('person_id') ?? params.personId;

		if (typeof personId !== 'string') {
			return fail(400, { ok: false, message: 'Invalid user id' });
		}

		const { canEdit } = await getResumeEditPermissions(supabase, adminClient, personId);

		if (!canEdit) {
			return fail(403, { ok: false, message: 'Not authorized to create resumes for this user' });
		}

		const { data: profileRow } = await adminClient
			.from('profiles')
			.select('first_name, last_name')
			.eq('id', personId)
			.maybeSingle();

		const name =
			[profileRow?.first_name, profileRow?.last_name].filter(Boolean).join(' ') || 'New resume';

		const { data, error } = await adminClient
			.from('resumes')
			.insert({
				user_id: personId,
				version_name: 'New Resume',
				is_main: false,
				is_active: true,
				allow_word_export: false,
				content: {
					name,
					title: '',
					summary: '',
					contacts: [],
					exampleSkills: [],
					highlightedExperiences: [],
					experiences: [],
					techniques: [],
					methods: [],
					languages: [],
					education: [],
					portfolio: [],
					footerNote: ''
				},
				preview_html: null
			})
			.select('id')
			.single();

		if (error) {
			return fail(500, { ok: false, message: error.message });
		}

		return { ok: true, id: data?.id };
	},
	updateResumeOrder: async ({ request, cookies, params }) => {
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		const adminClient = getSupabaseAdminClient();

		if (!supabase || !adminClient) {
			return fail(401, { ok: false, message: 'Unauthorized' });
		}

		const formData = await request.formData();
		const personId = formData.get('person_id') ?? params.personId;
		const orderRaw = formData.get('resume_order');

		if (typeof personId !== 'string') {
			return fail(400, { ok: false, message: 'Invalid user id' });
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
		} catch (err) {
			return fail(400, { ok: false, message: 'Invalid order JSON' });
		}

		if (orderedIds.length === 0) {
			return fail(400, { ok: false, message: 'Empty order' });
		}

		const { canEdit } = await getResumeEditPermissions(supabase, adminClient, personId);

		if (!canEdit) {
			return fail(403, { ok: false, message: 'Not authorized to reorder resumes for this user' });
		}

		// Set all to not main, then set the first as main
		await adminClient.from('resumes').update({ is_main: false }).eq('user_id', personId);
		await adminClient
			.from('resumes')
			.update({ is_main: true })
			.eq('user_id', personId)
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
		const personId = params.personId;

		if (typeof resumeId !== 'string') {
			return fail(400, { ok: false, message: 'Invalid resume id' });
		}

		const { canEdit } = await getResumeEditPermissions(supabase, adminClient, personId);

		if (!canEdit) {
			return fail(403, { ok: false, message: 'Not authorized to copy this resume' });
		}

		// Fetch the original resume
		const { data: original, error: fetchError } = await adminClient
			.from('resumes')
			.select('*')
			.eq('id', resumeId)
			.eq('user_id', personId)
			.maybeSingle();

		if (fetchError || !original) {
			return fail(404, { ok: false, message: 'Resume not found' });
		}

		// Get the English title from content for the copy name
		const content = original.content ?? {};
		const title = content.title;
		let copyTitle = 'Copy';
		if (typeof title === 'string' && title) {
			copyTitle = `${title} (Copy)`;
		} else if (typeof title === 'object' && title?.en) {
			copyTitle = `${title.en} (Copy)`;
		} else if (original.version_name) {
			copyTitle = `${original.version_name} (Copy)`;
		}

		// Insert the copy
		const { data, error } = await adminClient
			.from('resumes')
			.insert({
				user_id: personId,
				version_name: copyTitle,
				is_main: false,
				is_active: original.is_active ?? true,
				allow_word_export: original.allow_word_export ?? false,
				content: original.content,
				preview_html: original.preview_html
			})
			.select('id')
			.single();

		if (error) {
			return fail(500, { ok: false, message: error.message });
		}

		return { ok: true, id: data?.id };
	},

	deleteResume: async ({ request, cookies, params }) => {
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		const adminClient = getSupabaseAdminClient();

		if (!supabase || !adminClient) {
			return fail(401, { ok: false, message: 'Unauthorized' });
		}

		const formData = await request.formData();
		const resumeId = formData.get('resume_id');
		const personId = params.personId;

		if (typeof resumeId !== 'string') {
			return fail(400, { ok: false, message: 'Invalid resume id' });
		}

		const { canEdit } = await getResumeEditPermissions(supabase, adminClient, personId);

		if (!canEdit) {
			return fail(403, { ok: false, message: 'Not authorized to delete this resume' });
		}

		// Check the resume belongs to this person
		const { data: existing } = await adminClient
			.from('resumes')
			.select('id, user_id, is_main')
			.eq('id', resumeId)
			.eq('user_id', personId)
			.maybeSingle();

		if (!existing) {
			return fail(404, { ok: false, message: 'Resume not found' });
		}

		// Delete the resume
		const { error } = await adminClient
			.from('resumes')
			.delete()
			.eq('id', resumeId)
			.eq('user_id', personId);

		if (error) {
			return fail(500, { ok: false, message: error.message });
		}

		// If deleted resume was main, set a new main
		if (existing.is_main) {
			const { data: remaining } = await adminClient
				.from('resumes')
				.select('id')
				.eq('user_id', personId)
				.order('created_at', { ascending: false })
				.limit(1);

			if (remaining && remaining.length > 0) {
				await adminClient.from('resumes').update({ is_main: true }).eq('id', remaining[0].id);
			}
		}

		return { ok: true };
	}
};
