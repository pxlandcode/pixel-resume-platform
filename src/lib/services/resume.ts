import { getSupabaseAdminClient } from '$lib/server/supabase';
import { emptyResumeData, loadResumeData } from '$lib/server/resumes/store';
import type { Person, Resume, ResumeData, LocalizedText } from '$lib/types/resume';

export type Language = 'sv' | 'en';

export const getText = (text: LocalizedText, lang: Language) => {
	if (typeof text === 'string') return text;
	return text?.[lang] ?? text?.sv ?? '';
};

const admin = () => getSupabaseAdminClient();

type TalentRow = {
	id: string;
	first_name: string | null;
	last_name: string | null;
	title: string | null;
	bio: string | null;
	avatar_url: string | null;
	tech_stack: unknown;
};

type ResumeRow = {
	id: string | number;
	talent_id: string;
	version_name: string | null;
	is_main: boolean | null;
	updated_at: string | null;
	created_at: string | null;
	avatar_url?: string | null;
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

const getResumeTitleFromData = (data: ResumeData, fallback: string) => {
	const title = data.title;
	if (typeof title === 'string') {
		const normalized = title.trim();
		return normalized || fallback;
	}
	const fromEnglish = title?.en?.trim() ?? '';
	if (fromEnglish) return fromEnglish;
	const fromSwedish = title?.sv?.trim() ?? '';
	if (fromSwedish) return fromSwedish;
	return fallback;
};

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeLocalized = (value: unknown): ResumeData['title'] => {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const sv = normalizeText(record.sv);
		const en = normalizeText(record.en);
		if (sv || en) {
			return { sv: sv || en, en: en || sv };
		}
	}
	return '';
};

const normalizeStringArray = (value: unknown): string[] =>
	Array.isArray(value)
		? value
				.filter((entry): entry is string => typeof entry === 'string')
				.map((entry) => entry.trim())
				.filter(Boolean)
		: [];

const normalizeLegacyResumeData = (value: unknown): ResumeData | null => {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const source =
		raw && raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : raw;

	const data: ResumeData = {
		...emptyResumeData(normalizeText(source.name)),
		name: normalizeText(source.name),
		title: normalizeLocalized(source.title),
		summary: normalizeLocalized(source.summary),
		contacts: Array.isArray(source.contacts)
			? (source.contacts as Array<Record<string, unknown>>).map((contact) => ({
					name: normalizeText(contact?.name),
					phone: normalizeText(contact?.phone) || null,
					email: normalizeText(contact?.email) || null
				}))
			: [],
		exampleSkills: normalizeStringArray(source.exampleSkills),
		highlightedExperiences: Array.isArray(source.highlightedExperiences)
			? (source.highlightedExperiences as ResumeData['highlightedExperiences'])
			: [],
		experiences: Array.isArray(source.experiences)
			? (source.experiences as ResumeData['experiences'])
			: [],
		techniques: normalizeStringArray(source.techniques),
		methods: normalizeStringArray(source.methods),
		languages: Array.isArray(source.languages) ? (source.languages as ResumeData['languages']) : [],
		education: Array.isArray(source.education) ? (source.education as ResumeData['education']) : [],
		portfolio: normalizeStringArray(source.portfolio),
		footerNote: normalizeLocalized(source.footerNote)
	};

	return data;
};

const hasResumeContent = (data: ResumeData): boolean => {
	const hasLocalizedValue = (value: LocalizedText | undefined) => {
		if (!value) return false;
		if (typeof value === 'string') return value.trim().length > 0;
		return (value.sv ?? '').trim().length > 0 || (value.en ?? '').trim().length > 0;
	};

	return Boolean(
		data.name.trim() ||
			hasLocalizedValue(data.title) ||
			hasLocalizedValue(data.summary) ||
			data.contacts.length > 0 ||
			data.exampleSkills.length > 0 ||
			data.highlightedExperiences.length > 0 ||
			data.experiences.length > 0 ||
			data.techniques.length > 0 ||
			data.methods.length > 0 ||
			data.languages.length > 0 ||
			data.education.length > 0 ||
			(data.portfolio?.length ?? 0) > 0 ||
			hasLocalizedValue(data.footerNote)
	);
};

