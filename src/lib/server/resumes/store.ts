import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	ExperienceItem,
	HighlightedExperience,
	LabeledItem,
	LocalizedText,
	ResumeData,
	ExperienceLibraryItem
} from '$lib/types/resume';

type LanguagePair = { sv: string; en: string };

type ResumeOwnershipRow = {
	id: string;
	talent_id: string;
};

type ExperienceLibraryRow = {
	id: string;
	talent_id: string;
	start_date: string;
	end_date: string | null;
	company: string;
	location_sv: string;
	location_en: string;
	role_sv: string;
	role_en: string;
	description_sv: string;
	description_en: string;
};

type ResumeExperienceRow = {
	id: string;
	resume_id: string;
	experience_id: string | null;
	section: 'highlighted' | 'experience';
	position: number;
	hidden: boolean;
	start_date_override: string | null;
	end_date_override: string | null;
	company_override: string | null;
	location_sv_override: string | null;
	location_en_override: string | null;
	role_sv_override: string | null;
	role_en_override: string | null;
	description_sv_override: string | null;
	description_en_override: string | null;
	use_tech_override: boolean;
};

type NormalizedExperienceInput = {
	section: 'highlighted' | 'experience';
	libraryId: string | null;
	saveToLibrary: boolean;
	startDate: string;
	endDate: string | null;
	company: string;
	location: LanguagePair;
	role: LanguagePair;
	description: LanguagePair;
	technologies: string[];
	hidden: boolean;
};

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeId = (value: unknown): string | null => {
	if (typeof value === 'string') {
		const normalized = value.trim();
		return normalized || null;
	}
	if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
		return String(value);
	}
	return null;
};

const normalizeOptionalString = (value: unknown): string | null => {
	if (value === null) return null;
	const normalized = normalizeString(value);
	return normalized || null;
};

const normalizeStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];

	const seen = new Set<string>();
	const items: string[] = [];
	for (const entry of value) {
		const normalized = normalizeString(entry);
		if (!normalized) continue;
		const key = normalized.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		items.push(normalized);
	}

	return items;
};

const asLanguagePair = (value: LocalizedText | null | undefined): LanguagePair => {
	if (typeof value === 'string') {
		const normalized = normalizeString(value);
		return { sv: normalized, en: normalized };
	}

	const sv = normalizeString(value?.sv);
	const en = normalizeString(value?.en);
	const fallback = sv || en;
	return {
		sv: sv || fallback,
		en: en || fallback
	};
};

const localizedFromColumns = (sv: unknown, en: unknown): LanguagePair => {
	const svNormalized = normalizeString(sv);
	const enNormalized = normalizeString(en);
	const fallback = svNormalized || enNormalized;
	return {
		sv: svNormalized || fallback,
		en: enNormalized || fallback
	};
};

const arrayShallowEqual = (left: string[], right: string[]) => {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
};

const parseLibraryId = (value: unknown): string | null => normalizeId(value);

const withNullableOverride = (current: string | null, base: string | null): string | null => {
	const normalizedCurrent = current === null ? null : normalizeString(current);
	const normalizedBase = base === null ? null : normalizeString(base);
	if (normalizedCurrent === normalizedBase) return null;
	return normalizedCurrent;
};

