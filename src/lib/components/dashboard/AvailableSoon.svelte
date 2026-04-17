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
	import { CalendarClock, User } from 'lucide-svelte';
	import { resolve } from '$app/paths';

	export type AvailableConsultant = {
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
	};

	let {
		consultants,
		status,
		error
	}: {
		consultants: AvailableConsultant[];
		status: 'idle' | 'loading' | 'ready' | 'error';
		error: string | null;
	} = $props();

	const listAvatarSrc = (url: string | null | undefined) =>
		transformSupabasePublicUrl(url, supabaseImagePresets.avatarList);
	const listAvatarSrcSet = (url: string | null | undefined) =>
		transformSupabasePublicUrlSrcSet(url, [36, 72], {
			height: supabaseImagePresets.avatarList.height,
			quality: supabaseImagePresets.avatarList.quality,
			resize: supabaseImagePresets.avatarList.resize
		});
	const listAvatarFallbackSrc = (url: string | null | undefined) => getOriginalImageUrl(url);

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

<Card class="min-w-0 rounded-sm p-5">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-foreground flex items-center gap-2 font-semibold">
			<CalendarClock size={18} class="text-muted-fg" />
			Available Soon
		</h2>
		<a href={resolve('/resumes')} class="text-primary text-sm hover:underline">View all</a>
	</div>
	{#if status === 'loading'}
		<p class="text-muted-fg text-sm">Loading upcoming availability...</p>
	{:else if error}
		<p class="text-muted-fg text-sm">{error}</p>
	{:else if consultants.length === 0}
		<p class="text-muted-fg text-sm">No consultants becoming available within 30 days.</p>
	{:else}
		<div class="space-y-3">
			{#each consultants as consultant (consultant.id)}
				<a
					href={resolve('/resumes/[personId]', { personId: consultant.id })}
					class="hover:bg-muted -mx-2 grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-sm px-2 py-2 transition-colors sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:items-center"
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
						class="col-start-2 w-fit rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 sm:col-auto sm:justify-self-end"
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
