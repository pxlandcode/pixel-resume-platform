<script lang="ts">
	import type { ResumeData, LocalizedText, Person, TechCategory } from '$lib/types/resume';
	import { soloImages } from '$lib/images/manifest';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		supabaseImageSizes,
		supabaseImageSrcsetWidths,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';
	import pdfStyles from './pdf-print.css?inline';
	import andLogo from '$lib/assets/and.svg?url';
	import pixelcodeLogoDark from '$lib/assets/pixelcodelogodark.svg?url';
	import worldclassUrl from '$lib/assets/worldclass.svg?url';

	type ImageResource = (typeof soloImages)[keyof typeof soloImages];
	type ResolvedImage = {
		src: string;
		srcset?: string;
		fallbackSrc?: string;
		sizes?: string;
	};
	type Language = 'sv' | 'en';

	let {
		data,
		image,
		language = 'sv',
		person,
		profileTechStack: initialProfileTechStack,
		templateKey = 'default',
		templateMainLogotypeUrl = null,
		templateAccentLogoUrl = null,
		templateEndLogoUrl = null,
		templateHomepageUrl = null,
		templateMainFontCssStack = "'Inter', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
		templateIsPixelCode = false
	}: {
		data: ResumeData;
		image?: ImageResource | string | null;
		language?: Language;
		person?: Person;
		profileTechStack?: TechCategory[];
		templateKey?: string;
		templateMainLogotypeUrl?: string | null;
		templateAccentLogoUrl?: string | null;
		templateEndLogoUrl?: string | null;
		templateHomepageUrl?: string | null;
		templateMainFontCssStack?: string;
		templateIsPixelCode?: boolean;
	} = $props();

	const resolvedBrandLogo = $derived(templateMainLogotypeUrl ?? pixelcodeLogoDark);
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

	const resolvedImage: ResolvedImage | null = $derived.by(() => {
		const source = image ?? person?.avatar_url ?? null;
		if (!source) return null;

		if (typeof source === 'string') {
			const fallbackSrc = getOriginalImageUrl(source);
			return {
				src: transformSupabasePublicUrl(source, supabaseImagePresets.avatarPrint),
				srcset: transformSupabasePublicUrlSrcSet(source, supabaseImageSrcsetWidths.avatarPrint, {
					height: supabaseImagePresets.avatarPrint.height,
					quality: supabaseImagePresets.avatarPrint.quality,
					resize: supabaseImagePresets.avatarPrint.resize
				}),
				fallbackSrc,
				sizes: supabaseImageSizes.avatarPrint
			};
		}
		return {
			src: source.src,
			srcset: source.srcset,
			fallbackSrc: source.fallbackSrc ?? source.src,
			sizes: supabaseImageSizes.avatarPrint
		};
	});

	let profileTechStack: TechCategory[] = initialProfileTechStack ?? person?.techStack ?? [];
	const profileHasSkills = $derived(profileTechStack.some((cat) => cat.skills.length > 0));
	const normalize = (value: string) => value.trim().toLowerCase();
	const profileSkillSet = $derived(
		new Set(profileTechStack.flatMap((cat) => cat.skills ?? []).map((skill) => normalize(skill)))
	);
	const extraTechniques = $derived(
		(data.techniques ?? []).filter((tech) => !profileSkillSet.has(normalize(tech)))
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
	const labelFor = (name: string) => {
		const key = name.trim().toLowerCase();
		const entry = translations[key];
		return entry ? entry[language] : name;
	};
	const displayCategories = $derived(() => {
		const categories: TechCategory[] = profileTechStack.filter(
			(cat) => (cat.skills ?? []).length > 0
		);
		if (extraTechniques.length > 0) {
			categories.push({ id: 'other', name: labelFor('other'), skills: extraTechniques });
		}
		if (data.methods.length > 0) {
			categories.push({ id: 'methods', name: labelFor('methods'), skills: data.methods });
		}
		return categories;
	});

	$effect(() => {
		profileTechStack = initialProfileTechStack ?? person?.techStack ?? [];
	});

	// Helper to resolve localized text
	const t = (text: LocalizedText | undefined): string => {
		if (!text) return '';
		if (typeof text === 'string') return text;
		return text[language] ?? text.sv ?? '';
	};

	const visibleHighlighted = $derived.by(() => {
		const items = data.highlightedExperiences ?? [];
		const nonHidden = items.filter((exp) => !exp.hidden);
		if (nonHidden.length > 0) return nonHidden;
		return items;
	});

	const visibleExperiences = $derived.by(() => {
		const items = data.experiences ?? [];
		const nonHidden = items.filter((exp) => !exp.hidden);
		if (nonHidden.length > 0) return nonHidden;
		return items;
	});

	const displayName = $derived((data.name ?? '').trim() || (person?.name ?? '').trim());
	const displayTitle = $derived((t(data.title) ?? '').trim() || (person?.title ?? '').trim());
	const displaySummary = $derived((t(data.summary) ?? '').trim() || (person?.bio ?? '').trim());
	const displayFooterNote = $derived((t(data.footerNote) ?? '').trim());
	const resumeRootStyle = $derived(
		`--resume-main-font: ${templateMainFontCssStack}; font-family: var(--resume-main-font);`
	);

	// Format date for display (e.g., "Jan 2020")
	const formatDate = (dateString: string | null | undefined): string => {
		if (!dateString) return language === 'sv' ? 'Pågående' : 'Ongoing';
		const date = new Date(dateString);
		if (isNaN(date.getTime())) return dateString;
		const month = date.toLocaleDateString(language === 'sv' ? 'sv-SE' : 'en-US', {
			month: 'short'
		});
		const year = date.getFullYear();
		return `${month} ${year}`;
	};
</script>

<svelte:head>
	{@html `<style>${pdfStyles}</style>`}
</svelte:head>

<div class="pdf-mode" data-template-key={templateKey} style={resumeRootStyle}>
	<!-- PAGE 1: COVER PAGE -->
	<div class="resume-print-page page-1 bg-white text-slate-900">
		<!-- Header Section -->
		<div class="header-top">
			<!-- Brand -->
			<div class="header-brand mb-6 text-center">
				<img src={resolvedBrandLogo} alt="Brand logo" class="mx-auto h-8" />
				{#if templateIsPixelCode}
					<p
						class="-rotate-10 text-primary -mt-1 text-2xl"
						style="font-family: 'Fave Script', cursive;"
					>
						proudly presents
					</p>
				{/if}
			</div>

			<!-- Two Column Layout (matching ConsultantProfile) -->
			<div class="header-grid grid flex-1 grid-cols-[45mm_1fr] gap-8">
				<!-- Left Column: Image + Skills + Contact -->
				<div class="consultant-profile">
					<!-- Profile Image (matching ConsultantProfile.svelte) -->
					<div
						class="rounded-xs relative aspect-square w-full flex-shrink-0 overflow-hidden border border-slate-200 bg-white"
					>
						{#if resolvedImage}
							<img
								src={resolvedImage.src}
								srcset={resolvedImage.srcset}
								sizes={resolvedImage.sizes}
								alt={displayName || 'Profile'}
								class="h-full w-full object-cover object-center"
								data-debug="avatar-image"
								data-fallback-src={resolvedImage.fallbackSrc ?? resolvedImage.src}
								loading="lazy"
								decoding="async"
								onerror={(event) =>
									applyImageFallbackOnce(event, resolvedImage.fallbackSrc ?? resolvedImage.src)}
							/>
						{:else}
							<div
								class="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-400"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-20 w-20"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="1.5"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
									/>
								</svg>
							</div>
						{/if}
					</div>

					<!-- Example Skills (pills that wrap) -->
					{#if data.exampleSkills.length > 0}
						<div class="rounded-xs flex-shrink-0 p-4">
							<p class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-700">
								{language === 'sv' ? 'Exempel på färdigheter' : 'Examples of skills'}
							</p>
							<div class="flex flex-wrap gap-1">
								{#each data.exampleSkills as skill}
									<span class="rounded-xs bg-slate-200 px-2 py-0.5 text-xs text-slate-700"
										>{skill}</span
									>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Contact (matching ConsultantProfile.svelte) -->
					{#if data.contacts.length > 0}
						<div class="rounded-xs flex-shrink-0 space-y-3 bg-slate-50 p-4">
							{#each data.contacts as contact}
								<div class="space-y-1">
									<p class="text-xs font-semibold uppercase tracking-wide text-slate-600">
										{language === 'sv' ? 'Kontakt' : 'Contact'}
									</p>
									<div class="space-y-2 text-sm text-slate-800">
										<div class="leading-tight">
											<p class="text-sm font-medium">{contact.name}</p>
											{#if contact.phone}<p class="text-xs text-slate-600">{contact.phone}</p>{/if}
											{#if contact.email}<p class="text-xs text-slate-600">{contact.email}</p>{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Right Column: Name + Summary + Highlighted Experience -->
				<div class="space-y-6">
					<!-- Name and Title -->
					<div>
						{#if displayName}
							<h1 class="mb-2 text-4xl font-bold text-slate-900">{displayName}</h1>
						{/if}
						{#if displayTitle}
							<h2 class="text-xl font-medium text-slate-700">{displayTitle}</h2>
						{/if}
					</div>

					<!-- Summary -->
					<div class="text-sm leading-relaxed text-slate-700" data-debug="summary">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html displaySummary}
					</div>

					<!-- Highlighted Experience (matching HighlightedExperience.svelte) -->
					{#if visibleHighlighted.length > 0}
						<div class="space-y-4">
							<h3 class="pt-4 text-base font-bold uppercase tracking-wide text-slate-900">
								{language === 'sv' ? 'Utvald Erfarenhet' : 'Highlighted Experience'}
							</h3>

							{#each visibleHighlighted as exp}
								<div class="border-primary space-y-3 border-l pl-4" data-debug="highlighted-item">
									<div>
										<p class="text-sm font-semibold text-slate-900">{exp.company}</p>
										<p class="text-sm italic text-slate-700">{t(exp.role)}</p>
									</div>
									<div class="experience-description text-sm leading-relaxed text-slate-700">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -->
										{@html t(exp.description)}
									</div>
									{#if exp.technologies.length > 0}
										<div class="space-y-1">
											<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">
												{language === 'sv' ? 'Nyckeltekniker' : 'Key Technologies'}
											</p>
											<div class="flex flex-wrap gap-2">
												{#each exp.technologies as tech}
													<span class="rounded-xs bg-slate-100 px-3 py-1 text-xs text-slate-800"
														>{tech}</span
													>
												{/each}
											</div>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Ampersand at bottom left -->
		<div class="ampersand-container">
			<img
				src={resolvedAccentLogo}
				class="ampersand-logo h-20 w-auto opacity-80"
				alt="Brand accent logo"
			/>
			<p class="ampersand-url">{resolvedHomepage}</p>
		</div>
	</div>

	<!-- PAGE 2+: CONTENT -->
	<div class="page-break"></div>

	<div class="resume-print-page page-2-plus bg-white text-slate-900">
		<!-- Previous Experience Section (matching ExperienceSection + ExperienceItem) -->
		{#if visibleExperiences.length > 0}
			<section class="resume-print-section mb-8">
				<!-- Section Header with dividers (matching ExperienceSection.svelte) -->
				<div class="grid gap-6 md:grid-cols-[18%_1fr]">
					<h2 class="text-base font-bold uppercase text-slate-900">
						{language === 'sv' ? 'Tidigare Erfarenheter' : 'Previous Experience'}
					</h2>
					<div class="flex items-center">
						<div class="h-px flex-1 bg-slate-300"></div>
					</div>
				</div>

				<div class="mt-4 space-y-6">
					{#each visibleExperiences as exp}
						<!-- Experience Item (matching ExperienceItem.svelte) -->
						<div class="grid gap-6 md:grid-cols-[18%_1fr]" data-debug="experience-item">
							<!-- Column 1: Period, Company, Location -->
							<div class="space-y-1">
								<p class="text-sm font-semibold text-slate-900">
									<span class="whitespace-nowrap">{formatDate(exp.startDate)}</span>
									<span> - </span>
									<span class="whitespace-nowrap">{formatDate(exp.endDate)}</span>
								</p>
								<p class="text-sm font-semibold text-slate-900">{exp.company}</p>
								{#if exp.location}
									<p class="text-sm text-slate-700">{t(exp.location)}</p>
								{/if}
							</div>

							<!-- Column 2: Role, Description, Technologies -->
							<div class="space-y-3">
								<h3 class="hyphens-auto break-words text-base font-bold text-slate-900" lang="en">
									{t(exp.role)}
								</h3>
								<div
									class="hyphens-auto break-words text-sm leading-relaxed text-slate-700"
									lang="en"
								>
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									{@html t(exp.description)}
								</div>
								{#if exp.technologies.length > 0}
									<div class="flex flex-wrap gap-2">
										{#each exp.technologies as tech}
											<span class="rounded-xs bg-slate-100 px-3 py-1 text-xs text-slate-800"
												>{tech}</span
											>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Skills Section (matching SkillsCategorized with pills for techniques/methods) -->
		{#if displayCategories().length > 0}
			<section class="resume-print-section mb-8">
				<!-- Section Header with dividers -->
				<div class="grid gap-6 md:grid-cols-[18%_1fr]">
					<h2 class="text-base font-bold uppercase text-slate-900">
						{language === 'sv' ? 'Kompetenser' : 'Skills'}
					</h2>
					<div class="flex items-center">
						<div class="h-px flex-1 bg-slate-300"></div>
					</div>
				</div>

				<div class="mt-4 space-y-4">
					{#each displayCategories() as category, categoryIndex (`${category.id}-${categoryIndex}`)}
						<div class="grid gap-6 md:grid-cols-[18%_1fr]">
							<p class="pt-1 text-xs font-bold uppercase tracking-wide text-slate-700">
								{labelFor(category.name)}
							</p>
							<div class="flex flex-wrap gap-2">
								{#each category.skills as skill}
									<span class="rounded-xs bg-slate-100 px-3 py-1 text-xs text-slate-800"
										>{skill}</span
									>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Other Section (Languages, Education, Portfolio - matching SkillsCategorized) -->
		{#if data.languages.length > 0 || data.education.length > 0 || (data.portfolio && data.portfolio.length > 0)}
			<section class="resume-print-section mb-8">
				<!-- Section Header with dividers -->
				<div class="grid gap-6 md:grid-cols-[18%_1fr]">
					<h2 class="text-base font-bold uppercase text-slate-900">
						{language === 'sv' ? 'Övrigt' : 'Other'}
					</h2>
					<div class="flex items-center">
						<div class="h-px flex-1 bg-slate-300"></div>
					</div>
				</div>

				<div class="mt-4 space-y-4">
					{#if data.languages.length > 0}
						<!-- Languages Row (matching SkillsCategorized isLanguage) -->
						<div class="grid gap-6 md:grid-cols-[18%_1fr]">
							<p class="pt-1 text-xs font-bold uppercase tracking-wide text-slate-700">
								{language === 'sv' ? 'Språk' : 'Languages'}
							</p>
							<div class="flex flex-col gap-1 text-sm text-slate-800">
								{#each data.languages as lang}
									<p>
										<span class="font-bold">{t(lang.label)}</span>: {t(lang.value)}
									</p>
								{/each}
							</div>
						</div>
					{/if}

					{#if data.education.length > 0}
						<!-- Education Row (matching SkillsCategorized isEducation) -->
						<div class="grid gap-6 md:grid-cols-[18%_1fr]">
							<p class="pt-1 text-xs font-bold uppercase tracking-wide text-slate-700">
								{language === 'sv' ? 'Utbildning' : 'Education'}
							</p>
							<div class="flex flex-col gap-1 text-sm text-slate-800">
								{#each data.education as edu}
									<p>
										<span class="font-semibold">{edu.label}</span>
										{#if t(edu.value)}<span>: {t(edu.value)}</span>{/if}
									</p>
								{/each}
							</div>
						</div>
					{/if}

					{#if data.portfolio && data.portfolio.length > 0}
						<!-- Portfolio Row (matching SkillsCategorized isPortfolio) -->
						<div class="grid gap-6 md:grid-cols-[18%_1fr]">
							<p class="pt-1 text-xs font-bold uppercase tracking-wide text-slate-700">Portfolio</p>
							<div class="flex flex-wrap gap-2 text-sm text-slate-800">
								{#each data.portfolio as url}
									<a
										href={url}
										target="_blank"
										rel="noopener noreferrer"
										class="underline decoration-slate-400 underline-offset-2 hover:decoration-slate-700"
										>{url}</a
									>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</section>
		{/if}

		<!-- Footer -->
		{#if displayFooterNote}
			<div class="mt-8 border-t border-slate-200 pt-4 text-center text-sm italic text-slate-500">
				{displayFooterNote}
			</div>
		{/if}

		<!-- Worldclass image at bottom -->
		<div class="mt-8 flex justify-center border-t border-slate-200 pt-6">
			<img
				src={resolvedEndLogo}
				alt="Worldclass Tech, Worldclass People"
				class="max-h-[200px] w-auto object-contain"
			/>
		</div>
		<!-- Ampersand at bottom left -->
		<div class="ampersand-container">
			<img
				src={resolvedAccentLogo}
				class="ampersand-logo h-20 w-auto opacity-80"
				alt="Brand accent logo"
			/>
			<p class="ampersand-url">{resolvedHomepage}</p>
		</div>
	</div>
</div>

<style>
	.pdf-mode {
		background: #fff;
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0;
	}

	.page-1 {
		display: flex;
		flex-direction: column;
		min-height: 297mm;
		position: relative;
	}

	.page-2-plus {
		position: relative;
	}

	.consultant-profile {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.ampersand-container {
		position: absolute;
		bottom: 15mm;
		left: 15mm;
		z-index: 10;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2mm;
	}

	.ampersand-url {
		margin: 0;
		font-size: 8px;
		color: rgb(148 163 184);
	}

	:global(body) {
		background: #fff;
	}

	:global(.experience-description blockquote) {
		border-left-width: 2px;
		border-color: var(--color-primary);
		padding-left: 0.75rem;
		font-size: 0.875rem;
		color: rgb(51 65 85);
		font-style: italic;
		margin-top: 0.5rem;
		margin-bottom: 0.5rem;
	}
	:global(.experience-description blockquote::before) {
		content: '"';
	}
	:global(.experience-description blockquote::after) {
		content: '"';
	}

	:global(.resume-print-page blockquote) {
		border-left-width: 2px;
		border-color: var(--color-primary);
		padding-left: 0.75rem;
		font-size: 0.875rem;
		color: rgb(51 65 85);
		font-style: italic;
		margin-top: 0.5rem;
		margin-bottom: 0.5rem;
	}
	:global(.resume-print-page blockquote::before) {
		content: '"';
	}
	:global(.resume-print-page blockquote::after) {
		content: '"';
	}
</style>
