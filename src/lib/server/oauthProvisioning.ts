import type { SupabaseClient, User, UserIdentity } from '@supabase/supabase-js';
import {
	findOrganisationByEmailDomain,
	getEmailDomainFromAddress
} from '$lib/server/organisationEmailDomains';

const NEW_USER_DELETE_WINDOW_MS = 10 * 60 * 1000;

type InternalUserState = {
	hasProfile: boolean;
	hasRoles: boolean;
	homeOrganisationId: string | null;
	hasLinkedTalent: boolean;
	hasAnyInternalRecord: boolean;
};

export class MicrosoftOAuthProvisioningError extends Error {
	code: string;
	status: number;

	constructor(code: string, message: string, status = 403) {
		super(message);
		this.name = 'MicrosoftOAuthProvisioningError';
		this.code = code;
		this.status = status;
	}
}

const isExplicitFalse = (value: unknown) =>
	value === false || (typeof value === 'string' && value.trim().toLowerCase() === 'false');

const getAzureIdentity = (user: User): UserIdentity | null =>
	(user.identities ?? []).find((identity) => identity.provider === 'azure') ?? null;

const hasAzureProvider = (user: User) => {
	const providers = Array.isArray(user.app_metadata?.providers)
		? (user.app_metadata.providers as unknown[])
		: [];
	return (
		user.app_metadata?.provider === 'azure' ||
		providers.includes('azure') ||
		Boolean(getAzureIdentity(user))
	);
};

const isEmailConfirmed = (user: User) => Boolean(user.email_confirmed_at || user.confirmed_at);

const isAzureEmailExplicitlyUnverified = (user: User) => {
	const identityData = getAzureIdentity(user)?.identity_data ?? {};
	return isExplicitFalse(identityData.email_verified) || isExplicitFalse(identityData.xms_edov);
};

const isNewOAuthUser = (user: User) => {
	const createdAt = Date.parse(user.created_at);
	const azureIdentityCreatedAt = Date.parse(getAzureIdentity(user)?.created_at ?? '');
	return (
		Number.isFinite(createdAt) &&
		Number.isFinite(azureIdentityCreatedAt) &&
		Date.now() - createdAt <= NEW_USER_DELETE_WINDOW_MS &&
		Math.abs(createdAt - azureIdentityCreatedAt) <= 60_000
	);
};

const loadInternalUserState = async (
	adminClient: SupabaseClient,
	userId: string
): Promise<InternalUserState> => {
	const [profileResult, rolesResult, homeOrgResult, linkedTalentResult] = await Promise.all([
		adminClient.from('user_profiles').select('user_id').eq('user_id', userId).maybeSingle(),
		adminClient.from('user_roles').select('id').eq('user_id', userId),
		adminClient
			.from('organisation_users')
			.select('organisation_id')
			.eq('user_id', userId)
			.limit(1)
			.maybeSingle(),
		adminClient.from('talents').select('id').eq('user_id', userId).limit(1).maybeSingle()
	]);

	if (profileResult.error)
		throw new MicrosoftOAuthProvisioningError(
			'profile_lookup_failed',
			profileResult.error.message,
			500
		);
	if (rolesResult.error)
		throw new MicrosoftOAuthProvisioningError('role_lookup_failed', rolesResult.error.message, 500);
	if (homeOrgResult.error)
		throw new MicrosoftOAuthProvisioningError(
			'organisation_lookup_failed',
			homeOrgResult.error.message,
			500
		);
	if (linkedTalentResult.error)
		throw new MicrosoftOAuthProvisioningError(
			'talent_lookup_failed',
			linkedTalentResult.error.message,
			500
		);

	const hasProfile = Boolean(profileResult.data?.user_id);
	const hasRoles = (rolesResult.data ?? []).length > 0;
	const homeOrganisationId = homeOrgResult.data?.organisation_id ?? null;
	const hasLinkedTalent = Boolean(linkedTalentResult.data?.id);

	return {
		hasProfile,
		hasRoles,
		homeOrganisationId,
		hasLinkedTalent,
		hasAnyInternalRecord: hasProfile || hasRoles || Boolean(homeOrganisationId) || hasLinkedTalent
	};
};

const deleteNewAuthUserIfSafe = async (payload: {
	adminClient: SupabaseClient;
	user: User;
	state: InternalUserState;
}) => {
	if (!hasAzureProvider(payload.user)) return;
	if (!isNewOAuthUser(payload.user)) return;
	if (payload.state.hasAnyInternalRecord) return;
	await payload.adminClient.auth.admin.deleteUser(payload.user.id);
};

const resolveTalentRoleId = async (adminClient: SupabaseClient) => {
	const { data, error } = await adminClient
		.from('roles')
		.select('id')
		.eq('key', 'talent')
		.maybeSingle();
	if (error || !data?.id) {
		throw new MicrosoftOAuthProvisioningError(
			'role_missing',
			error?.message ?? "Missing role key 'talent' in public.roles.",
			500
		);
	}
	return data.id as string;
};