const formatExperienceItem = (
	item: ResumeExperienceRow,
	base: ExperienceLibraryRow | null,
	libraryTechByExperienceId: Map<string, string[]>,
	overrideTechByItemId: Map<string, string[]>
) => {
	const baseStartDate = normalizeString(base?.start_date ?? '');
	const baseEndDate =
		base?.end_date === null ? null : (normalizeOptionalString(base?.end_date ?? null) ?? null);
	const baseCompany = normalizeString(base?.company ?? '');
	const baseLocation = localizedFromColumns(base?.location_sv, base?.location_en);
	const baseRole = localizedFromColumns(base?.role_sv, base?.role_en);
	const baseDescription = localizedFromColumns(base?.description_sv, base?.description_en);

	const location = localizedFromColumns(
		item.location_sv_override ?? baseLocation.sv,
		item.location_en_override ?? baseLocation.en
	);
	const role = localizedFromColumns(
		item.role_sv_override ?? baseRole.sv,
		item.role_en_override ?? baseRole.en
	);
	const description = localizedFromColumns(
		item.description_sv_override ?? baseDescription.sv,
		item.description_en_override ?? baseDescription.en
	);

	const startDate = normalizeString(item.start_date_override ?? baseStartDate);
	const endDateRaw = item.end_date_override ?? baseEndDate;
	const endDate = endDateRaw === null ? null : (normalizeOptionalString(endDateRaw) ?? '');
	const company = normalizeString(item.company_override ?? baseCompany);
	const technologies =
		item.use_tech_override || !item.experience_id
			? (overrideTechByItemId.get(item.id) ?? [])
			: (libraryTechByExperienceId.get(item.experience_id) ?? []);

	return {
		libraryId: item.experience_id ? String(item.experience_id) : null,
		startDate,
		endDate,
		company,
		location,
		role,
		description,
		technologies,
		hidden: Boolean(item.hidden)
	};
};

const ensureResumeOwnership = async (
	adminClient: SupabaseClient,
	resumeId: string,
	talentId: string
): Promise<ResumeOwnershipRow> => {
	const { data, error } = await adminClient
		.from('resumes')
		.select('id, talent_id')
		.eq('id', resumeId)
		.maybeSingle();

	if (error || !data) {
		throw new Error(error?.message ?? 'Resume not found.');
	}

	if (data.talent_id !== talentId) {
		throw new Error('Resume does not belong to this talent.');
	}

	return data as ResumeOwnershipRow;
};

const normalizeExperienceInput = (
	rawItem: ExperienceItem | HighlightedExperience,
	section: 'experience' | 'highlighted'
): NormalizedExperienceInput => {
	const role = asLanguagePair(rawItem.role);
	const description = asLanguagePair(rawItem.description);
	const technologies = normalizeStringArray(rawItem.technologies);
	const libraryId = parseLibraryId((rawItem as { libraryId?: unknown }).libraryId);

	if (section === 'experience') {
		const item = rawItem as ExperienceItem;
		return {
			section,
			libraryId,
			saveToLibrary: Boolean((rawItem as { saveToLibrary?: unknown }).saveToLibrary),
			startDate: normalizeString(item.startDate),
			endDate: item.endDate === null ? null : (normalizeOptionalString(item.endDate) ?? ''),
			company: normalizeString(item.company),
			location: asLanguagePair(item.location ?? ''),
			role,
			description,
			technologies,
			hidden: Boolean(item.hidden)
		};
	}

	return {
		section,
		libraryId,
		saveToLibrary: Boolean((rawItem as { saveToLibrary?: unknown }).saveToLibrary),
		startDate: '',
		endDate: null,
		company: normalizeString(rawItem.company),
		location: asLanguagePair(''),
		role,
		description,
		technologies,
		hidden: Boolean(rawItem.hidden)
	};
};

