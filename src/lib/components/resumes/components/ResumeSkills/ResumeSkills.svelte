<script lang="ts">
	import { TechStackEditor, TechStackSelector } from '$lib/components';
	import type { Language } from '../utils';
	import type { TechCategory } from '$lib/types/resume';

	let {
		techniques = $bindable(),
		methods = $bindable(),
		profileTechStack = [],
		isEditing = false,
		language = 'sv'
	}: {
		techniques: string[];
		methods: string[];
		profileTechStack?: TechCategory[];
		isEditing?: boolean;
		language?: Language;
	} = $props();

	const normalize = (value: string) => value.trim().toLowerCase();
	const profileSkills = $derived(
		profileTechStack
			?.flatMap((cat) => cat.skills ?? [])
			.map((s) => s.trim())
			.filter(Boolean) ?? []
	);
	const profileSet = $derived(new Set(profileSkills.map(normalize)));
	const extraTechniques = $derived(
		techniques
			.filter((tech) => !profileSet.has(normalize(tech)))
			.map((t) => t.trim())
			.filter(Boolean)
	);

	const translations: Record<string, { sv: string; en: string }> = {
		frontend: { sv: 'Frontend', en: 'Frontend' },
		backend: { sv: 'Backend', en: 'Backend' },
		tools: { sv: 'Verktyg', en: 'Tools' },
		design: { sv: 'Design', en: 'Design' },
		'ui/ux': { sv: 'UI/UX', en: 'UI/UX' },
		devops: { sv: 'DevOps', en: 'DevOps' },
		database: { sv: 'Databas', en: 'Database' },
		methodologies: { sv: 'Metoder', en: 'Methods' },
		architecture: { sv: 'Arkitektur', en: 'Architecture' },
		'soft skills': { sv: 'Mjuka färdigheter', en: 'Soft skills' },
		methods: { sv: 'Metoder', en: 'Methods' },
		other: { sv: 'Övrigt', en: 'Other' }
	};

	const labelFor = (name: string, lang: Language) => {
		const key = name.trim().toLowerCase();
		const entry = translations[key];
		return entry ? entry[lang] : name;
	};

	const displayCategories = $derived(() =>
		(profileTechStack ?? [])
			.filter((cat) => (cat.skills ?? []).length > 0)
			.map((cat) => ({ ...cat, name: labelFor(cat.name, language) }))
	);
</script>

{#if isEditing || displayCategories().length > 0}
	<section class="resume-print-section mt-8">
		<!-- Section Header with dividers -->
		<div class="grid gap-6 md:grid-cols-[18%_1fr]">
			<h2 class="text-base font-bold text-foreground uppercase">
				{language === 'sv' ? 'Kompetenser' : 'Skills'}
			</h2>
			<div class="flex items-center">
				<div class="h-px flex-1 bg-border"></div>
			</div>
		</div>

		<div class="mt-4 space-y-4">
			{#if isEditing}
				<div class="rounded-xs border border-border bg-muted p-4">
					<p class="mb-2 text-sm font-semibold text-muted-fg">
						{language === 'sv'
							? 'Teknikstack (ändra och dra/ släpp kategorier och skills)'
							: 'Tech stack (drag/drop between categories)'}
					</p>
					<TechStackEditor bind:categories={profileTechStack} {isEditing} />
				</div>
			{:else}
				{#each displayCategories() as category (category.id)}
					<div class="grid gap-6 md:grid-cols-[18%_1fr]">
						<p class="pt-1 text-xs font-bold tracking-wide text-muted-fg uppercase">
							{labelFor(category.name, language)}
						</p>
						<div class="flex flex-wrap gap-2">
							{#each category.skills as tech}
								<span class="rounded-xs bg-muted px-3 py-1 text-xs text-foreground">{tech}</span>
							{/each}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</section>
{/if}
