<script lang="ts">
	import { Card } from '@pixelcode_/blocks/components';
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';
	import {
		FileText,
		Users,
		Upload,
		ArrowRight,
		Sparkles,
		BookOpen,
		Clock,
		CalendarCheck,
		User
	} from 'lucide-svelte';
	import { resolve } from '$app/paths';

	const { data } = $props();
	const effectiveRoles = $derived.by(() => {
		const fromRoles = Array.isArray(data.roles) ? data.roles : [];
		if (fromRoles.length > 0) return fromRoles;
		return typeof data.role === 'string' ? [data.role] : [];
	});
	const isTalentOnly = $derived(effectiveRoles.length === 1 && effectiveRoles[0] === 'talent');
	const signedInUserName = $derived.by(() => {
		const firstName =
			typeof data.profile?.first_name === 'string' ? data.profile.first_name.trim() : '';
		const lastName =
			typeof data.profile?.last_name === 'string' ? data.profile.last_name.trim() : '';
		const fullName = [firstName, lastName].filter(Boolean).join(' ');
		if (fullName) return fullName;

		const email = typeof data.user?.email === 'string' ? data.user.email.trim() : '';
		if (email) return email;

		return 'there';
	});

	const stats = $derived(data.stats ?? { totalTalents: 0, totalResumes: 0, availableNow: 0 });
	let recentResumes = $state<
		Array<{
			id: string;
			talentId: string;
			versionName: string | null;
			updatedAt: string | null;
			talentName: string;
			talentAvatarUrl: string | null;
		}>
	>([]);
	let availableSoon = $state<
		Array<{
			id: string;
			name: string;
			avatarUrl: string | null;
			availability: {
				nowPercent: number | null;
				futurePercent: number | null;
				noticePeriodDays: number | null;
				switchFromDate: string | null;
				plannedFromDate: string | null;
				hasData: boolean;
			};
			organisationName: string | null;
			organisationLogoUrl: string | null;
		}>
	>([]);
	let panelsStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let panelsError = $state<string | null>(null);
	let panelsEtag = $state<string | null>(null);

	const loadDashboardPanels = async () => {
		if (panelsStatus === 'loading') return;
		if (panelsStatus === 'ready') return;

		panelsStatus = 'loading';
		panelsError = null;

		try {
			const response = await fetch('/internal/api/dashboard/panels', {
				method: 'GET',
				credentials: 'include',
				headers: panelsEtag ? { 'If-None-Match': panelsEtag } : undefined
			});

			if (response.status === 304) {
				panelsStatus = 'ready';
				return;
			}

			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(message || 'Could not load dashboard panels.');
			}

			const payload = (await response.json()) as {
				recentResumes?: Array<{
					id: string;
					talentId: string;
					versionName: string | null;
					updatedAt: string | null;
					talentName: string;
					talentAvatarUrl: string | null;
				}>;
				availableSoon?: Array<{
					id: string;
					name: string;
					avatarUrl: string | null;
					availability: {
						nowPercent: number | null;
						futurePercent: number | null;
						noticePeriodDays: number | null;
						switchFromDate: string | null;
						plannedFromDate: string | null;
						hasData: boolean;
					};
					organisationName: string | null;
					organisationLogoUrl: string | null;
				}>;
			};

			recentResumes = Array.isArray(payload.recentResumes) ? payload.recentResumes : [];
			availableSoon = Array.isArray(payload.availableSoon) ? payload.availableSoon : [];
			panelsEtag = response.headers.get('etag');
			panelsStatus = 'ready';
			panelsError = null;
		} catch (error) {
			panelsStatus = 'error';
			panelsError = error instanceof Error ? error.message : 'Could not load dashboard panels.';
		}
	};

	$effect(() => {
		if (isTalentOnly) return;
		if (panelsStatus !== 'idle') return;
		void loadDashboardPanels();
	});
	const listAvatarSrc = (url: string | null | undefined) =>
		transformSupabasePublicUrl(url, supabaseImagePresets.avatarList);
	const listAvatarSrcSet = (url: string | null | undefined) =>
		transformSupabasePublicUrlSrcSet(url, [36, 72], {
			height: supabaseImagePresets.avatarList.height,
			quality: supabaseImagePresets.avatarList.quality,
			resize: supabaseImagePresets.avatarList.resize
		});
	const listAvatarFallbackSrc = (url: string | null | undefined) => getOriginalImageUrl(url);

	const tips = [
		{
			title: 'Import from PDF',
			description:
				'Save time by uploading an existing PDF resume. Our AI will extract and structure the content automatically.',
			icon: Upload
		},
		{
			title: 'Keep it updated',
			description:
				'Regular updates help match consultants with the right projects. Add new skills and experiences as they happen.',
			icon: Sparkles
		},
		{
			title: 'Tech stack matters',
			description:
				'Add relevant technologies to make consultants discoverable. Clients often search by specific tech skills.',
			icon: BookOpen
		}
	];

	const formatDate = (dateStr: string | null) => {
		if (!dateStr) return '—';
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	};

	const formatRelativeDate = (dateStr: string | null) => {
		if (!dateStr) return '—';
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = date.getTime() - now.getTime();
		const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

		if (diffDays <= 0) return 'Now';
		if (diffDays === 1) return 'Tomorrow';
		if (diffDays <= 7) return `In ${diffDays} days`;
		return formatDate(dateStr);
	};