const deriveNameParts = (user: User) => {
	const metadata = user.user_metadata ?? {};
	const firstName =
		typeof metadata.first_name === 'string'
			? metadata.first_name.trim()
			: typeof metadata.given_name === 'string'
				? metadata.given_name.trim()
				: '';
	const lastName =
		typeof metadata.last_name === 'string'
			? metadata.last_name.trim()
			: typeof metadata.family_name === 'string'
				? metadata.family_name.trim()
				: '';
	if (firstName || lastName) return { firstName, lastName };

	const fullName =
		typeof metadata.name === 'string'
			? metadata.name.trim()
			: typeof metadata.full_name === 'string'
				? metadata.full_name.trim()
				: '';
	if (!fullName) return { firstName: '', lastName: '' };

	const [first, ...rest] = fullName.split(/\s+/);
	return {
		firstName: first ?? '',
		lastName: rest.join(' ')
	};
};

const deriveAvatarUrl = (user: User) => {
	const metadata = user.user_metadata ?? {};
	const value = metadata.avatar_url ?? metadata.picture;
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

export const provisionMicrosoftOAuthUser = async (payload: {
	adminClient: SupabaseClient;
	user: User;
}) => {
	const { adminClient, user } = payload;

	if (!hasAzureProvider(user)) {
		throw new MicrosoftOAuthProvisioningError(
			'not_microsoft',
			'This sign-in did not return a Microsoft identity.'
		);
	}

	const state = await loadInternalUserState(adminClient, user.id);

	if (typeof user.email !== 'string' || user.email.trim().length === 0) {
		await deleteNewAuthUserIfSafe({ adminClient, user, state });
		throw new MicrosoftOAuthProvisioningError(
			'missing_email',
			'A verified Microsoft work email is required.'
		);
	}

	if (!isEmailConfirmed(user) || isAzureEmailExplicitlyUnverified(user)) {
		await deleteNewAuthUserIfSafe({ adminClient, user, state });
		throw new MicrosoftOAuthProvisioningError(
			'unverified_email',
			'Your Microsoft email must be verified before you can sign in.'
		);
	}

	if (user.app_metadata?.active === false) {
		throw new MicrosoftOAuthProvisioningError(
			'inactive',
			'Account is inactive. Contact an administrator.'
		);
	}

	const hasCompleteInternalRecords = state.hasProfile && state.hasRoles && state.homeOrganisationId;
	if (hasCompleteInternalRecords) {
		return {
			userId: user.id,
			organisationId: state.homeOrganisationId,
			provisioned: false
		};
	}

	let domain: string;
	try {
		domain = getEmailDomainFromAddress(user.email);
	} catch {
		await deleteNewAuthUserIfSafe({ adminClient, user, state });
		throw new MicrosoftOAuthProvisioningError(
			'missing_email',
			'Microsoft did not return a valid email address for this account.'
		);
	}

	const organisationId = await findOrganisationByEmailDomain({ adminClient, domain });
	if (!organisationId) {
		await deleteNewAuthUserIfSafe({ adminClient, user, state });
		throw new MicrosoftOAuthProvisioningError(
			'unauthorized_domain',
			'Your Microsoft email domain is not allowed for this application.'
		);
	}

	const { firstName, lastName } = deriveNameParts(user);
	const email = user.email.trim().toLowerCase();

	if (!state.hasProfile) {
		const { error } = await adminClient.from('user_profiles').upsert(
			{
				user_id: user.id,
				first_name: firstName,
				last_name: lastName,
				email,
				avatar_url: deriveAvatarUrl(user)
			},
			{ onConflict: 'user_id' }
		);
		if (error)
			throw new MicrosoftOAuthProvisioningError('profile_upsert_failed', error.message, 500);
	}

	if (!state.hasRoles) {
		const roleId = await resolveTalentRoleId(adminClient);
		const { error } = await adminClient.from('user_roles').insert({
			user_id: user.id,
			role_id: roleId
		});
		if (error && error.code !== '23505') {
			throw new MicrosoftOAuthProvisioningError('role_insert_failed', error.message, 500);
		}

		const { error: metadataError } = await adminClient.auth.admin.updateUserById(user.id, {
			app_metadata: { ...user.app_metadata, active: true, role: 'talent', roles: ['talent'] }
		});
		if (metadataError) {
			throw new MicrosoftOAuthProvisioningError(
				'metadata_update_failed',
				metadataError.message,
				500
			);
		}
	}

	if (!state.homeOrganisationId) {
		const { error } = await adminClient.from('organisation_users').insert({
			organisation_id: organisationId,
			user_id: user.id
		});
		if (error && error.code !== '23505') {
			throw new MicrosoftOAuthProvisioningError('organisation_insert_failed', error.message, 500);
		}
	}

	return {
		userId: user.id,
		organisationId: state.homeOrganisationId ?? organisationId,
		provisioned: true
	};
};
