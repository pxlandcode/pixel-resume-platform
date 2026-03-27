<script lang="ts">
	import { TechStackEditor } from '$lib/components';
	import type { Language } from '../utils';
	import type { TechCategory } from '$lib/types/resume';

	let {
		techniques = $bindable(),
		methods = $bindable(),
		profileTechStack = $bindable([] as TechCategory[]),
		isEditing = false,
		language = 'sv',
		organisationId = null
	}: {
		techniques: string[];
		methods: string[];
		profileTechStack?: TechCategory[];
		isEditing?: boolean;
		language?: Language;
		organisationId?: string | null;
	} = $props();

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
			<h2 class="text-foreground text-base font-bold uppercase">
				{language === 'sv' ? 'Kompetenser' : 'Skills'}
			</h2>
			<div class="flex items-center">
				<div class="bg-border h-px flex-1"></div>
			</div>
		</div>

		<div class="mt-4 space-y-4">
			{#if isEditing}
				<div class="rounded-xs border-border bg-muted border p-4">
					<p class="text-secondary-text mb-2 text-sm font-semibold">
						{language === 'sv'
							? 'Teknikstack (ändra och dra/ släpp kategorier och skills)'
							: 'Tech stack (drag/drop between categories)'}
					</p>
					<TechStackEditor bind:categories={profileTechStack} {isEditing} {organisationId} />
				</div>
			{:else}
				{#each displayCategories() as category (category.id)}
					<div class="grid gap-6 md:grid-cols-[18%_1fr]">
						<p class="text-secondary-text pt-1 text-xs font-bold uppercase tracking-wide">
							{labelFor(category.name, language)}
						</p>
						<div class="flex flex-wrap gap-2">
							{#each category.skills as tech}
								<span class="rounded-xs bg-muted text-foreground px-3 py-1 text-xs">{tech}</span>
							{/each}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</section>
{/if}