</script>

<section class="space-y-8">
	<header>
		<h1 class="text-foreground text-2xl font-bold">Hello, {signedInUserName}</h1>
		<p class="text-muted-fg mt-1">
			Create and manage professional consultant resumes for your team.
		</p>
	</header>

	{#if !isTalentOnly}
		<!-- Stats -->
		<div class="grid gap-4 sm:grid-cols-3">
			<a href={resolve('/talents')}>
				<Card class="group relative rounded-sm p-5 transition-all hover:shadow-md">
					<div class="flex items-start gap-4">
						<div
							class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-sm bg-blue-500 text-white"
						>
							<Users size={24} />
						</div>
						<div>
							<p class="text-muted-fg text-sm">Total Talents</p>
							<p class="text-foreground text-2xl font-bold">{stats.totalTalents}</p>
						</div>
					</div>
					<ArrowRight
						size={20}
						class="text-muted-fg group-hover:text-primary absolute right-4 top-4 transition-all duration-200 group-hover:translate-x-1"
					/>
				</Card>
			</a>
			<a href={resolve('/resumes')}>
				<Card class="group relative rounded-sm p-5 transition-all hover:shadow-md">
					<div class="flex items-start gap-4">
						<div
							class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-sm bg-emerald-500 text-white"
						>
							<FileText size={24} />
						</div>
						<div>
							<p class="text-muted-fg text-sm">Total Resumes</p>
							<p class="text-foreground text-2xl font-bold">{stats.totalResumes}</p>
						</div>
					</div>
					<ArrowRight
						size={20}
						class="text-muted-fg group-hover:text-primary absolute right-4 top-4 transition-all duration-200 group-hover:translate-x-1"
					/>
				</Card>
			</a>
			<a href={resolve('/resumes')}>
				<Card class="group relative rounded-sm p-5 transition-all hover:shadow-md">
					<div class="flex items-start gap-4">
						<div
							class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-sm bg-amber-500 text-white"
						>
							<CalendarCheck size={24} />
						</div>
						<div>
							<p class="text-muted-fg text-sm">Available Now</p>
							<p class="text-foreground text-2xl font-bold">{stats.availableNow}</p>
						</div>
					</div>
					<ArrowRight
						size={20}
						class="text-muted-fg group-hover:text-primary absolute right-4 top-4 transition-all duration-200 group-hover:translate-x-1"
					/>
				</Card>
			</a>
		</div>
	{/if}

	{#if !isTalentOnly}
		<!-- Recent Resumes & Available Soon -->
		<div class="grid gap-6 lg:grid-cols-2">
			<!-- Recent Resumes -->
			<Card class="rounded-sm p-5">
				<div class="mb-4 flex items-center justify-between">
					<h2 class="text-foreground flex items-center gap-2 font-semibold">
						<Clock size={18} class="text-muted-fg" />
						Recently Updated
					</h2>
					<a href={resolve('/resumes')} class="text-primary text-sm hover:underline">View all</a>
				</div>
				{#if panelsStatus === 'loading'}
					<p class="text-muted-fg text-sm">Loading recent resumes...</p>
				{:else if panelsError}
					<p class="text-muted-fg text-sm">{panelsError}</p>
				{:else if recentResumes.length === 0}
					<p class="text-muted-fg text-sm">No resumes yet.</p>
				{:else}
					<div class="space-y-3">
						{#each recentResumes as resume (resume.id)}
							<a
								href={resolve('/resumes/[personId]', { personId: resume.talentId })}
								class="hover:bg-muted -mx-2 flex items-center gap-3 rounded-sm px-2 py-2 transition-colors"
							>
								<div class="bg-muted flex h-9 w-9 items-center justify-center rounded-sm">
									{#if resume.talentAvatarUrl}
										<img
											src={listAvatarSrc(resume.talentAvatarUrl)}
											srcset={listAvatarSrcSet(resume.talentAvatarUrl)}
											sizes="36px"
											alt={resume.talentName}
											class="h-9 w-9 rounded-sm object-cover"
											loading="lazy"
											decoding="async"
											onerror={(event) =>
												applyImageFallbackOnce(event, listAvatarFallbackSrc(resume.talentAvatarUrl))}
										/>
									{:else}
										<User size={18} class="text-muted-fg" />
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<p class="text-foreground truncate text-sm font-medium">{resume.talentName}</p>
									<p class="text-muted-fg truncate text-xs">
										{resume.versionName || 'Main resume'}
									</p>
								</div>
								<span class="text-muted-fg shrink-0 text-xs">{formatDate(resume.updatedAt)}</span>
							</a>
						{/each}
					</div>
				{/if}
			</Card>

			<!-- Available Soon -->
			<Card class="rounded-sm p-5">
				<div class="mb-4 flex items-center justify-between">
					<h2 class="text-foreground flex items-center gap-2 font-semibold">
						<CalendarCheck size={18} class="text-muted-fg" />
						Available Soon
					</h2>
					<a href={resolve('/resumes')} class="text-primary text-sm hover:underline">Search</a>
				</div>
				{#if panelsStatus === 'loading'}
					<p class="text-muted-fg text-sm">Loading upcoming availability...</p>
				{:else if panelsError}
					<p class="text-muted-fg text-sm">{panelsError}</p>
				{:else if availableSoon.length === 0}
					<p class="text-muted-fg text-sm">No consultants becoming available within 30 days.</p>
				{:else}
					<div class="space-y-3">
						{#each availableSoon as consultant (consultant.id)}
							<a
								href={resolve('/resumes/[personId]', { personId: consultant.id })}
								class="hover:bg-muted -mx-2 flex items-center gap-3 rounded-sm px-2 py-2 transition-colors"
							>
								<div class="bg-muted flex h-9 w-9 items-center justify-center rounded-sm">
									{#if consultant.avatarUrl}
										<img
											src={listAvatarSrc(consultant.avatarUrl)}
											srcset={listAvatarSrcSet(consultant.avatarUrl)}
											sizes="36px"
											alt={consultant.name}
											class="h-9 w-9 rounded-sm object-cover"
											loading="lazy"
											decoding="async"
											onerror={(event) =>
												applyImageFallbackOnce(event, listAvatarFallbackSrc(consultant.avatarUrl))}
										/>
									{:else}
										<User size={18} class="text-muted-fg" />
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<p class="text-foreground truncate text-sm font-medium">{consultant.name}</p>
									<ConsultantAvailabilityPills compact availability={consultant.availability} />
								</div>
								<span
									class="shrink-0 rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
								>
									{formatRelativeDate(
										consultant.availability.switchFromDate ?? consultant.availability.plannedFromDate
									)}
								</span>
							</a>
						{/each}
					</div>
				{/if}
			</Card>
		</div>
	{/if}

	<!-- Tips Section -->
	<div>
		<h2 class="text-foreground mb-4 text-lg font-semibold">Tips for better resumes</h2>
		<div class="grid gap-4 sm:grid-cols-3">
			{#each tips as tip (tip.title)}
				<div class="border-border bg-muted rounded-sm border p-4">
					<div
						class="bg-card text-primary mb-3 flex h-10 w-10 items-center justify-center rounded-sm shadow-sm"
					>
						<tip.icon size={20} />
					</div>
					<h3 class="text-foreground font-medium">{tip.title}</h3>
					<p class="text-muted-fg mt-1 text-sm">{tip.description}</p>
				</div>
			{/each}
		</div>
	</div>
</section>
