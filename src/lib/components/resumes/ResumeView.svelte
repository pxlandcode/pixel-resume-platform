<script lang="ts">
	import type {
		ResumeData,
		HighlightedExperience,
		ExperienceItem,
		LabeledItem,
		LocalizedText,
		ExperienceLibraryItem
	} from '$lib/types/resume';
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

	type ImageResource = (typeof soloImages)[keyof typeof soloImages];

	let {
		data,
		image,
		language = $bindable('sv'),
		isEditing = false,
		person,
		profileTechStack,
		experienceLibrary = [],
		onGenerateDescription
	}: {
		data: ResumeData;
		image?: ImageResource | string | null;
		language?: Language;
		isEditing?: boolean;
		person?: Person;
		profileTechStack?: TechCategory[];
		experienceLibrary?: ExperienceLibraryItem[];
		onGenerateDescription?: (params: ResumeAiGenerateParams) => Promise<ResumeAiGenerateResult>;
	} = $props();

	// eslint-disable-next-line svelte/prefer-writable-derived
	let profileCategories = $state(structuredClone(profileTechStack ?? person?.techStack ?? []));
	const displayName = $derived(person?.name ?? data.name ?? '');

	const resolvedImage: ImageResource | string | null = $derived.by(() => {
		return image ?? person?.avatar_url ?? null;
	});

	$effect(() => {
		profileCategories = structuredClone(profileTechStack ?? person?.techStack ?? []);
	});

	// Helper to ensure all items have unique IDs
	const ensureIds = <T extends { _id?: string }>(items: T[]): T[] => {
		return items.map((item) => ({
			...item,
			_id: item._id ?? crypto.randomUUID()
		}));
	};

	// Local editing state
	let editingData = $state<ResumeData>(structuredClone(data));

	// Sync prop changes to local state and ensure IDs
	$effect(() => {
		if (!isEditing) {
			const cloned = structuredClone(data);
			cloned.experiences = ensureIds(cloned.experiences);
			cloned.highlightedExperiences = ensureIds(cloned.highlightedExperiences);
			editingData = cloned;
		}
	});

	$effect(() => {
		editingData.name = displayName;
		editingData.techniques = profileCategories.flatMap((cat) => cat.skills ?? []);
		editingData.methods = [];
	});

	const componentLanguage = $derived<Language>(isEditing ? 'en' : language);

	const stripHtml = (value: string) => value.replace(/<[^>]*>/g, ' ');
	const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
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

	const getEndDateTimestamp = (value: string | null | undefined): number => {
		const normalizedValue = normalize(value ?? '');
		if (!normalizedValue) return Date.now();
		const lowered = normalizedValue.toLowerCase();
		if (['present', 'current', 'ongoing', 'nuvarande', 'pågående'].includes(lowered)) {
			return Date.now();
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

		const techniques = (editingData.techniques ?? [])
			.map((skill) => normalize(skill))
			.filter(Boolean);
		if (techniques.length > 0) {
			for (const tech of techniques.slice(0, 120)) addSignal(tech, 'profile', 2);
			lines.push(`Flattened techniques list: ${techniques.slice(0, 80).join(', ')}`);
		}

		const methods = (editingData.methods ?? []).map((skill) => normalize(skill)).filter(Boolean);
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
			_id: crypto.randomUUID(),
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
			_id: crypto.randomUUID(),
			libraryId: selected.id,
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
			_id: crypto.randomUUID(),
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
			_id: crypto.randomUUID(),
			libraryId: selected.id,
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

	// Export the edited data for the parent to save
	export const getEditedData = () => editingData;
</script>

<div class="resume-print-page relative bg-white p-10 text-slate-900 shadow-sm">
	<!-- Language Toggle -->
	{#if !isEditing}
		<ResumeLanguageToggle {language} onToggle={toggleLanguage} />
	{/if}

	<!-- Header Section -->
	<div class="header-top">
		<!-- Brand -->
		<ResumeBrand />

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
						<h1 class="mb-2 text-4xl font-bold text-slate-900">{displayName}</h1>
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

					<!-- Example Skills -->
					<ResumeExampleSkills
						bind:skills={editingData.exampleSkills}
						{isEditing}
						language={componentLanguage}
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
					<ResumeNameTitle
						name={displayName}
						bind:title={editingData.title}
						{isEditing}
						language={componentLanguage}
					/>

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
			</div>
		{/if}
	</div>

	<!-- Previous Experience Section -->
	<ResumePreviousExperiences
		bind:experiences={editingData.experiences}
		{isEditing}
		language={componentLanguage}
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
	<div class="mt-8 flex justify-center border-t border-slate-200 pt-6">
		<img
			src={worldclassUrl}
			alt="Worldclass Tech, Worldclass People"
			class="max-h-[200px] w-auto object-contain"
			loading="lazy"
		/>
	</div>
</div>

<style>
	.consultant-profile {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
</style>
