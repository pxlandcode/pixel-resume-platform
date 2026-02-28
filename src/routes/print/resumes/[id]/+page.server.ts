import type { PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { error } from '@sveltejs/kit';
import { getResumeEditPermissions } from '$lib/server/resumes/permissions';
import { getActorAccessContext, resolvePrintTemplateContext } from '$lib/server/access';
import { emptyResumeData, loadResumeData } from '$lib/server/resumes/store';
import type { Person, ResumeData } from '$lib/types/resume';
import { ResumeService } from '$lib/services/resume';

type ResumeRow = {
	id: number;
	talent_id: string;
	version_name: string | null;
	is_main: boolean | null;
	updated_at: string | null;
	created_at: string | null;
};

type TalentRow = {
	id: string;
	user_id: string | null;
	first_name: string | null;
	last_name: string | null;
	title: string | null;
	bio: string | null;
	avatar_url: string | null;
	tech_stack: unknown;
};

const hasPrimaryPrintContent = (data: ResumeData): boolean => {
	const hasLocalizedValue = (value: ResumeData['title'] | ResumeData['summary']) => {
		if (typeof value === 'string') return value.trim().length > 0;
		return Boolean((value?.sv ?? '').trim() || (value?.en ?? '').trim());
	};
	return Boolean(
		data.name.trim() ||
			hasLocalizedValue(data.title) ||
			hasLocalizedValue(data.summary) ||
			data.highlightedExperiences.length > 0 ||
			data.experiences.length > 0
	);
};

const mapTalentToPerson = (row: TalentRow): Person => ({
	id: row.id,
	name: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unnamed',
	title: row.title ?? '',
	bio: row.bio ?? '',
	portraitId: undefined,
	avatar_url: row.avatar_url ?? null,
	techStack: Array.isArray(row.tech_stack) ? row.tech_stack : []
});

const getResumeTitle = (data: ResumeData, fallback: string) => {
	if (typeof data.title === 'string') {
		const normalized = data.title.trim();
		return normalized || fallback;
	}
	const en = (data.title?.en ?? '').trim();
	if (en) return en;
	const sv = (data.title?.sv ?? '').trim();
	if (sv) return sv;
	return fallback;
};

const localizedLength = (
	value: ResumeData['title'] | ResumeData['summary'] | ResumeData['footerNote']
) => {
	if (typeof value === 'string') return value.trim().length;
	return Math.max((value?.sv ?? '').trim().length, (value?.en ?? '').trim().length);
};

const summarizeResumeData = (data: ResumeData) => ({
	name: data.name.trim(),
	titleLength: localizedLength(data.title),
	summaryLength: localizedLength(data.summary),
	footerLength: localizedLength(data.footerNote),
	contactsCount: data.contacts.length,
	exampleSkillsCount: data.exampleSkills.length,
	highlightedCount: data.highlightedExperiences.length,
	highlightedVisibleCount: data.highlightedExperiences.filter((exp) => !exp.hidden).length,
	experiencesCount: data.experiences.length,
	experiencesVisibleCount: data.experiences.filter((exp) => !exp.hidden).length,
	techniquesCount: data.techniques.length,
	methodsCount: data.methods.length,
	languagesCount: data.languages.length,
	educationCount: data.education.length,
	portfolioCount: data.portfolio.length
});

export const load: PageServerLoad = async ({ params, url, cookies }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();
	if (!supabase || !adminClient) {
		throw error(401, 'Unauthorized');
	}

	const debugEnabled = url.searchParams.get('debug') === '1';
	const debugLog = (stage: string, payload: Record<string, unknown>) => {
		if (!debugEnabled) return;
		console.log(`[print debug] ${stage}`, payload);
	};

	const langParam = url.searchParams.get('lang');
	const language = langParam === 'en' ? 'en' : 'sv';

	const resumeId = params.id;

	if (!resumeId) {
		throw error(400, 'Invalid resume id');
	}

	const { data: resumeRowData, error: resumeRowError } = await adminClient
		.from('resumes')
		.select('id, talent_id, version_name, is_main, updated_at, created_at')
		.eq('id', resumeId)
		.maybeSingle();
	if (resumeRowError || !resumeRowData) {
		throw error(404, 'Resume not found');
	}
	const resumeRow = resumeRowData as ResumeRow;
	debugLog('resume row loaded', {
		resumeId,
		talentId: resumeRow.talent_id,
		versionName: resumeRow.version_name,
		isMain: resumeRow.is_main
	});

	const permissions = await getResumeEditPermissions(supabase, adminClient, resumeRow.talent_id);
	debugLog('permissions resolved', {
		resumeId,
		canView: permissions.canView,
		canEdit: permissions.canEdit,
		canEditAll: permissions.canEditAll,
		isOwnProfile: permissions.isOwnProfile,
		roles: permissions.roles
	});
	if (!permissions.canView) {
		throw error(403, 'Not authorized to view this resume.');
	}

	let resumeData: ResumeData | null = null;
	let normalizedLoadError: string | null = null;
	let usedResumeServiceFallback = false;
	let usedEmptyResumeFallback = false;
	try {
		resumeData = await loadResumeData(adminClient, String(resumeRow.id));
		debugLog('normalized resume loaded', {
			resumeId,
			summary: summarizeResumeData(resumeData)
		});
	} catch (loadError) {
		normalizedLoadError = loadError instanceof Error ? loadError.message : 'Unknown error';
		console.warn('[print resume] failed to load normalized resume data', {
			resumeId,
			message: normalizedLoadError
		});
	}

	if (!resumeData || !hasPrimaryPrintContent(resumeData)) {
		debugLog('using ResumeService fallback', {
			resumeId,
			reason: !resumeData ? 'resumeData missing' : 'primary print content missing',
			currentSummary: resumeData ? summarizeResumeData(resumeData) : null
		});
		const fallbackResume = await ResumeService.getResume(String(resumeRow.id));
		if (fallbackResume?.data) {
			resumeData = fallbackResume.data;
			usedResumeServiceFallback = true;
			debugLog('ResumeService fallback loaded', {
				resumeId,
				summary: summarizeResumeData(resumeData)
			});
		}
	}

	if (!resumeData) {
		resumeData = emptyResumeData('');
		usedEmptyResumeFallback = true;
		debugLog('empty resume fallback used', { resumeId });
	}

	const { data: talentRowDataRaw } = await adminClient
		.from('talents')
		.select('id, user_id, first_name, last_name, title, bio, tech_stack, avatar_url')
		.eq('id', resumeRow.talent_id)
		.maybeSingle();

	const talentRowData = talentRowDataRaw as TalentRow | null;
	let avatarFromProfile: string | null = null;
	let usedProfileAvatarFallback = false;
	if (talentRowData?.user_id && !talentRowData.avatar_url) {
		const { data: profileRow } = await adminClient
			.from('user_profiles')
			.select('avatar_url')
			.eq('user_id', talentRowData.user_id)
			.maybeSingle();
		avatarFromProfile = (profileRow as { avatar_url?: string | null } | null)?.avatar_url ?? null;
		usedProfileAvatarFallback = Boolean(avatarFromProfile);
	}
	debugLog('talent profile resolved', {
		resumeId,
		talentFound: Boolean(talentRowData),
		talentUserId: talentRowData?.user_id ?? null,
		hasTalentAvatar: Boolean(talentRowData?.avatar_url),
		hasProfileAvatar: Boolean(avatarFromProfile),
		usedProfileAvatarFallback
	});

	const resumePerson = talentRowData
		? mapTalentToPerson({
				...talentRowData,
				avatar_url: talentRowData.avatar_url ?? avatarFromProfile
			})
		: null;
	const resume = {
		id: String(resumeRow.id),
		personId: resumeRow.talent_id,
		title: getResumeTitle(resumeData, resumeRow.version_name ?? 'Resume'),
		version: resumeRow.version_name ?? 'Main',
		updatedAt: resumeRow.updated_at ?? resumeRow.created_at ?? new Date().toISOString(),
		isMain: Boolean(resumeRow.is_main),
		data: resumeData
	};

	const actor = await getActorAccessContext(supabase, adminClient);
	const templateContext = await resolvePrintTemplateContext(adminClient, actor, resume.personId);
	debugLog('template context resolved', {
		resumeId,
		templateKey: templateContext?.templateKey ?? null,
		hasMainLogo: Boolean(templateContext?.mainLogotypeUrl),
		hasAccentLogo: Boolean(templateContext?.accentLogoUrl),
		hasEndLogo: Boolean(templateContext?.endLogoUrl),
		homepageUrl: templateContext?.homepageUrl ?? null
	});

	return {
		resume,
		resumePerson,
		templateContext,
		language,
		debug: {
			enabled: debugEnabled,
			resumeId: String(resumeRow.id),
			talentId: resumeRow.talent_id,
			normalizedLoadError,
			usedResumeServiceFallback,
			usedEmptyResumeFallback,
			usedProfileAvatarFallback,
			resumeSummary: summarizeResumeData(resumeData),
			resumePersonSummary: resumePerson
				? {
						id: resumePerson.id,
						name: resumePerson.name,
						title: resumePerson.title,
						hasAvatar: Boolean(resumePerson.avatar_url),
						techCategoryCount: resumePerson.techStack?.length ?? 0
					}
				: null,
			templateSummary: {
				templateKey: templateContext?.templateKey ?? null,
				hasMainLogo: Boolean(templateContext?.mainLogotypeUrl),
				hasAccentLogo: Boolean(templateContext?.accentLogoUrl),
				hasEndLogo: Boolean(templateContext?.endLogoUrl),
				homepageUrl: templateContext?.homepageUrl ?? null
			}
		},
		meta: {
			title: `Resume ${resume.title}`,
			description: 'Printable resume',
			noindex: true,
			path: `/print/resumes/${resumeId}`
		}
	};
};