export const emptyResumeData = (name = ''): ResumeData => ({
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

const saveSimpleSections = async (
	adminClient: SupabaseClient,
	resumeId: string,
	data: ResumeData
) => {
	const title = asLanguagePair(data.title);
	const summary = asLanguagePair(data.summary);
	const footerNote = asLanguagePair(data.footerNote ?? '');

	const { error: basicError } = await adminClient.from('resume_basics').upsert(
		{
			resume_id: resumeId,
			name: normalizeString(data.name),
			title_sv: title.sv,
			title_en: title.en,
			summary_sv: summary.sv,
			summary_en: summary.en,
			footer_note_sv: footerNote.sv,
			footer_note_en: footerNote.en,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'resume_id' }
	);
	if (basicError) throw new Error(basicError.message);

	const contacts = Array.isArray(data.contacts) ? data.contacts : [];
	const { error: deleteContactsError } = await adminClient
		.from('resume_contacts')
		.delete()
		.eq('resume_id', resumeId);
	if (deleteContactsError) throw new Error(deleteContactsError.message);

	if (contacts.length > 0) {
		const contactRows = contacts.map((contact, index) => ({
			resume_id: resumeId,
			position: index,
			name: normalizeString(contact.name),
			phone: normalizeOptionalString(contact.phone),
			email: normalizeOptionalString(contact.email)
		}));
		const { error: insertContactsError } = await adminClient
			.from('resume_contacts')
			.insert(contactRows);
		if (insertContactsError) throw new Error(insertContactsError.message);
	}

	const { error: deleteSkillsError } = await adminClient
		.from('resume_skill_items')
		.delete()
		.eq('resume_id', resumeId);
	if (deleteSkillsError) throw new Error(deleteSkillsError.message);

	const skillRows: Array<{
		resume_id: string;
		kind: 'example' | 'technique' | 'method';
		position: number;
		value: string;
	}> = [];
	for (const [index, value] of normalizeStringArray(data.exampleSkills).entries()) {
		skillRows.push({ resume_id: resumeId, kind: 'example', position: index, value });
	}
	for (const [index, value] of normalizeStringArray(data.techniques).entries()) {
		skillRows.push({ resume_id: resumeId, kind: 'technique', position: index, value });
	}
	for (const [index, value] of normalizeStringArray(data.methods).entries()) {
		skillRows.push({ resume_id: resumeId, kind: 'method', position: index, value });
	}
	if (skillRows.length > 0) {
		const { error: insertSkillsError } = await adminClient
			.from('resume_skill_items')
			.insert(skillRows);
		if (insertSkillsError) throw new Error(insertSkillsError.message);
	}

	const { error: deleteLabelsError } = await adminClient
		.from('resume_labeled_items')
		.delete()
		.eq('resume_id', resumeId);
	if (deleteLabelsError) throw new Error(deleteLabelsError.message);

	const labeledRows: Array<{
		resume_id: string;
		kind: 'language' | 'education';
		position: number;
		label_sv: string;
		label_en: string;
		value_sv: string;
		value_en: string;
	}> = [];

	const toLabeledRows = (items: LabeledItem[], kind: 'language' | 'education') => {
		for (const [index, item] of items.entries()) {
			const label = asLanguagePair(item.label);
			const value = asLanguagePair(item.value);
			labeledRows.push({
				resume_id: resumeId,
				kind,
				position: index,
				label_sv: label.sv,
				label_en: label.en,
				value_sv: value.sv,
				value_en: value.en
			});
		}
	};

	toLabeledRows(Array.isArray(data.languages) ? data.languages : [], 'language');
	toLabeledRows(Array.isArray(data.education) ? data.education : [], 'education');

	if (labeledRows.length > 0) {
		const { error: insertLabelsError } = await adminClient
			.from('resume_labeled_items')
			.insert(labeledRows);
		if (insertLabelsError) throw new Error(insertLabelsError.message);
	}

	const { error: deletePortfolioError } = await adminClient
		.from('resume_portfolio_items')
		.delete()
		.eq('resume_id', resumeId);
	if (deletePortfolioError) throw new Error(deletePortfolioError.message);

	const portfolioRows = normalizeStringArray(data.portfolio ?? []).map((url, index) => ({
		resume_id: resumeId,
		position: index,
		url
	}));
	if (portfolioRows.length > 0) {
		const { error: insertPortfolioError } = await adminClient
			.from('resume_portfolio_items')
			.insert(portfolioRows);
		if (insertPortfolioError) throw new Error(insertPortfolioError.message);
	}
};

const saveExperienceSection = async (
	adminClient: SupabaseClient,
	resumeId: string,
	talentId: string,
	section: 'experience' | 'highlighted',
	items: Array<ExperienceItem | HighlightedExperience>
) => {
	const normalizedItems = items.map((item) => normalizeExperienceInput(item, section));
	const existingLibraryIds = Array.from(
		new Set(normalizedItems.map((item) => item.libraryId).filter((id): id is string => id !== null))
	);

	const libraryById = new Map<string, ExperienceLibraryRow>();
	const libraryTechByExperienceId = new Map<string, string[]>();

	if (existingLibraryIds.length > 0) {
		const { data: libraryRows, error: libraryError } = await adminClient
			.from('experience_library')
			.select(
				'id, talent_id, start_date, end_date, company, location_sv, location_en, role_sv, role_en, description_sv, description_en'
			)
			.eq('talent_id', talentId)
			.in('id', existingLibraryIds);
		if (libraryError) throw new Error(libraryError.message);

		for (const row of (libraryRows ?? []) as ExperienceLibraryRow[]) {
			libraryById.set(row.id, row);
		}

		const { data: libraryTechRows, error: libraryTechError } = await adminClient
			.from('experience_library_technologies')
			.select('experience_id, value, position')
			.in('experience_id', existingLibraryIds)
			.order('position', { ascending: true });
		if (libraryTechError) throw new Error(libraryTechError.message);

		for (const row of libraryTechRows ?? []) {
			const experienceId = normalizeId((row as { experience_id: unknown }).experience_id);
			const value = normalizeString((row as { value: unknown }).value);
			if (!experienceId || !value) continue;
			const existing = libraryTechByExperienceId.get(experienceId) ?? [];
			existing.push(value);
			libraryTechByExperienceId.set(experienceId, existing);
		}
	}

	type ResolvedExperienceInput = NormalizedExperienceInput & {
		resolvedLibraryId: string | null;
	};
	const resolvedItems: ResolvedExperienceInput[] = [];

	for (const item of normalizedItems) {
		let resolvedLibraryId = item.libraryId;
		let baseLibraryRow = resolvedLibraryId ? (libraryById.get(resolvedLibraryId) ?? null) : null;
		const shouldCreateLibrary = item.saveToLibrary || Boolean(resolvedLibraryId && !baseLibraryRow);

		if (shouldCreateLibrary && (!baseLibraryRow || !resolvedLibraryId)) {
			const { data: insertedLibrary, error: insertLibraryError } = await adminClient
				.from('experience_library')
				.insert({
					talent_id: talentId,
					start_date: item.startDate,
					end_date: item.endDate,
					company: item.company,
					location_sv: item.location.sv,
					location_en: item.location.en,
					role_sv: item.role.sv,
					role_en: item.role.en,
					description_sv: item.description.sv,
					description_en: item.description.en
				})
				.select(
					'id, talent_id, start_date, end_date, company, location_sv, location_en, role_sv, role_en, description_sv, description_en'
				)
				.single();
			if (insertLibraryError || !insertedLibrary) {
				throw new Error(insertLibraryError?.message ?? 'Failed to create experience library item.');
			}

			const insertedLibraryId = normalizeId((insertedLibrary as { id: unknown }).id);
			if (!insertedLibraryId) {
				throw new Error('Created experience library item returned an invalid id.');
			}
			resolvedLibraryId = insertedLibraryId;
			baseLibraryRow = insertedLibrary as ExperienceLibraryRow;
			libraryById.set(resolvedLibraryId, baseLibraryRow);

			if (item.technologies.length > 0) {
				const techRows = item.technologies.map((value, index) => ({
					experience_id: resolvedLibraryId,
					position: index,
					value
				}));
				const { error: insertLibraryTechError } = await adminClient
					.from('experience_library_technologies')
					.insert(techRows);
				if (insertLibraryTechError) throw new Error(insertLibraryTechError.message);
			}
			libraryTechByExperienceId.set(resolvedLibraryId, [...item.technologies]);
		}

		resolvedItems.push({ ...item, resolvedLibraryId });
	}

	const { error: deleteSectionError } = await adminClient
		.from('resume_experience_items')
		.delete()
		.eq('resume_id', resumeId)
		.eq('section', section);
	if (deleteSectionError) throw new Error(deleteSectionError.message);

	if (resolvedItems.length === 0) return;

	const rowsToInsert = resolvedItems.map((item, index) => {
		const base = item.resolvedLibraryId ? (libraryById.get(item.resolvedLibraryId) ?? null) : null;
		if (item.resolvedLibraryId && !base) {
			throw new Error('Experience library item missing while saving resume section.');
		}
		const baseLocation = localizedFromColumns(base?.location_sv, base?.location_en);
		const baseRole = localizedFromColumns(base?.role_sv, base?.role_en);
		const baseDescription = localizedFromColumns(base?.description_sv, base?.description_en);
		const baseTech = item.resolvedLibraryId
			? (libraryTechByExperienceId.get(item.resolvedLibraryId) ?? [])
			: [];

		const startDateOverride = withNullableOverride(
			item.startDate || null,
			normalizeString(base?.start_date ?? '') || null
		);
		const endDateOverride = withNullableOverride(
			item.endDate,
			base?.end_date === null ? null : normalizeOptionalString(base?.end_date ?? null)
		);
		const companyOverride = withNullableOverride(
			item.company || null,
			normalizeString(base?.company ?? '') || null
		);
		const locationSvOverride = withNullableOverride(
			item.location.sv || null,
			baseLocation.sv || null
		);
		const locationEnOverride = withNullableOverride(
			item.location.en || null,
			baseLocation.en || null
		);
		const roleSvOverride = withNullableOverride(item.role.sv || null, baseRole.sv || null);
		const roleEnOverride = withNullableOverride(item.role.en || null, baseRole.en || null);
		const descriptionSvOverride = withNullableOverride(
			item.description.sv || null,
			baseDescription.sv || null
		);
		const descriptionEnOverride = withNullableOverride(
			item.description.en || null,
			baseDescription.en || null
		);
		const useTechOverride = item.resolvedLibraryId
			? !arrayShallowEqual(item.technologies, baseTech)
			: true;

		return {
			resume_id: resumeId,
			experience_id: item.resolvedLibraryId,
			section,
			position: index,
			hidden: item.hidden,
			start_date_override: startDateOverride,
			end_date_override: endDateOverride,
			company_override: companyOverride,
			location_sv_override: locationSvOverride,
			location_en_override: locationEnOverride,
			role_sv_override: roleSvOverride,
			role_en_override: roleEnOverride,
			description_sv_override: descriptionSvOverride,
			description_en_override: descriptionEnOverride,
			use_tech_override: useTechOverride
		};
	});

	const { data: insertedRows, error: insertSectionError } = await adminClient
		.from('resume_experience_items')
		.insert(rowsToInsert)
		.select('id, position');
	if (insertSectionError) throw new Error(insertSectionError.message);

	const insertedByPosition = new Map<number, string>();
	for (const row of insertedRows ?? []) {
		const position = Number((row as { position: unknown }).position);
		const id = normalizeId((row as { id: unknown }).id);
		if (!Number.isInteger(position) || !id) continue;
		insertedByPosition.set(position, id);
	}

	const overrideRows: Array<{
		resume_experience_item_id: string;
		position: number;
		value: string;
	}> = [];
	for (const [position, normalizedItem] of resolvedItems.entries()) {
		const insertedId = insertedByPosition.get(position);
		if (!insertedId) continue;

		if (normalizedItem.resolvedLibraryId) {
			const baseTech = libraryTechByExperienceId.get(normalizedItem.resolvedLibraryId) ?? [];
			if (arrayShallowEqual(normalizedItem.technologies, baseTech)) continue;
		}
		if (normalizedItem.technologies.length === 0) continue;

		normalizedItem.technologies.forEach((value, techIndex) => {
			overrideRows.push({
				resume_experience_item_id: insertedId,
				position: techIndex,
				value
			});
		});
	}

	if (overrideRows.length > 0) {
		const { error: insertOverridesError } = await adminClient
			.from('resume_experience_tech_overrides')
			.insert(overrideRows);
		if (insertOverridesError) throw new Error(insertOverridesError.message);
	}
};

export const loadResumeData = async (
	adminClient: SupabaseClient,
	resumeId: string
): Promise<ResumeData> => {
	const { data: resumeRow, error: resumeError } = await adminClient
		.from('resumes')
		.select('id')
		.eq('id', resumeId)
		.maybeSingle();

	if (resumeError || !resumeRow) {
		throw new Error(resumeError?.message ?? 'Resume not found.');
	}

	const [
		basicsResult,
		contactsResult,
		skillsResult,
		labeledResult,
		portfolioResult,
		experienceItemsResult
	] = await Promise.all([
		adminClient
			.from('resume_basics')
			.select('name, title_sv, title_en, summary_sv, summary_en, footer_note_sv, footer_note_en')
			.eq('resume_id', resumeId)
			.maybeSingle(),
		adminClient
			.from('resume_contacts')
			.select('position, name, phone, email')
			.eq('resume_id', resumeId)
			.order('position', { ascending: true }),
		adminClient
			.from('resume_skill_items')
			.select('kind, position, value')
			.eq('resume_id', resumeId)
			.order('position', { ascending: true }),
		adminClient
			.from('resume_labeled_items')
			.select('kind, position, label_sv, label_en, value_sv, value_en')
			.eq('resume_id', resumeId)
			.order('position', { ascending: true }),
		adminClient
			.from('resume_portfolio_items')
			.select('position, url')
			.eq('resume_id', resumeId)
			.order('position', { ascending: true }),
		adminClient
			.from('resume_experience_items')
			.select(
				'id, resume_id, experience_id, section, position, hidden, start_date_override, end_date_override, company_override, location_sv_override, location_en_override, role_sv_override, role_en_override, description_sv_override, description_en_override, use_tech_override'
			)
			.eq('resume_id', resumeId)
			.order('section', { ascending: true })
			.order('position', { ascending: true })
	]);

	if (basicsResult.error) throw new Error(basicsResult.error.message);
	if (contactsResult.error) throw new Error(contactsResult.error.message);
	if (skillsResult.error) throw new Error(skillsResult.error.message);
	if (labeledResult.error) throw new Error(labeledResult.error.message);
	if (portfolioResult.error) throw new Error(portfolioResult.error.message);
	if (experienceItemsResult.error) throw new Error(experienceItemsResult.error.message);

	const experienceItems = (experienceItemsResult.data ?? []) as ResumeExperienceRow[];
	const experienceIds = Array.from(
		new Set(
			experienceItems
				.map((row) => row.experience_id)
				.filter((id): id is string => typeof id === 'string' && id.length > 0)
		)
	);
	const experienceItemIds = experienceItems.map((row) => row.id);

	const libraryById = new Map<string, ExperienceLibraryRow>();
	const libraryTechByExperienceId = new Map<string, string[]>();
	const overrideTechByItemId = new Map<string, string[]>();

	if (experienceIds.length > 0) {
		const { data: libraryRows, error: libraryError } = await adminClient
			.from('experience_library')
			.select(
				'id, talent_id, start_date, end_date, company, location_sv, location_en, role_sv, role_en, description_sv, description_en'
			)
			.in('id', experienceIds);
		if (libraryError) throw new Error(libraryError.message);
		for (const row of (libraryRows ?? []) as ExperienceLibraryRow[]) {
			libraryById.set(row.id, row);
		}

		const { data: libraryTechRows, error: libraryTechError } = await adminClient
			.from('experience_library_technologies')
			.select('experience_id, value, position')
			.in('experience_id', experienceIds)
			.order('position', { ascending: true });
		if (libraryTechError) throw new Error(libraryTechError.message);
		for (const row of libraryTechRows ?? []) {
			const experienceId = normalizeId((row as { experience_id: unknown }).experience_id);
			const value = normalizeString((row as { value: unknown }).value);
			if (!experienceId || !value) continue;
			const existing = libraryTechByExperienceId.get(experienceId) ?? [];
			existing.push(value);
			libraryTechByExperienceId.set(experienceId, existing);
		}
	}

	if (experienceItemIds.length > 0) {
		const { data: overrideRows, error: overrideError } = await adminClient
			.from('resume_experience_tech_overrides')
			.select('resume_experience_item_id, value, position')
			.in('resume_experience_item_id', experienceItemIds)
			.order('position', { ascending: true });
		if (overrideError) throw new Error(overrideError.message);
		for (const row of overrideRows ?? []) {
			const itemId = normalizeId(
				(row as { resume_experience_item_id: unknown }).resume_experience_item_id
			);
			const value = normalizeString((row as { value: unknown }).value);
			if (!itemId || !value) continue;
			const existing = overrideTechByItemId.get(itemId) ?? [];
			existing.push(value);
			overrideTechByItemId.set(itemId, existing);
		}
	}

	const highlightedExperiences = experienceItems
		.filter((item) => item.section === 'highlighted')
		.map((item) => {
			const base = item.experience_id ? (libraryById.get(item.experience_id) ?? null) : null;
			const formatted = formatExperienceItem(
				item,
				base,
				libraryTechByExperienceId,
				overrideTechByItemId
			);
			return {
				libraryId: formatted.libraryId,
				company: formatted.company,
				role: formatted.role,
				description: formatted.description,
				technologies: formatted.technologies,
				hidden: formatted.hidden
			};
		});

	const experiences = experienceItems
		.filter((item) => item.section === 'experience')
		.map((item) => {
			const base = item.experience_id ? (libraryById.get(item.experience_id) ?? null) : null;
			const formatted = formatExperienceItem(
				item,
				base,
				libraryTechByExperienceId,
				overrideTechByItemId
			);
			return {
				libraryId: formatted.libraryId,
				startDate: formatted.startDate,
				endDate: formatted.endDate,
				company: formatted.company,
				location: formatted.location,
				role: formatted.role,
				description: formatted.description,
				technologies: formatted.technologies,
				hidden: formatted.hidden
			};
		});

	const skillRows = skillsResult.data ?? [];
	const exampleSkills = skillRows
		.filter((row) => (row as { kind: string }).kind === 'example')
		.map((row) => normalizeString((row as { value: unknown }).value))
		.filter(Boolean);
	const techniques = skillRows
		.filter((row) => (row as { kind: string }).kind === 'technique')
		.map((row) => normalizeString((row as { value: unknown }).value))
		.filter(Boolean);
	const methods = skillRows
		.filter((row) => (row as { kind: string }).kind === 'method')
		.map((row) => normalizeString((row as { value: unknown }).value))
		.filter(Boolean);

	const labeledRows = labeledResult.data ?? [];
	const languages: LabeledItem[] = labeledRows
		.filter((row) => (row as { kind: string }).kind === 'language')
		.map((row) => ({
			label: localizedFromColumns(
				(row as { label_sv: unknown }).label_sv,
				(row as { label_en: unknown }).label_en
			),
			value: localizedFromColumns(
				(row as { value_sv: unknown }).value_sv,
				(row as { value_en: unknown }).value_en
			)
		}));
	const education: LabeledItem[] = labeledRows
		.filter((row) => (row as { kind: string }).kind === 'education')
		.map((row) => ({
			label: localizedFromColumns(
				(row as { label_sv: unknown }).label_sv,
				(row as { label_en: unknown }).label_en
			),
			value: localizedFromColumns(
				(row as { value_sv: unknown }).value_sv,
				(row as { value_en: unknown }).value_en
			)
		}));

	const basics = basicsResult.data;
	const name = normalizeString(basics?.name);
	const title = localizedFromColumns(basics?.title_sv, basics?.title_en);
	const summary = localizedFromColumns(basics?.summary_sv, basics?.summary_en);
	const footer = localizedFromColumns(basics?.footer_note_sv, basics?.footer_note_en);

	return {
		...emptyResumeData(name),
		name,
		title,
		summary,
		contacts: (contactsResult.data ?? []).map((row) => ({
			name: normalizeString((row as { name: unknown }).name),
			phone: normalizeOptionalString((row as { phone: unknown }).phone),
			email: normalizeOptionalString((row as { email: unknown }).email)
		})),
		exampleSkills,
		highlightedExperiences,
		experiences,
		techniques,
		methods,
		languages,
		education,
		portfolio: (portfolioResult.data ?? [])
			.map((row) => normalizeString((row as { url: unknown }).url))
			.filter(Boolean),
		footerNote: footer
	};
};

export const saveResumeData = async (
	adminClient: SupabaseClient,
	resumeId: string,
	talentId: string,
	data: ResumeData
): Promise<void> => {
	await ensureResumeOwnership(adminClient, resumeId, talentId);

	await saveSimpleSections(adminClient, resumeId, data);
	await saveExperienceSection(
		adminClient,
		resumeId,
		talentId,
		'highlighted',
		Array.isArray(data.highlightedExperiences) ? data.highlightedExperiences : []
	);
	await saveExperienceSection(
		adminClient,
		resumeId,
		talentId,
		'experience',
		Array.isArray(data.experiences) ? data.experiences : []
	);

	const { error: updateError } = await adminClient
		.from('resumes')
		.update({ updated_at: new Date().toISOString() })
		.eq('id', resumeId)
		.eq('talent_id', talentId);
	if (updateError) throw new Error(updateError.message);
};

export const initResumeData = async (
	adminClient: SupabaseClient,
	resumeId: string,
	talentId: string,
	personName: string
): Promise<void> => {
	await saveResumeData(adminClient, resumeId, talentId, emptyResumeData(personName));
};

export const cloneResumeData = async (
	adminClient: SupabaseClient,
	sourceResumeId: string,
	targetResumeId: string,
	talentId: string
): Promise<void> => {
	await ensureResumeOwnership(adminClient, sourceResumeId, talentId);
	await ensureResumeOwnership(adminClient, targetResumeId, talentId);
	const sourceData = await loadResumeData(adminClient, sourceResumeId);
	await saveResumeData(adminClient, targetResumeId, talentId, sourceData);
};

export const listExperienceLibrary = async (
	adminClient: SupabaseClient,
	talentId: string,
	query?: string | null
): Promise<ExperienceLibraryItem[]> => {
	const normalizedQuery = normalizeString(query);
	let builder = adminClient
		.from('experience_library')
		.select(
			'id, talent_id, start_date, end_date, company, location_sv, location_en, role_sv, role_en, description_sv, description_en, updated_at, created_at'
		)
		.eq('talent_id', talentId)
		.order('updated_at', { ascending: false })
		.order('id', { ascending: false });

	if (normalizedQuery) {
		const pattern = `%${normalizedQuery}%`;
		builder = builder.or(
			[
				`company.ilike.${pattern}`,
				`role_sv.ilike.${pattern}`,
				`role_en.ilike.${pattern}`,
				`description_sv.ilike.${pattern}`,
				`description_en.ilike.${pattern}`
			].join(',')
		);
	}

	const { data: libraryRows, error: libraryError } = await builder;
	if (libraryError) throw new Error(libraryError.message);

	const rows = (libraryRows ?? []) as ExperienceLibraryRow[];
	if (rows.length === 0) return [];

	const ids = rows.map((row) => row.id);
	const { data: techRows, error: techError } = await adminClient
		.from('experience_library_technologies')
		.select('experience_id, value, position')
		.in('experience_id', ids)
		.order('position', { ascending: true });
	if (techError) throw new Error(techError.message);

	const techByExperienceId = new Map<string, string[]>();
	for (const row of techRows ?? []) {
		const experienceId = normalizeId((row as { experience_id: unknown }).experience_id);
		const value = normalizeString((row as { value: unknown }).value);
		if (!experienceId || !value) continue;
		const existing = techByExperienceId.get(experienceId) ?? [];
		existing.push(value);
		techByExperienceId.set(experienceId, existing);
	}

	return rows.map((row) => ({
		id: String(row.id),
		startDate: normalizeString(row.start_date),
		endDate: row.end_date === null ? null : (normalizeOptionalString(row.end_date) ?? ''),
		company: normalizeString(row.company),
		location: localizedFromColumns(row.location_sv, row.location_en),
		role: localizedFromColumns(row.role_sv, row.role_en),
		description: localizedFromColumns(row.description_sv, row.description_en),
		technologies: techByExperienceId.get(row.id) ?? []
	}));
};
