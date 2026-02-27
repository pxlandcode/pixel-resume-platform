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
		return await loadResumeData(client, resumeId);
	} catch {
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
