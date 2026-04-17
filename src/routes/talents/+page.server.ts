import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { siteMeta } from '$lib/seo';
import {
	getActorAccessContext,
	getAccessibleTalentAccess,
	getTalentAccess
} from '$lib/server/access';
import {
	extractRequestMetadata,
	recordEmployerAssertion,
	writeAuditLog,
	type LawfulBasisType
} from '$lib/server/legalService';
import { assertAcceptedForSensitiveAction } from '$lib/server/legalGate';

const canManageTalents = (actor: Awaited<ReturnType<typeof getActorAccessContext>>) =>
	actor.isAdmin || actor.isBroker || actor.isEmployer;

const LAWFUL_BASIS_TYPES = new Set<LawfulBasisType>([
	'consent_obtained',
	'contract',
	'legitimate_interest',
	'other'
]);

const getActorContext = async (cookies: { get(name: string): string | undefined }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();
	const actor = await getActorAccessContext(supabase, adminClient);
	return { supabase, adminClient, actor };
};

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

const parseCheckedValue = (value: FormDataEntryValue | null) =>
	value === 'on' || value === 'true' || value === '1';

const parseTalentId = (formData: FormData) => {
	const value = formData.get('talent_id');
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

export const load: PageServerLoad = async ({ locals }) => {
	const requestContext = locals.requestContext;
	const supabase = requestContext.getSupabaseClient();
	const adminClient = requestContext.getAdminClient();

	if (!supabase || !adminClient) {
		return {
			talents: [],
			organisationOptions: [],
			homeOrganisationId: null,
			canManageTalents: false,
			meta: null
		};
	}
	const actor = await requestContext.getActorContext();
	if (!actor.userId) {
		return {
			talents: [],
			organisationOptions: [],
			homeOrganisationId: null,
			canManageTalents: false,
			meta: null
		};
	}

	const accessibleTalentAccess = await getAccessibleTalentAccess(adminClient, actor);
	const accessibleTalentIds =
		accessibleTalentAccess === null ? null : accessibleTalentAccess.map((entry) => entry.talentId);
	const accessLevelByTalentId =
		accessibleTalentAccess === null
			? null
			: new Map(
					accessibleTalentAccess.map((entry) => [entry.talentId, entry.accessLevel] as const)
				);

	const talentsResult =
		accessibleTalentIds === null
			? await adminClient
					.from('talents')
					.select('id, user_id, first_name, last_name, avatar_url, title')
					.order('last_name', { ascending: true })
					.order('first_name', { ascending: true })
			: accessibleTalentIds.length === 0
				? {
						data: [] as Array<{
							id: string;
							user_id: string | null;
							first_name: string | null;
							last_name: string | null;
							avatar_url: string | null;
							title: string | null;
						}>,
						error: null
					}
				: await adminClient
						.from('talents')
						.select('id, user_id, first_name, last_name, avatar_url, title')
						.in('id', accessibleTalentIds)
						.order('last_name', { ascending: true })
						.order('first_name', { ascending: true });

	if (talentsResult.error) {
		console.warn('[talents index] talents error', talentsResult.error);
	}

	const talentRows = talentsResult.data ?? [];
	const talentIds = talentRows.map((t) => t.id);

	const [orgMembershipsResult, resumeRowsResult] =
		talentIds.length === 0
			? [
					{ data: [] as Array<{ talent_id: string; organisation_id: string }>, error: null },
					{ data: [] as Array<{ talent_id: string }>, error: null }
				]
			: await Promise.all([
					adminClient
						.from('organisation_talents')
						.select('talent_id, organisation_id')
						.in('talent_id', talentIds),
					adminClient.from('resumes').select('talent_id').in('talent_id', talentIds)
				]);

	if (orgMembershipsResult.error) {
		console.warn('[talents index] organisation_talents error', orgMembershipsResult.error);
	}
	if (resumeRowsResult.error) {
		console.warn('[talents index] resumes error', resumeRowsResult.error);
	}

	const orgIdByTalentId = new Map<string, string>();
	for (const row of orgMembershipsResult.data ?? []) {
		orgIdByTalentId.set(row.talent_id, row.organisation_id);
	}
	const resumeCountByTalentId = new Map<string, number>();
	for (const row of resumeRowsResult.data ?? []) {
		const nextCount = (resumeCountByTalentId.get(row.talent_id) ?? 0) + 1;
		resumeCountByTalentId.set(row.talent_id, nextCount);
	}

	const orgIds = Array.from(new Set(orgIdByTalentId.values()));

	// Fetch organisations and templates
	const [orgsResult, templatesResult] =
		orgIds.length === 0
			? [
					{ data: [] as Array<{ id: string; name: string }>, error: null },
					{
						data: [] as Array<{ organisation_id: string; main_logotype_path: string | null }>,
						error: null
					}
				]
			: await Promise.all([
					adminClient.from('organisations').select('id, name').in('id', orgIds),
					adminClient
						.from('organisation_templates')
						.select('organisation_id, main_logotype_path')
						.in('organisation_id', orgIds)
				]);

	if (orgsResult.error) {
		console.warn('[talents index] organisations error', orgsResult.error);
	}
	if (templatesResult.error) {
		console.warn('[talents index] organisation_templates error', templatesResult.error);
	}

	const orgById = new Map<string, { name: string; logoUrl: string | null }>();
	for (const org of orgsResult.data ?? []) {
		orgById.set(org.id, { name: org.name, logoUrl: null });
	}
	for (const template of templatesResult.data ?? []) {
		const existing = orgById.get(template.organisation_id);
		if (existing) {
			existing.logoUrl = resolveStoragePublicUrl(adminClient, template.main_logotype_path);
		}
	}

	const talents = talentRows.map((talent) => {
		const orgId = orgIdByTalentId.get(talent.id);
		const org = orgId ? orgById.get(orgId) : undefined;
		return {
			id: talent.id,
			user_id: talent.user_id,
			first_name: talent.first_name ?? '',
			last_name: talent.last_name ?? '',
			avatar_url: talent.avatar_url ?? null,
			title: talent.title ?? '',
			resume_count: resumeCountByTalentId.get(talent.id) ?? 0,
			can_edit:
				accessLevelByTalentId === null ? true : accessLevelByTalentId.get(talent.id) === 'write',
			organisation_id: orgId ?? null,
			organisation_name: org?.name ?? null,
			organisation_logo_url: org?.logoUrl ?? null
		};
	});

	const accessibleOrgRowsResult = actor.isAdmin
		? await adminClient.from('organisations').select('id, name').order('name', { ascending: true })
		: actor.accessibleOrganisationIds.length === 0
			? { data: [] as Array<{ id: string; name: string }>, error: null }
			: await adminClient
					.from('organisations')
					.select('id, name')
					.in('id', actor.accessibleOrganisationIds)
					.order('name', { ascending: true });

	if (accessibleOrgRowsResult.error) {
		console.warn('[talents index] accessible organisations error', accessibleOrgRowsResult.error);
	}

	const organisationOptions = (accessibleOrgRowsResult.data ?? []).map((org) => ({
		id: org.id,
		name: org.name
	}));

	return {
		talents,
		organisationOptions,
		homeOrganisationId: actor.homeOrganisationId ?? null,
		canManageTalents: canManageTalents(actor),
		meta: {
			title: `${siteMeta.name} — Talents`,
			description: 'Browse and manage talents.',
			noindex: true,
			path: '/talents'
		}
	};
};

export const actions: Actions = {
	createTalent: async ({ request, cookies }) => {
		const { adminClient, actor } = await getActorContext(cookies);
		if (!adminClient || !actor.userId) {
			return fail(401, { type: 'createTalent', ok: false, message: 'You are not authenticated.' });
		}
		if (!canManageTalents(actor)) {
			return fail(403, {
				type: 'createTalent',
				ok: false,
				message: 'Not authorized to manage talents.'
			});
		}

		if (!actor.homeOrganisationId) {
			return fail(400, {
				type: 'createTalent',
				ok: false,
				message: 'Connect your account to a home organisation before creating talents.'
			});
		}

		try {
			await assertAcceptedForSensitiveAction({
				adminClient,
				userId: actor.userId,
				homeOrganisationId: actor.homeOrganisationId
			});
		} catch (acceptanceError) {
			return fail(403, {
				type: 'createTalent',
				ok: false,
				message:
					acceptanceError instanceof Error
						? acceptanceError.message
						: 'You must accept current legal documents before creating talents.'
			});
		}

		const formData = await request.formData();
		const firstNameRaw = formData.get('first_name');
		const lastNameRaw = formData.get('last_name');
		const titleRaw = formData.get('title');
		const avatarRaw = formData.get('avatar_url');
		const lawfulBasisTypeRaw = formData.get('lawful_basis_type');
		const lawfulBasisDetailsRaw = formData.get('lawful_basis_details');
		const lawfulBasisConfirmedRaw = formData.get('lawful_basis_confirmed');

		const first_name = typeof firstNameRaw === 'string' ? firstNameRaw.trim() : '';
		const last_name = typeof lastNameRaw === 'string' ? lastNameRaw.trim() : '';
		const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
		const avatar_url =
			typeof avatarRaw === 'string' && avatarRaw.trim().length > 0 ? avatarRaw.trim() : null;
		const lawfulBasisType =
			typeof lawfulBasisTypeRaw === 'string' &&
			LAWFUL_BASIS_TYPES.has(lawfulBasisTypeRaw as LawfulBasisType)
				? (lawfulBasisTypeRaw as LawfulBasisType)
				: null;
		const lawfulBasisDetails =
			typeof lawfulBasisDetailsRaw === 'string' && lawfulBasisDetailsRaw.trim().length > 0
				? lawfulBasisDetailsRaw.trim()
				: null;
		const lawfulBasisConfirmed = parseCheckedValue(lawfulBasisConfirmedRaw);

		if (!first_name && !last_name) {
			return fail(400, {
				type: 'createTalent',
				ok: false,
				message: 'Provide at least first name or last name.'
			});
		}
		if (!lawfulBasisConfirmed) {
			return fail(400, {
				type: 'createTalent',
				ok: false,
				message: 'You must confirm lawful basis before creating a talent without a linked user.'
			});
		}
		if (!lawfulBasisType) {
			return fail(400, {
				type: 'createTalent',
				ok: false,
				message: 'Lawful basis type is required.'
			});
		}

		const { data: insertedTalent, error: insertError } = await adminClient
			.from('talents')
			.insert({
				user_id: null,
				first_name,
				last_name,
				title,
				bio: '',
				avatar_url
			})
			.select('id')
			.single();

		if (insertError || !insertedTalent?.id) {
			return fail(500, { type: 'createTalent', ok: false, message: insertError?.message });
		}

		const { error: membershipError } = await adminClient.from('organisation_talents').insert({
			organisation_id: actor.homeOrganisationId,
			talent_id: insertedTalent.id
		});

		if (membershipError) {
			await adminClient.from('talents').delete().eq('id', insertedTalent.id);
			return fail(500, {
				type: 'createTalent',
				ok: false,
				message: 'Talent creation was rolled back because home organisation linking failed.'
			});
		}

		const requestMeta = extractRequestMetadata({
			request,
			getClientAddress: () => ''
		});

		try {
			await recordEmployerAssertion({
				client: adminClient,
				employerUserId: actor.userId,
				organisationId: actor.homeOrganisationId,
				talentId: insertedTalent.id,
				lawfulBasisType,
				lawfulBasisDetails,
				ipAddress: requestMeta.ipAddress,
				userAgent: requestMeta.userAgent
			});
		} catch (assertionError) {
			await adminClient.from('organisation_talents').delete().eq('talent_id', insertedTalent.id);
			await adminClient.from('talents').delete().eq('id', insertedTalent.id);
			return fail(500, {
				type: 'createTalent',
				ok: false,
				message:
					assertionError instanceof Error
						? assertionError.message
						: 'Talent creation was rolled back because lawful basis assertion failed.'
			});
		}

		await writeAuditLog({
			actorUserId: actor.userId,
			organisationId: actor.homeOrganisationId,
			actionType: 'TALENT_CREATED',
			resourceType: 'talent',
			resourceId: insertedTalent.id,
			metadata: {
				talent_id: insertedTalent.id,
				organisation_id: actor.homeOrganisationId,
				created_without_user_account: true
			}
		});
		await writeAuditLog({
			actorUserId: actor.userId,
			organisationId: actor.homeOrganisationId,
			actionType: 'ASSERTION_CONFIRMED',
			resourceType: 'talent',
			resourceId: insertedTalent.id,
			metadata: {
				talent_id: insertedTalent.id,
				organisation_id: actor.homeOrganisationId,
				lawful_basis_type: lawfulBasisType,
				lawful_basis_details: lawfulBasisDetails
			}
		});

		return {
			type: 'createTalent',
			ok: true,
			message: 'Talent created successfully.'
		};
	},

	updateTalent: async ({ request, cookies }) => {
		const { adminClient, actor } = await getActorContext(cookies);
		if (!adminClient || !actor.userId) {
			return fail(401, { type: 'updateTalent', ok: false, message: 'You are not authenticated.' });
		}
		if (!canManageTalents(actor)) {
			return fail(403, {
				type: 'updateTalent',
				ok: false,
				message: 'Not authorized to manage talents.'
			});
		}

		try {
			await assertAcceptedForSensitiveAction({
				adminClient,
				userId: actor.userId,
				homeOrganisationId: actor.homeOrganisationId
			});
		} catch (acceptanceError) {
			return fail(403, {
				type: 'updateTalent',
				ok: false,
				message:
					acceptanceError instanceof Error
						? acceptanceError.message
						: 'You must accept current legal documents before updating talents.'
			});
		}

		const formData = await request.formData();
		const talentId = parseTalentId(formData);
		const firstNameRaw = formData.get('first_name');
		const lastNameRaw = formData.get('last_name');
		const titleRaw = formData.get('title');
		const avatarRaw = formData.get('avatar_url');

		if (!talentId) {
			return fail(400, { type: 'updateTalent', ok: false, message: 'Talent ID is required.' });
		}

		const access = await getTalentAccess(adminClient, actor, talentId);
		if (!access.exists) {
			return fail(404, { type: 'updateTalent', ok: false, message: 'Talent not found.' });
		}
		if (!access.canEdit) {
			return fail(403, {
				type: 'updateTalent',
				ok: false,
				message: 'Not authorized to edit this talent.'
			});
		}

		const first_name = typeof firstNameRaw === 'string' ? firstNameRaw.trim() : '';
		const last_name = typeof lastNameRaw === 'string' ? lastNameRaw.trim() : '';
		const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
		const avatar_url =
			typeof avatarRaw === 'string' && avatarRaw.trim().length > 0 ? avatarRaw.trim() : null;

		if (!first_name && !last_name) {
			return fail(400, {
				type: 'updateTalent',
				ok: false,
				message: 'Provide at least first name or last name.'
			});
		}

		const { data: updatedTalent, error: updateError } = await adminClient
			.from('talents')
			.update({
				first_name,
				last_name,
				title,
				avatar_url,
				updated_at: new Date().toISOString()
			})
			.eq('id', talentId)
			.select('id, user_id')
			.maybeSingle();

		if (updateError) {
			return fail(500, { type: 'updateTalent', ok: false, message: updateError.message });
		}
		if (!updatedTalent?.id) {
			return fail(404, { type: 'updateTalent', ok: false, message: 'Talent not found.' });
		}

		if (updatedTalent.user_id) {
			const { error: linkedUserProfileError } = await adminClient.from('user_profiles').upsert(
				{
					user_id: updatedTalent.user_id,
					avatar_url
				},
				{ onConflict: 'user_id' }
			);

			if (linkedUserProfileError) {
				return fail(500, {
					type: 'updateTalent',
					ok: false,
					message: linkedUserProfileError.message
				});
			}
		}

		const auditOrganisationId = access.talentOrganisationId ?? actor.homeOrganisationId;
		if (auditOrganisationId) {
			await writeAuditLog({
				actorUserId: actor.userId,
				organisationId: auditOrganisationId,
				actionType: 'TALENT_UPDATED',
				resourceType: 'talent',
				resourceId: talentId,
				metadata: {
					talent_id: talentId,
					linked_user_id: updatedTalent.user_id ?? null,
					avatar_url
				}
			});
		}

		return {
			type: 'updateTalent',
			ok: true,
			message: 'Talent updated successfully.'
		};
	},

	deleteTalent: async ({ request, cookies }) => {
		const { adminClient, actor } = await getActorContext(cookies);
		if (!adminClient || !actor.userId) {
			return fail(401, { type: 'deleteTalent', ok: false, message: 'You are not authenticated.' });
		}
		if (!canManageTalents(actor)) {
			return fail(403, {
				type: 'deleteTalent',
				ok: false,
				message: 'Not authorized to manage talents.'
			});
		}

		try {
			await assertAcceptedForSensitiveAction({
				adminClient,
				userId: actor.userId,
				homeOrganisationId: actor.homeOrganisationId
			});
		} catch (acceptanceError) {
			return fail(403, {
				type: 'deleteTalent',
				ok: false,
				message:
					acceptanceError instanceof Error
						? acceptanceError.message
						: 'You must accept current legal documents before deleting talents.'
			});
		}

		const formData = await request.formData();
		const talentId = parseTalentId(formData);
		if (!talentId) {
			return fail(400, { type: 'deleteTalent', ok: false, message: 'Talent ID is required.' });
		}

		const access = await getTalentAccess(adminClient, actor, talentId);
		if (!access.exists) {
			return fail(404, { type: 'deleteTalent', ok: false, message: 'Talent not found.' });
		}
		if (!access.canEdit) {
			return fail(403, {
				type: 'deleteTalent',
				ok: false,
				message: 'Not authorized to delete this talent.'
			});
		}

		const [talentRowResult, resumeCountResult] = await Promise.all([
			adminClient.from('talents').select('id, user_id').eq('id', talentId).maybeSingle(),
			adminClient
				.from('resumes')
				.select('id', { count: 'exact', head: true })
				.eq('talent_id', talentId)
		]);

		if (talentRowResult.error) {
			return fail(500, {
				type: 'deleteTalent',
				ok: false,
				message: talentRowResult.error.message
			});
		}
		if (resumeCountResult.error) {
			return fail(500, {
				type: 'deleteTalent',
				ok: false,
				message: resumeCountResult.error.message
			});
		}
		if (!talentRowResult.data?.id) {
			return fail(404, { type: 'deleteTalent', ok: false, message: 'Talent not found.' });
		}

		const linkedUserId = talentRowResult.data.user_id ?? null;
		const resumeCount = Number(resumeCountResult.count ?? 0);
		const confirmedDeleteResumes = parseCheckedValue(formData.get('confirm_delete_resumes'));
		const confirmedUnlinkUser = parseCheckedValue(formData.get('confirm_unlink_user'));

		if (resumeCount > 0 && !confirmedDeleteResumes) {
			return fail(400, {
				type: 'deleteTalent',
				ok: false,
				message: 'Confirm that you want to delete this talent and all linked resumes.'
			});
		}
		if (linkedUserId && !confirmedUnlinkUser) {
			return fail(400, {
				type: 'deleteTalent',
				ok: false,
				message: 'Confirm that you want to unlink the linked user account.'
			});
		}

		if (resumeCount > 0) {
			const { error: clearMainResumeError } = await adminClient
				.from('resumes')
				.update({ is_main: false })
				.eq('talent_id', talentId)
				.eq('is_main', true);

			if (clearMainResumeError) {
				return fail(500, {
					type: 'deleteTalent',
					ok: false,
					message: clearMainResumeError.message
				});
			}
		}

		const { error: deleteError } = await adminClient.from('talents').delete().eq('id', talentId);
		if (deleteError) {
			return fail(500, { type: 'deleteTalent', ok: false, message: deleteError.message });
		}

		const auditOrganisationId = access.talentOrganisationId ?? actor.homeOrganisationId;
		if (auditOrganisationId) {
			await writeAuditLog({
				actorUserId: actor.userId,
				organisationId: auditOrganisationId,
				actionType: 'TALENT_DELETED',
				resourceType: 'talent',
				resourceId: talentId,
				metadata: {
					talent_id: talentId,
					linked_user_id: linkedUserId,
					linked_user_was_unlinked: Boolean(linkedUserId),
					deleted_resume_count: resumeCount
				}
			});
		}

		return {
			type: 'deleteTalent',
			ok: true,
			message: 'Talent deleted successfully.'
		};
	}
};
