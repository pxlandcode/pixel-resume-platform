<script lang="ts">
	import type {
		ResumeData,
		HighlightedExperience,
		ExperienceItem,
		LabeledItem,
		LocalizedText,
		ExperienceLibraryItem
	} from '$lib/types/resume';
	import { cloneResumeDataValue, cloneTechCategoriesValue } from '$lib/resumes/clone';
	import { soloImages } from '$lib/images/manifest';
	import worldclassUrl from '$lib/assets/worldclass.svg?url';

	// Import all resume components
	import {
		ResumeBrand,
		ResumeLanguageToggle,
		ResumeProfileImage,
		ResumeExampleSkills,
		ResumeContacts,
		ResumeNameTitle,
		ResumeSummary,
		ResumeHighlightedExperiences,
		ResumePreviousExperiences,
		ResumeSkills,
		ResumeOther,
		ResumeFooter,
		type Language
	} from './components';
	import type { Person, TechCategory } from '$lib/types/resume';
	import type { ResumeAiGenerateParams, ResumeAiGenerateResult } from './components/utils';
	import andLogo from '$lib/assets/and.svg?url';

	type ImageResource = (typeof soloImages)[keyof typeof soloImages];
	type ResumeItemIdKind = 'experience' | 'highlighted';

	let {
		data,
		image,
		language = $bindable('sv'),
		isEditing = false,
		showLanguageToggle = true,
		showMobileProfileHeading = false,
		person,
		profileTechStack,
		techCatalogOrganisationId = null,
		templateMainLogotypeUrl = null,
		templateAccentLogoUrl = null,
		templateEndLogoUrl = null,
		templateHomepageUrl = null,
		templateMainFontCssStack = "'Inter', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
		templateIsPixelCode = false,
		editingDataSeed = null,
		editingDataSeedKey = 0,
		experienceLibrary = [],
		onGenerateDescription,
		registerEditingDataGetter
	}: {
		data: ResumeData;
		image?: ImageResource | string | null;
		language?: Language;
		isEditing?: boolean;
		showLanguageToggle?: boolean;
		showMobileProfileHeading?: boolean;
		person?: Person;
		profileTechStack?: TechCategory[];
		techCatalogOrganisationId?: string | null;
		templateMainLogotypeUrl?: string | null;
		templateAccentLogoUrl?: string | null;
		templateEndLogoUrl?: string | null;
		templateHomepageUrl?: string | null;
		templateMainFontCssStack?: string;
		templateIsPixelCode?: boolean;
		editingDataSeed?: ResumeData | null;
		editingDataSeedKey?: number;
		experienceLibrary?: ExperienceLibraryItem[];
		onGenerateDescription?: (params: ResumeAiGenerateParams) => Promise<ResumeAiGenerateResult>;
		registerEditingDataGetter?: ((getter: () => ResumeData) => void) | null;
	} = $props();

	// eslint-disable-next-line svelte/prefer-writable-derived
	let profileCategories = $state(cloneTechCategoriesValue(profileTechStack ?? person?.techStack));
	const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
	const serializeLocalizedText = (value: LocalizedText | null | undefined): string => {
		if (!value) return '';
		if (typeof value === 'string') return normalize(value);
		return `${normalize(value.sv)}|${normalize(value.en)}`;
	};
	const hashString = (value: string): string => {
		let hash = 2166136261;
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0).toString(36);
	};
	const buildExperienceId = (item: ExperienceItem, index: number): string =>
		`experience-${hashString(
			JSON.stringify({
				index,
				libraryId: item.libraryId ?? '',
				startDate: normalize(item.startDate),
				endDate: normalize(item.endDate ?? ''),
				company: normalize(item.company),
				location: serializeLocalizedText(item.location ?? null),
				role: serializeLocalizedText(item.role),
				description: serializeLocalizedText(item.description),
				technologies: (item.technologies ?? []).map((tech) => normalize(tech)),
				hidden: item.hidden === true
			})
		)}`;
	const buildHighlightedExperienceId = (
		item: HighlightedExperience,
		index: number
	): string =>
		`highlighted-${hashString(
			JSON.stringify({
				index,
				libraryId: item.libraryId ?? '',
				company: normalize(item.company),
				role: serializeLocalizedText(item.role),
				description: serializeLocalizedText(item.description),
				technologies: (item.technologies ?? []).map((tech) => normalize(tech)),
				hidden: item.hidden === true
			})
		)}`;
	const ensureExperienceIds = (items: ExperienceItem[]): ExperienceItem[] =>
		items.map((item, index) => ({
			...item,
			_id: item._id ?? buildExperienceId(item, index)
		}));
	const ensureHighlightedExperienceIds = (
		items: HighlightedExperience[]
	): HighlightedExperience[] =>
		items.map((item, index) => ({
			...item,
			_id: item._id ?? buildHighlightedExperienceId(item, index)
		}));
	const cloneResumeData = (source: ResumeData): ResumeData => {
		const cloned = cloneResumeDataValue(source);
		cloned.experiences = ensureExperienceIds(cloned.experiences);
		cloned.highlightedExperiences = ensureHighlightedExperienceIds(cloned.highlightedExperiences);
		return cloned;
	};
	let draftIdSequence = $state(0);
	const nextDraftId = (kind: ResumeItemIdKind): string => {
		draftIdSequence += 1;
		return `${kind}-draft-${draftIdSequence}`;
	};
	const displayName = $derived(person?.name ?? data.name ?? '');

	const resolvedImage: ImageResource | string | null = $derived.by(() => {
		return image ?? person?.avatar_url ?? null;
	});
	const resolvedAccentLogo = $derived(templateAccentLogoUrl ?? andLogo);
	const resolvedEndLogo = $derived(templateEndLogoUrl ?? worldclassUrl);
	const resolvedHomepage = $derived.by(() => {
		const homepage = templateHomepageUrl?.trim() ?? '';
		if (!homepage) return 'www.pixelcode.se';
		try {
			const parsed = new URL(homepage);
			const path = parsed.pathname === '/' ? '' : parsed.pathname;
			return `${parsed.host}${path}`;
		} catch {
			return homepage;
		}
	});
	const resumeRootStyle = $derived(
		`--resume-main-font: ${templateMainFontCssStack}; font-family: var(--resume-main-font);`
	);

	$effect(() => {
		profileCategories = cloneTechCategoriesValue(profileTechStack ?? person?.techStack);
	});

	// Local editing state
	let editingData = $state<ResumeData>(cloneResumeData(data));
	let appliedEditingSeedKey: number | null = null;

	// Sync prop changes to local state with stable internal IDs
	$effect(() => {
		if (!isEditing) {
			editingData = cloneResumeData(data);
			appliedEditingSeedKey = null;
		}
	});

	$effect(() => {
		if (!isEditing || !editingDataSeed || editingDataSeedKey === appliedEditingSeedKey) return;
		editingData = cloneResumeData(editingDataSeed);
		appliedEditingSeedKey = editingDataSeedKey;
	});

	const buildEmittedEditingData = (): ResumeData => {
		const snapshot = $state.snapshot(editingData);
		return {
			...snapshot,
			name: displayName,
			techniques: profileCategories.flatMap((cat) => cat.skills ?? []),
			methods: []
		};
	};

	const getEditingDataSnapshot = (): ResumeData => {
		const snapshot = buildEmittedEditingData();
		return snapshot;
	};

	$effect(() => {
		if (!registerEditingDataGetter) return;
		registerEditingDataGetter(getEditingDataSnapshot);
	});

	const componentLanguage = $derived<Language>(isEditing ? 'en' : language);

	const stripHtml = (value: string) => value.replace(/<[^>]*>/g, ' ');
	const clip = (value: string, maxLength = 280) => {
		const cleaned = normalize(value);
		if (!cleaned) return '';
		if (cleaned.length <= maxLength) return cleaned;
		return `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
	};
	const getLocalized = (
		value: LocalizedText | null | undefined,
		targetLanguage: Language
	): string => {
		if (!value) return '';
		if (typeof value === 'string') return value;
		return value[targetLanguage] ?? value.sv ?? value.en ?? '';
	};

	const parseDateToTimestamp = (value: string | null | undefined): number | null => {
		const normalizedValue = normalize(value ?? '');
		if (!normalizedValue) return null;
		const parsed = Date.parse(normalizedValue);
		return Number.isNaN(parsed) ? null : parsed;
	};

	const ONGOING_END_DATE_SORT_VALUE = Number.MAX_SAFE_INTEGER;

	const getEndDateTimestamp = (value: string | null | undefined): number => {
		const normalizedValue = normalize(value ?? '');
		if (!normalizedValue) return ONGOING_END_DATE_SORT_VALUE;
		const lowered = normalizedValue.toLowerCase();
		if (['present', 'current', 'ongoing', 'nuvarande', 'pågående'].includes(lowered)) {
			return ONGOING_END_DATE_SORT_VALUE;
		}
		return parseDateToTimestamp(normalizedValue) ?? 0;
	};

	const buildSummaryContext = (targetLanguage: Language): string => {
		const lines: string[] = [];
		lines.push(`Consultant name: ${displayName || 'Unknown'}`);
		lines.push(`Title: ${clip(getLocalized(editingData.title, targetLanguage), 140) || 'Unknown'}`);
		lines.push(
			'Summary guidance: prioritize experience evidence first (highlighted + previous), then use skills as supporting context.'
		);

		const highlightedLines = editingData.highlightedExperiences
			.filter((exp) => !exp.hidden)
			.slice(0, 8)
			.map((exp, index) => {
				const company = clip(exp.company ?? '', 80) || 'Unknown company';
				const role = clip(getLocalized(exp.role, targetLanguage), 120);
				const description = clip(stripHtml(getLocalized(exp.description, targetLanguage)), 260);
				const technologies = (exp.technologies ?? [])
					.map((tech) => normalize(tech))
					.filter(Boolean);
				const parts = [
					`H${index + 1}: ${company}`,
					role ? `Role: ${role}` : '',
					technologies.length > 0 ? `Tech: ${technologies.join(', ')}` : '',
					description ? `Description: ${description}` : ''
				].filter(Boolean);
				return parts.join(' | ');
			});
		if (highlightedLines.length > 0) {
			lines.push('Highlighted experience:');
			lines.push(...highlightedLines);
		}

		const experienceLines = editingData.experiences
			.filter((exp) => !exp.hidden)
			.map((exp) => {
				const endTs = getEndDateTimestamp(exp.endDate ?? '');
				const startTs = parseDateToTimestamp(exp.startDate) ?? 0;
				return { exp, recency: endTs * 10 + startTs };
			})
			.sort((a, b) => b.recency - a.recency)
			.slice(0, 16)
			.map((exp, index) => {
				const company = clip(exp.exp.company ?? '', 80) || 'Unknown company';
				const role = clip(getLocalized(exp.exp.role, targetLanguage), 120);
				const location = clip(getLocalized(exp.exp.location, targetLanguage), 80);
				const description = clip(stripHtml(getLocalized(exp.exp.description, targetLanguage)), 260);
				const startDate = normalize(exp.exp.startDate ?? '');
				const endDate = normalize(exp.exp.endDate ?? '') || 'Present';
				const technologies = (exp.exp.technologies ?? [])
					.map((tech) => normalize(tech))
					.filter(Boolean);
				const parts = [
					`E${index + 1}: ${company}`,
					role ? `Role: ${role}` : '',
					location ? `Location: ${location}` : '',
					startDate ? `Dates: ${startDate} - ${endDate}` : '',
					technologies.length > 0 ? `Tech: ${technologies.join(', ')}` : '',
					description ? `Description: ${description}` : ''
				].filter(Boolean);
				return parts.join(' | ');
			});
		if (experienceLines.length > 0) {
			lines.push('Previous experience (most recent first):');
			lines.push(...experienceLines);
		}

		const recentCutoff = Date.now() - 5 * 365 * 24 * 60 * 60 * 1000;
		const recentRoleCounts: Record<string, { count: number; label: string }> = {};
		for (const exp of editingData.experiences.filter((entry) => !entry.hidden)) {
			const endTs = getEndDateTimestamp(exp.endDate ?? '');
			if (endTs < recentCutoff) continue;
			const role = clip(getLocalized(exp.role, targetLanguage), 120);
			if (!role) continue;
			const key = role.toLowerCase();
			const current = recentRoleCounts[key];
			if (!current) {
				recentRoleCounts[key] = { count: 1, label: role };
			} else {
				recentRoleCounts[key] = { ...current, count: current.count + 1 };
			}
		}
		const recentRoleFocus = Object.values(recentRoleCounts)
			.sort((a, b) => b.count - a.count)
			.slice(0, 3)
			.map((entry) => entry.label);
		if (recentRoleFocus.length > 0) {
			lines.push(`Recent role focus (last 5 years): ${recentRoleFocus.join(', ')}`);
			lines.push(
				'Interpret these as current primary profile, and frame older roles as supporting background.'
			);
		}

		const exampleSkills = (editingData.exampleSkills ?? [])
			.map((skill) => normalize(skill))
			.filter(Boolean);
		if (exampleSkills.length > 0) {
			lines.push(`Example skills (supporting): ${exampleSkills.join(', ')}`);
		}

		const profileCategoryLines = (profileCategories ?? [])
			.map((category) => {
				const categoryName = clip(category.name ?? '', 80);
				const skills = (category.skills ?? []).map((skill) => normalize(skill)).filter(Boolean);
				if (!categoryName || skills.length === 0) return '';
				return `${categoryName}: ${skills.join(', ')}`;
			})
			.filter(Boolean)
			.slice(0, 12);
		if (profileCategoryLines.length > 0) {
			lines.push('Skills profile (supporting):');
			lines.push(...profileCategoryLines);
		}

		const languageLines = editingData.languages
			.map((entry) => {
				const name = clip(getLocalized(entry.label, targetLanguage), 60);
				const level = clip(getLocalized(entry.value, targetLanguage), 60);
				return [name, level].filter(Boolean).join(': ');
			})
			.filter(Boolean)
			.slice(0, 10);
		if (languageLines.length > 0) {
			lines.push(`Languages: ${languageLines.join(', ')}`);
		}

		const educationLines = editingData.education
			.map((entry) => {
				const school = clip(
					typeof entry.label === 'string'
						? entry.label
						: getLocalized(entry.label as LocalizedText, targetLanguage),
					80
				);
				const program = clip(getLocalized(entry.value, targetLanguage), 120);
				return [school, program].filter(Boolean).join(': ');
			})
			.filter(Boolean)
			.slice(0, 10);
		if (educationLines.length > 0) {
			lines.push(`Education: ${educationLines.join(' | ')}`);
		}

		return lines.join('\n');
	};

	const buildExampleSkillsContext = (targetLanguage: Language): string => {
		const lines: string[] = [];
		lines.push(`Consultant name: ${displayName || 'Unknown'}`);
		lines.push(`Title: ${clip(getLocalized(editingData.title, targetLanguage), 140) || 'Unknown'}`);
		lines.push('Task: Build a concise, relevant "Examples of skills" list for the resume sidebar.');
		lines.push(
			'Prioritize technologies/methods evidenced in highlighted experiences and recent previous experiences. Use the lower skills profile/tech stack section as supporting evidence and to fill gaps.'
		);

		type SkillSignalSource = 'highlighted' | 'experience' | 'profile' | 'current';
		type SkillSignal = {
			label: string;
			score: number;
			highlighted: number;
			experience: number;
			profile: number;
			current: number;
		};
		const signalByKey: Record<string, SkillSignal> = {};
		const addSignal = (raw: string, source: SkillSignalSource, weight: number) => {
			const cleaned = clip(raw, 80);
			const normalizedSkill = normalize(cleaned);
			if (!normalizedSkill) return;
			const key = normalizedSkill.toLowerCase();
			const current = signalByKey[key] ?? {
				label: normalizedSkill,
				score: 0,
				highlighted: 0,
				experience: 0,
				profile: 0,
				current: 0
			};
			const next: SkillSignal = {
				...current,
				score: current.score + weight,
				[source]: current[source] + 1
			};
			signalByKey[key] = next;
		};

		const highlightedVisible = editingData.highlightedExperiences.filter((exp) => !exp.hidden);
		const highlightedLines = highlightedVisible.slice(0, 10).map((exp, index) => {
			const company = clip(exp.company ?? '', 80) || 'Unknown company';
			const role = clip(getLocalized(exp.role, targetLanguage), 120);
			const technologies = (exp.technologies ?? []).map((tech) => normalize(tech)).filter(Boolean);
			for (const tech of technologies) addSignal(tech, 'highlighted', 8);
			const parts = [
				`H${index + 1}: ${company}`,
				role ? `Role: ${role}` : '',
				technologies.length > 0 ? `Tech: ${technologies.join(', ')}` : ''
			].filter(Boolean);
			return parts.join(' | ');
		});
		if (highlightedLines.length > 0) {
			lines.push('Highlighted experience technology evidence:');
			lines.push(...highlightedLines);
		}

		const recentExperiences = editingData.experiences
			.filter((exp) => !exp.hidden)
			.map((exp) => {
				const endTs = getEndDateTimestamp(exp.endDate ?? '');
				const startTs = parseDateToTimestamp(exp.startDate) ?? 0;
				return { exp, recency: endTs * 10 + startTs };
			})
			.sort((a, b) => b.recency - a.recency);

		const experienceLines = recentExperiences.slice(0, 18).map((entry, index) => {
			const exp = entry.exp;
			const company = clip(exp.company ?? '', 80) || 'Unknown company';
			const role = clip(getLocalized(exp.role, targetLanguage), 120);
			const startDate = normalize(exp.startDate ?? '');
			const endDate = normalize(exp.endDate ?? '') || 'Present';
			const technologies = (exp.technologies ?? []).map((tech) => normalize(tech)).filter(Boolean);
			const weight = index < 6 ? 6 : index < 12 ? 4 : 2;
			for (const tech of technologies) addSignal(tech, 'experience', weight);
			const parts = [
				`E${index + 1}: ${company}`,
				role ? `Role: ${role}` : '',
				startDate ? `Dates: ${startDate} - ${endDate}` : '',
				technologies.length > 0 ? `Tech: ${technologies.join(', ')}` : ''
			].filter(Boolean);
			return parts.join(' | ');
		});
		if (experienceLines.length > 0) {
			lines.push('Previous experience technology evidence (most recent first):');
			lines.push(...experienceLines);
		}

		const profileCategoryLines = (profileCategories ?? [])
			.map((category) => {
				const categoryName = clip(category.name ?? '', 80);
				const categorySkills = (category.skills ?? [])
					.map((skill) => normalize(skill))
					.filter(Boolean);
				if (!categoryName || categorySkills.length === 0) return '';
				for (const skill of categorySkills) addSignal(skill, 'profile', 3);
				return `${categoryName}: ${categorySkills.join(', ')}`;
			})
			.filter(Boolean)
			.slice(0, 14);
		if (profileCategoryLines.length > 0) {
			lines.push('Skills profile / lower resume tech stack (supporting):');
			lines.push(...profileCategoryLines);
		}

		const techniques = profileCategories
			.flatMap((category) => category.skills ?? [])
			.map((skill) => normalize(skill))
			.filter(Boolean);
		if (techniques.length > 0) {
			for (const tech of techniques.slice(0, 120)) addSignal(tech, 'profile', 2);
			lines.push(`Flattened techniques list: ${techniques.slice(0, 80).join(', ')}`);
		}

		const methods: string[] = [];
		if (methods.length > 0) {
			for (const method of methods.slice(0, 80)) addSignal(method, 'profile', 2);
			lines.push(`Methods list: ${methods.slice(0, 60).join(', ')}`);
		}

		const currentExampleSkills = (editingData.exampleSkills ?? [])
			.map((skill) => normalize(skill))
			.filter(Boolean);
		if (currentExampleSkills.length > 0) {
			for (const skill of currentExampleSkills) addSignal(skill, 'current', 1);
			lines.push(
				`Current example skills (editable target list): ${currentExampleSkills.join(', ')}`
			);
		}

		const rankedSignals = Object.values(signalByKey)
			.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score;
				if (b.highlighted !== a.highlighted) return b.highlighted - a.highlighted;
				if (b.experience !== a.experience) return b.experience - a.experience;
				return a.label.localeCompare(b.label);
			})
			.slice(0, 48)
			.map((entry, index) => {
				const evidenceParts = [];
				if (entry.highlighted > 0) evidenceParts.push(`H:${entry.highlighted}`);
				if (entry.experience > 0) evidenceParts.push(`E:${entry.experience}`);
				if (entry.profile > 0) evidenceParts.push(`P:${entry.profile}`);
				if (entry.current > 0) evidenceParts.push(`C:${entry.current}`);
				return `${index + 1}. ${entry.label} (score ${entry.score}; ${evidenceParts.join(', ')})`;
			});
		if (rankedSignals.length > 0) {
			lines.push('Ranked skill signals from resume evidence:');
			lines.push(...rankedSignals);
		}

		lines.push(
			'Selection rules: prefer concrete technical skills/tools/platforms; avoid soft skills unless user prompt explicitly asks for them; keep names short; optimize for relevance to the user prompt/context first, then resume evidence strength.'
		);

		return lines.join('\n');
	};

	const summaryContextByLanguage = $derived({
		sv: buildSummaryContext('sv'),
		en: buildSummaryContext('en')
	});

	const exampleSkillsContextByLanguage = $derived({
		sv: buildExampleSkillsContext('sv'),
		en: buildExampleSkillsContext('en')
	});

	// Toggle language
	const toggleLanguage = () => {
		language = language === 'sv' ? 'en' : 'sv';
	};

	// Experience management
	const addExperience = () => {
		const newExp: ExperienceItem = {
			_id: nextDraftId('experience'),
			saveToLibrary: false,
			startDate: '',
			endDate: '',
			company: '',
			location: { sv: '', en: '' },
			role: { sv: '', en: '' },
			description: { sv: '', en: '' },
			technologies: []
		};
		editingData.experiences = [newExp, ...editingData.experiences];
	};

	const addExperienceFromLibrary = (libraryId: string) => {
		const selected = experienceLibrary.find((entry) => entry.id === libraryId);
		if (!selected) return;
		const newExp: ExperienceItem = {
			_id: nextDraftId('experience'),
			libraryId: selected.id,
			saveToLibrary: true,
			startDate: selected.startDate ?? '',
			endDate: selected.endDate ?? '',
			company: selected.company ?? '',
			location: selected.location ?? { sv: '', en: '' },
			role: selected.role ?? { sv: '', en: '' },
			description: selected.description ?? { sv: '', en: '' },
			technologies: Array.isArray(selected.technologies) ? [...selected.technologies] : []
		};
		editingData.experiences = [newExp, ...editingData.experiences];
	};

	const removeExperience = (index: number) => {
		editingData.experiences = editingData.experiences.filter((_, i) => i !== index);
	};

	const moveExperience = (index: number, direction: 'up' | 'down') => {
		const newIndex = direction === 'up' ? index - 1 : index + 1;
		if (newIndex < 0 || newIndex >= editingData.experiences.length) return;
		const items = [...editingData.experiences];
		[items[index], items[newIndex]] = [items[newIndex], items[index]];
		editingData.experiences = items;
	};

	const reorderExperience = (fromIndex: number, toIndex: number) => {
		const items = [...editingData.experiences];
		const [removed] = items.splice(fromIndex, 1);
		items.splice(toIndex, 0, removed);
		editingData.experiences = items;
	};

	// Highlighted experience management
	const addHighlightedExperience = () => {
		const newExp: HighlightedExperience = {
			_id: nextDraftId('highlighted'),
			saveToLibrary: false,
			company: '',
			role: { sv: '', en: '' },
			description: { sv: '', en: '' },
			technologies: []
		};
		editingData.highlightedExperiences = [...editingData.highlightedExperiences, newExp];
	};

	const addHighlightedExperienceFromLibrary = (libraryId: string) => {
		const selected = experienceLibrary.find((entry) => entry.id === libraryId);
		if (!selected) return;
		const newExp: HighlightedExperience = {
			_id: nextDraftId('highlighted'),
			libraryId: selected.id,
			saveToLibrary: true,
			company: selected.company ?? '',
			role: selected.role ?? { sv: '', en: '' },
			description: selected.description ?? { sv: '', en: '' },
			technologies: Array.isArray(selected.technologies) ? [...selected.technologies] : []
		};
		editingData.highlightedExperiences = [...editingData.highlightedExperiences, newExp];
	};

	const removeHighlightedExperience = (index: number) => {
		editingData.highlightedExperiences = editingData.highlightedExperiences.filter(
			(_, i) => i !== index
		);
	};

	const moveHighlightedExperience = (index: number, direction: 'up' | 'down') => {
		const newIndex = direction === 'up' ? index - 1 : index + 1;
		if (newIndex < 0 || newIndex >= editingData.highlightedExperiences.length) return;
		const items = [...editingData.highlightedExperiences];
		[items[index], items[newIndex]] = [items[newIndex], items[index]];
		editingData.highlightedExperiences = items;
	};

	const reorderHighlightedExperience = (fromIndex: number, toIndex: number) => {
		const items = [...editingData.highlightedExperiences];
		const [removed] = items.splice(fromIndex, 1);
		items.splice(toIndex, 0, removed);
		editingData.highlightedExperiences = items;
	};

	// Language management
	const addLanguage = () => {
		const newLang: LabeledItem = {
			label: { sv: '', en: '' },
			value: { sv: '', en: '' }
		};
		editingData.languages = [...editingData.languages, newLang];
	};

	const removeLanguage = (index: number) => {
		editingData.languages = editingData.languages.filter((_, i) => i !== index);
	};

	// Education management
	const addEducation = () => {
		const newEdu: LabeledItem = {
			label: '',
			value: { sv: '', en: '' }
		};
		editingData.education = [...editingData.education, newEdu];
	};

	const removeEducation = (index: number) => {
		editingData.education = editingData.education.filter((_, i) => i !== index);
	};

	// Portfolio management
	const addPortfolioUrl = () => {
		editingData.portfolio = [...(editingData.portfolio ?? []), ''];
	};

	const removePortfolioUrl = (index: number) => {
		editingData.portfolio = (editingData.portfolio ?? []).filter((_, i) => i !== index);
	};

	// Contact management
	const addContact = () => {
		editingData.contacts = [...editingData.contacts, { name: '', phone: '', email: '' }];
	};

	const removeContact = (index: number) => {
		editingData.contacts = editingData.contacts.filter((_, i) => i !== index);
	};
</script>

<div
	class="resume-print-page bg-card text-foreground relative p-10 shadow-sm"
	style={resumeRootStyle}
>
	<!-- Language Toggle -->
	{#if !isEditing && showLanguageToggle}
		<ResumeLanguageToggle {language} onToggle={toggleLanguage} />
	{/if}

	<!-- Header Section -->
	<div class="header-top">
		<!-- Brand -->
		<ResumeBrand
			logoUrl={templateMainLogotypeUrl}
			logoAlt={person?.name ? `${person.name} organisation logo` : 'Organisation logo'}
			showProudlyPresents={templateIsPixelCode}
		/>

		{#if isEditing}
			<!-- Edit Mode: Single column layout for easier editing -->
			<div class="space-y-6">
				<!-- Profile Image + Name/Title row -->
				<div class="flex items-start gap-6">
					<div class="h-[216px] w-[216px] flex-shrink-0">
						<ResumeProfileImage image={resolvedImage} name={displayName} />
					</div>
					<div class="flex-1">
						<!-- Name fixed from profile; allow title editing -->
						<h1 class="text-foreground mb-2 text-4xl font-bold">{displayName}</h1>
						<ResumeNameTitle
							bind:title={editingData.title}
							{isEditing}
							language={componentLanguage}
						/>
					</div>
				</div>

				<!-- Example Skills + Contacts stacked -->
				<div class="space-y-4">
					<ResumeExampleSkills
						bind:skills={editingData.exampleSkills}
						{isEditing}
						language={componentLanguage}
						resumeContextSv={exampleSkillsContextByLanguage.sv}
						resumeContextEn={exampleSkillsContextByLanguage.en}
						{onGenerateDescription}
					/>
					<ResumeContacts
						bind:contacts={editingData.contacts}
						{isEditing}
						language={componentLanguage}
						onAdd={addContact}
						onRemove={removeContact}
					/>
				</div>

				<!-- Summary -->
				<ResumeSummary
					bind:summary={editingData.summary}
					{isEditing}
					language={componentLanguage}
					resumeContextSv={summaryContextByLanguage.sv}
					resumeContextEn={summaryContextByLanguage.en}
					{onGenerateDescription}
				/>

				<!-- Highlighted Experience -->
				<ResumeHighlightedExperiences
					bind:experiences={editingData.highlightedExperiences}
					{isEditing}
					language={componentLanguage}
					{onGenerateDescription}
					libraryExperiences={experienceLibrary}
					onAdd={addHighlightedExperience}
					onAddFromLibrary={addHighlightedExperienceFromLibrary}
					onRemove={removeHighlightedExperience}
					onMove={moveHighlightedExperience}
					onReorder={reorderHighlightedExperience}
				/>
			</div>
		{:else}
			<!-- View Mode: Two Column Layout -->
			<div class="header-grid grid flex-1 grid-cols-1 gap-8 md:grid-cols-[45mm_1fr]">
				<!-- Left Column: Image + Skills + Contact -->
				<div class="consultant-profile">
					<!-- Profile Image -->
					<ResumeProfileImage image={resolvedImage ?? image} name={displayName} />

					{#if showMobileProfileHeading}
						<div class="md:hidden">
							<ResumeNameTitle
								name={displayName}
								bind:title={editingData.title}
								{isEditing}
								language={componentLanguage}
							/>
						</div>
					{/if}

					<!-- Example Skills -->
					<ResumeExampleSkills
						bind:skills={editingData.exampleSkills}
						{isEditing}
						language={componentLanguage}
						organisationId={techCatalogOrganisationId}
					/>

					<!-- Contacts -->
					<ResumeContacts
						bind:contacts={editingData.contacts}
						{isEditing}
						language={componentLanguage}
						onAdd={addContact}
						onRemove={removeContact}
					/>
				</div>

				<!-- Right Column: Name + Summary + Highlighted Experience -->
				<div class="space-y-6">
					<!-- Name and Title -->
					<div class:hidden={showMobileProfileHeading} class:md:block={showMobileProfileHeading}>
						<ResumeNameTitle
							name={displayName}
							bind:title={editingData.title}
							{isEditing}
							language={componentLanguage}
						/>
					</div>

					<!-- Summary -->
					<ResumeSummary
						bind:summary={editingData.summary}
						{isEditing}
						language={componentLanguage}
						resumeContextSv={summaryContextByLanguage.sv}
						resumeContextEn={summaryContextByLanguage.en}
						{onGenerateDescription}
					/>

					<!-- Highlighted Experience -->
					<ResumeHighlightedExperiences
						bind:experiences={editingData.highlightedExperiences}
						{isEditing}
						language={componentLanguage}
						organisationId={techCatalogOrganisationId}
						{onGenerateDescription}
						libraryExperiences={experienceLibrary}
						onAdd={addHighlightedExperience}
						onAddFromLibrary={addHighlightedExperienceFromLibrary}
						onRemove={removeHighlightedExperience}
						onMove={moveHighlightedExperience}
						onReorder={reorderHighlightedExperience}
					/>
				</div>
			</div>
		{/if}
	</div>

	<!-- Previous Experience Section -->
	<ResumePreviousExperiences
		bind:experiences={editingData.experiences}
		{isEditing}
		language={componentLanguage}
		organisationId={techCatalogOrganisationId}
		{onGenerateDescription}
		libraryExperiences={experienceLibrary}
		onAdd={addExperience}
		onAddFromLibrary={addExperienceFromLibrary}
		onRemove={removeExperience}
		onMove={moveExperience}
		onReorder={reorderExperience}
	/>

	<!-- Skills Section -->
	<ResumeSkills
		bind:techniques={editingData.techniques}
		bind:methods={editingData.methods}
		bind:profileTechStack={profileCategories}
		{isEditing}
		language={componentLanguage}
		organisationId={techCatalogOrganisationId}
	/>

	<!-- Other Section -->
	<ResumeOther
		bind:languages={editingData.languages}
		bind:education={editingData.education}
		portfolio={editingData.portfolio ?? []}
		{isEditing}
		language={componentLanguage}
		onAddLanguage={addLanguage}
		onRemoveLanguage={removeLanguage}
		onAddEducation={addEducation}
		onRemoveEducation={removeEducation}
		onAddPortfolioUrl={addPortfolioUrl}
		onRemovePortfolioUrl={removePortfolioUrl}
	/>

	<!-- Footer -->
	<ResumeFooter bind:footerNote={editingData.footerNote} {isEditing} language={componentLanguage} />

	<!-- Worldclass Image -->
	<div class="border-border mt-8 flex justify-center border-t pt-6">
		<img
			src={resolvedEndLogo}
			alt="Brand end logo"
			class="max-h-[200px] w-auto object-contain"
			loading="lazy"
		/>
	</div>

	<div class="border-border/70 mt-4 flex justify-start border-t pt-4">
		<div class="inline-flex items-end gap-3">
			<img
				src={resolvedAccentLogo}
				class="h-16 w-auto object-contain opacity-85"
				alt="Brand accent logo"
				loading="lazy"
			/>
			<p class="text-foreground pb-1 text-xs">{resolvedHomepage}</p>
		</div>
	</div>
</div>

<style>
	.consultant-profile {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
</style>
