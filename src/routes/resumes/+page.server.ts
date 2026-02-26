import type { PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { siteMeta } from '$lib/seo';
import {
	PROFILE_AVAILABILITY_SELECT,
	normalizeAvailabilityRow
} from '$lib/server/consultantAvailability';

const toStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
};

const uniq = (values: string[]) => {
	const seen = new Set<string>();
	const uniqueValues: string[] = [];

	for (const value of values) {
		const key = value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		uniqueValues.push(value);
	}

	return uniqueValues;
};

const extractProfileTechs = (techStack: unknown): string[] => {
	if (!Array.isArray(techStack)) return [];

	const skills: string[] = [];
	for (const category of techStack) {
		if (!category || typeof category !== 'object') continue;
		skills.push(...toStringArray((category as { skills?: unknown }).skills));
	}

	return uniq(skills);
};

const extractExperienceTechs = (items: unknown): string[] => {
	if (!Array.isArray(items)) return [];

	const skills: string[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object') continue;
		skills.push(...toStringArray((item as { technologies?: unknown }).technologies));
	}

	return skills;
};

const extractResumeTechs = (content: unknown): string[] => {
	if (!content || typeof content !== 'object') return [];

	const data = content as {
		techniques?: unknown;
		methods?: unknown;
		exampleSkills?: unknown;
		highlightedExperiences?: unknown;
		experiences?: unknown;
	};

	return uniq([
		...toStringArray(data.techniques),
		...toStringArray(data.methods),
		...toStringArray(data.exampleSkills),
		...extractExperienceTechs(data.highlightedExperiences),
		...extractExperienceTechs(data.experiences)
	]);
};

export const load: PageServerLoad = async ({ cookies }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);

	if (!supabase) {
		return { employees: [], meta: null };
	}

	const adminClient = getSupabaseAdminClient();

	if (!adminClient) {
		return { employees: [], meta: null };
	}

	const [{ data: profiles }, rolesResult, authUsersResult] = await Promise.all([
		adminClient
			.from('profiles')
			.select('id, first_name, last_name, avatar_url, tech_stack')
			.order('last_name', { ascending: true }),
		(async () => {
			if (!adminClient) return { data: null, error: new Error('Admin client unavailable') };
			return adminClient.from('user_roles').select('user_id, role').eq('role', 'employee');
		})(),
		(async () => {
			if (!adminClient) return { data: null, error: new Error('Admin client unavailable') };
			const { data, error } = await adminClient.auth.admin.listUsers();
			return { data: data?.users ?? null, error };
		})()
	]);

	const roles = rolesResult.data ?? [];
	const employeeIds = new Set<string>();
	for (const row of roles ?? []) {
		if (row.role === 'employee') {
			employeeIds.add(row.user_id);
		}
	}

	const authMap = new Map<string, { email?: string; isEmployee?: boolean }>();
	for (const user of authUsersResult.data ?? []) {
		const rolesFromAuth = Array.isArray(user.app_metadata?.roles)
			? (user.app_metadata?.roles as string[])
			: typeof user.app_metadata?.role === 'string'
				? [user.app_metadata.role as string]
				: [];
		const isEmployee = rolesFromAuth.includes('employee') || rolesFromAuth.includes('employees');

		if (isEmployee) {
			employeeIds.add(user.id);
		}

		authMap.set(user.id, {
			email: user.email ?? undefined,
			isEmployee
		});
	}

	const employeeIdList = Array.from(employeeIds);
	const resumesResult =
		employeeIdList.length === 0
			? { data: [] as Array<{ user_id: string; content: unknown }>, error: null }
			: await adminClient.from('resumes').select('user_id, content').in('user_id', employeeIdList);

	const profileAvailabilityResult =
		employeeIdList.length === 0
			? {
					data: [] as Array<{
						profile_id: string;
						availability_now_percent: number | null;
						availability_future_percent: number | null;
						availability_notice_period_days: number | null;
						availability_planned_from_date: string | null;
					}>,
					error: null
				}
			: await adminClient
					.from('profile_availability')
					.select(PROFILE_AVAILABILITY_SELECT)
					.in('profile_id', employeeIdList);

	if (resumesResult.error) {
		console.warn('[resumes index] resumes error', resumesResult.error);
	}
	if (profileAvailabilityResult.error) {
		console.warn(
			'[resumes index] profile_availability error',
			profileAvailabilityResult.error
		);
	}

	const resumeTechMap = new Map<string, Set<string>>();
	for (const row of resumesResult.data ?? []) {
		const userId = typeof row.user_id === 'string' ? row.user_id : '';
		if (!userId) continue;

		if (!resumeTechMap.has(userId)) {
			resumeTechMap.set(userId, new Set<string>());
		}

		const techSet = resumeTechMap.get(userId)!;
		for (const tech of extractResumeTechs(row.content)) {
			techSet.add(tech);
		}
	}

	const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
	const availabilityMap = new Map<string, ReturnType<typeof normalizeAvailabilityRow>>();
	for (const row of profileAvailabilityResult.data ?? []) {
		const profileId = typeof row.profile_id === 'string' ? row.profile_id : '';
		if (!profileId) continue;
		availabilityMap.set(profileId, normalizeAvailabilityRow(row));
	}

	const employees = employeeIdList.map((id) => {
		const profile = profileMap.get(id);
		const profileTechs = extractProfileTechs(profile?.tech_stack);
		const resumeTechs = Array.from(resumeTechMap.get(id) ?? []);

		return {
			id,
			first_name: profile?.first_name ?? '',
			last_name: profile?.last_name ?? '',
			avatar_url: profile?.avatar_url ?? null,
			email: authMap.get(id)?.email ?? null,
			search_techs: uniq([...profileTechs, ...resumeTechs]),
			availability: availabilityMap.get(id) ?? normalizeAvailabilityRow(null)
		};
	});

	return {
		employees,
		meta: {
			title: `${siteMeta.name} — Resumes`,
			description: 'Manage consultant resumes and export packages.',
			noindex: true,
			path: '/resumes'
		}
	};
};
