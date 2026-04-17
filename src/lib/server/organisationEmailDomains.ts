import type { SupabaseClient } from '@supabase/supabase-js';

const DOMAIN_PATTERN =
	/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export class OrganisationEmailDomainError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'OrganisationEmailDomainError';
		this.status = status;
	}
}

export const normalizeEmailDomain = (value: string) => {
	const normalized = value.trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, '');
	if (!DOMAIN_PATTERN.test(normalized)) {
		throw new OrganisationEmailDomainError(
			400,
			`"${value}" is not a valid email domain. Use a value like example.com.`
		);
	}
	return normalized;
};

export const parseEmailDomainList = (
	value: FormDataEntryValue | FormDataEntryValue[] | string | string[] | null | undefined
) => {
	const parts: string[] = [];

	if (Array.isArray(value)) {
		for (const entry of value) {
			if (typeof entry === 'string') {
				parts.push(...entry.split(/[\s,;]+/));
			}
		}
	} else if (typeof value === 'string') {
		parts.push(...value.split(/[\s,;]+/));
	} else {
		return [];
	}

	const domains: string[] = [];
	const seen = new Set<string>();
	for (const part of parts) {
		const raw = part.trim();
		if (!raw) continue;
		const domain = normalizeEmailDomain(raw);
		if (seen.has(domain)) continue;
		seen.add(domain);
		domains.push(domain);
	}
	return domains;
};

export const getEmailDomainFromAddress = (email: string) => {
	const trimmed = email.trim().toLowerCase();
	const atIndex = trimmed.lastIndexOf('@');
	if (atIndex <= 0 || atIndex >= trimmed.length - 1) {
		throw new OrganisationEmailDomainError(400, 'A valid email address is required.');
	}
	return normalizeEmailDomain(trimmed.slice(atIndex + 1));
};

export const loadOrganisationEmailDomains = async (
	adminClient: SupabaseClient,
	organisationIds: string[]
) => {
	if (organisationIds.length === 0) return new Map<string, string[]>();

	const { data, error } = await adminClient
		.from('organisation_email_domains')
		.select('organisation_id, domain')
		.in('organisation_id', organisationIds)
		.order('domain', { ascending: true });

	if (error) throw new OrganisationEmailDomainError(500, error.message);

	const domainsByOrganisationId = new Map<string, string[]>();
	for (const row of (data ?? []) as Array<{
		organisation_id?: string | null;
		domain?: string | null;
	}>) {
		if (!row.organisation_id || !row.domain) continue;
		const domains = domainsByOrganisationId.get(row.organisation_id) ?? [];
		domains.push(row.domain);
		domainsByOrganisationId.set(row.organisation_id, domains);
	}
	return domainsByOrganisationId;
};

export const findOrganisationByEmailDomain = async (payload: {
	adminClient: SupabaseClient;
	domain: string;
}) => {
	const domain = normalizeEmailDomain(payload.domain);
	const { data, error } = await payload.adminClient
		.from('organisation_email_domains')
		.select('organisation_id')
		.eq('domain', domain)
		.maybeSingle();

	if (error) throw new OrganisationEmailDomainError(500, error.message);
	return typeof data?.organisation_id === 'string' ? data.organisation_id : null;
};

const assertEmailDomainsAvailable = async (payload: {
	adminClient: SupabaseClient;
	organisationId: string | null;
	domains: string[];
}) => {
	if (payload.domains.length === 0) return;

	const { data, error } = await payload.adminClient
		.from('organisation_email_domains')
		.select('organisation_id, domain, organisations(name)')
		.in('domain', payload.domains);

	if (error) throw new OrganisationEmailDomainError(500, error.message);

	for (const row of (data ?? []) as Array<{
		organisation_id?: string | null;
		domain?: string | null;
		organisations?: { name?: string | null } | Array<{ name?: string | null }> | null;
	}>) {
		if (!row.organisation_id || row.organisation_id === payload.organisationId) continue;
		const joined = Array.isArray(row.organisations) ? row.organisations[0] : row.organisations;
		const orgName = joined?.name ? ` by ${joined.name}` : '';
		throw new OrganisationEmailDomainError(
			409,
			`The domain ${row.domain ?? 'selected'} is already used${orgName}.`
		);
	}
};

export const replaceOrganisationEmailDomains = async (payload: {
	adminClient: SupabaseClient;
	organisationId: string;
	domains: string[];
}) => {
	await assertEmailDomainsAvailable(payload);

	const { data: existingRows, error: existingError } = await payload.adminClient
		.from('organisation_email_domains')
		.select('domain')
		.eq('organisation_id', payload.organisationId);
	if (existingError) throw new OrganisationEmailDomainError(500, existingError.message);

	const existingDomains = new Set(
		((existingRows ?? []) as Array<{ domain?: string | null }>)
			.map((row) => row.domain)
			.filter((domain): domain is string => typeof domain === 'string' && domain.length > 0)
	);
	const nextDomains = new Set(payload.domains);
	const rowsToInsert = payload.domains
		.filter((domain) => !existingDomains.has(domain))
		.map((domain) => ({
			organisation_id: payload.organisationId,
			domain
		}));

	if (rowsToInsert.length > 0) {
		const { error: insertError } = await payload.adminClient
			.from('organisation_email_domains')
			.insert(rowsToInsert);
		if (insertError) {
			const isDuplicate = insertError.code === '23505';
			throw new OrganisationEmailDomainError(
				isDuplicate ? 409 : 500,
				isDuplicate
					? 'One of these domains is already used by another organisation.'
					: insertError.message
			);
		}
	}

	const domainsToRemove = [...existingDomains].filter((domain) => !nextDomains.has(domain));
	if (domainsToRemove.length > 0) {
		const { error: deleteError } = await payload.adminClient
			.from('organisation_email_domains')
			.delete()
			.eq('organisation_id', payload.organisationId)
			.in('domain', domainsToRemove);
		if (deleteError) throw new OrganisationEmailDomainError(500, deleteError.message);
	}
};

export const assertOrganisationEmailDomainsAvailable = assertEmailDomainsAvailable;