const loadLegacyResumeContent = async (
	client: NonNullable<ReturnType<typeof admin>>,
	resumeId: string
): Promise<ResumeData | null> => {
	const { data, error } = await client
		.from('resumes')
		.select('content')
		.eq('id', resumeId)
		.maybeSingle();

	if (error) {
		// Fresh normalized DBs intentionally remove resumes.content.
		if (error.code === '42703' || /column .*content.* does not exist/i.test(error.message)) {
			return null;
		}
		console.warn('[resume service] failed to read legacy resumes.content fallback', {
			resumeId,
			message: error.message
		});
		return null;
	}

	return normalizeLegacyResumeData((data as { content?: unknown } | null)?.content);
};

const mapResumeRow = (row: ResumeRow, data: ResumeData): Resume => {
	const fallbackTitle = row.version_name ?? 'Resume';
	return {
		id: String(row.id),
		personId: row.talent_id,
		title: getResumeTitleFromData(data, fallbackTitle),
		version: row.version_name ?? 'Main',
		updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
		isMain: Boolean(row.is_main),
		data,
		avatar_url: row.avatar_url ?? null
	};
};

const loadResumeDataSafe = async (
	client: NonNullable<ReturnType<typeof admin>>,
	resumeId: string
) => {
	try {
		const normalizedData = await loadResumeData(client, resumeId);
		if (hasResumeContent(normalizedData)) {
			return normalizedData;
		}

		const legacyData = await loadLegacyResumeContent(client, resumeId);
		if (legacyData && hasResumeContent(legacyData)) {
			console.warn(
				'[resume service] using legacy resumes.content fallback for empty normalized resume',
				{
					resumeId
				}
			);
			return legacyData;
		}

		return normalizedData;
	} catch (loadError) {
		console.warn('[resume service] normalized load failed, trying legacy fallback', {
			resumeId,
			message: loadError instanceof Error ? loadError.message : 'Unknown error'
		});

		const legacyData = await loadLegacyResumeContent(client, resumeId);
		if (legacyData && hasResumeContent(legacyData)) {
			console.warn('[resume service] using legacy resumes.content fallback after load failure', {
				resumeId
			});
			return legacyData;
		}

		return emptyResumeData('');
	}
};

export const ResumeService = {
	async getPeople(): Promise<Person[]> {
		const client = admin();
		if (!client) return [];
		const { data } = await client
			.from('talents')
			.select('id, first_name, last_name, title, bio, tech_stack, avatar_url');
		return (data ?? []).map((row) => mapTalentToPerson(row as TalentRow));
	},

	async getPerson(id: string): Promise<Person | undefined> {
		const client = admin();
		if (!client) return undefined;
		const { data } = await client
			.from('talents')
			.select('id, first_name, last_name, title, bio, tech_stack, avatar_url')
			.eq('id', id)
			.maybeSingle();
		return data ? mapTalentToPerson(data as TalentRow) : undefined;
	},

	async getResumesForPerson(personId: string): Promise<Resume[]> {
		const client = admin();
		if (!client) return [];

		const { data } = await client
			.from('resumes')
			.select('id, talent_id, version_name, is_main, is_active, updated_at, created_at')
			.eq('talent_id', personId)
			.order('created_at', { ascending: false });

		const rows = data ?? [];
		const withData = await Promise.all(
			rows.map(async (row) => ({
				row,
				data: await loadResumeDataSafe(client, String(row.id))
			}))
		);

		return withData.map(({ row, data }) => mapResumeRow(row as ResumeRow, data));
	},

	async getMainResume(personId: string): Promise<Resume | undefined> {
		const resumes = await this.getResumesForPerson(personId);
		return resumes.find((resume) => resume.isMain) ?? resumes[0];
	},

	async getResume(id: string): Promise<Resume | undefined> {
		const client = admin();
		if (!client) return undefined;

		const { data } = await client
			.from('resumes')
			.select('id, talent_id, version_name, is_main, is_active, updated_at, created_at')
			.eq('id', id)
			.maybeSingle();

		if (!data) return undefined;
		const resumeData = await loadResumeDataSafe(client, String(data.id));
		return mapResumeRow(data as ResumeRow, resumeData);
	}
};
