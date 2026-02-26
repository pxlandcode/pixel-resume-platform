import { getSupabaseAdminClient } from '$lib/server/supabase';
import type { Person, Resume, ResumeData, LocalizedText } from '$lib/types/resume';

export type Language = 'sv' | 'en';

export const getText = (text: LocalizedText, lang: Language) => {
	if (typeof text === 'string') return text;
	return text?.[lang] ?? text?.sv ?? '';
};

const admin = () => getSupabaseAdminClient();

const mapProfileToPerson = (row: any): Person => ({
	id: row.id,
	name: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unnamed',
	title: row.title ?? '',
	bio: row.bio ?? '',
	portraitId: undefined,
	avatar_url: row.avatar_url ?? null,
	techStack: Array.isArray(row.tech_stack) ? row.tech_stack : []
});

const emptyResumeData = (name = ''): ResumeData => ({
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
});

const normalizeResumeData = (content: any): ResumeData => {
	const base = emptyResumeData(content?.name ?? '');
	return {
		...base,
		...content,
		contacts: Array.isArray(content?.contacts) ? content.contacts : [],
		exampleSkills: Array.isArray(content?.exampleSkills) ? content.exampleSkills : [],
		highlightedExperiences: Array.isArray(content?.highlightedExperiences)
			? content.highlightedExperiences
			: [],
		experiences: Array.isArray(content?.experiences) ? content.experiences : [],
		techniques: Array.isArray(content?.techniques) ? content.techniques : [],
		methods: Array.isArray(content?.methods) ? content.methods : [],
		languages: Array.isArray(content?.languages) ? content.languages : [],
		education: Array.isArray(content?.education) ? content.education : [],
		portfolio: Array.isArray(content?.portfolio) ? content.portfolio : [],
		footerNote: content?.footerNote ?? ''
	};
};

const mapResumeRow = (row: any): Resume => ({
	id: String(row.id),
	personId: row.user_id,
	title: row.version_name ?? 'Resume',
	version: row.version_name ?? 'Main',
	updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
	isMain: Boolean(row.is_main),
	data: normalizeResumeData(row.content),
	avatar_url: row.avatar_url ?? null
});

export const ResumeService = {
	async getPeople(): Promise<Person[]> {
		const client = admin();
		if (!client) return [];
		const { data } = await client
			.from('profiles')
			.select('id, first_name, last_name, title, bio, tech_stack, avatar_url');
		return (data ?? []).map(mapProfileToPerson);
	},

	async getPerson(id: string): Promise<Person | undefined> {
		const client = admin();
		if (!client) return undefined;
		const { data } = await client
			.from('profiles')
			.select('id, first_name, last_name, title, bio, tech_stack, avatar_url')
			.eq('id', id)
			.maybeSingle();
		return data ? mapProfileToPerson(data) : undefined;
	},

	async getResumesForPerson(personId: string): Promise<Resume[]> {
		const client = admin();
		if (!client) return [];
		const { data } = await client
			.from('resumes')
			.select('id, user_id, version_name, is_main, is_active, content, updated_at, created_at')
			.eq('user_id', personId)
			.order('created_at', { ascending: false });
		return (data ?? []).map(mapResumeRow);
	},

	async getMainResume(personId: string): Promise<Resume | undefined> {
		const resumes = await this.getResumesForPerson(personId);
		return resumes.find((r) => r.isMain) ?? resumes[0];
	},

	async getResume(id: string): Promise<Resume | undefined> {
		const client = admin();
		if (!client) return undefined;
		const { data } = await client
			.from('resumes')
			.select('id, user_id, version_name, is_main, is_active, content, updated_at, created_at')
			.eq('id', id)
			.maybeSingle();
		return data ? mapResumeRow(data) : undefined;
	}
};
