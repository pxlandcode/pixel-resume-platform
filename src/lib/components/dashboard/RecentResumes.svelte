<script lang="ts">
	import { Card } from '@pixelcode_/blocks/components';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';
	import { Clock, User } from 'lucide-svelte';
	import { resolve } from '$app/paths';

	export type RecentResume = {
		id: string;
		talentId: string;
		versionName: string | null;
		updatedAt: string | null;
		talentName: string;
		talentAvatarUrl: string | null;
	};

	let {
		resumes,
		status,
		error
	}: {
		resumes: RecentResume[];
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
</script>

<Card class="min-w-0 rounded-sm p-5">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-foreground flex items-center gap-2 font-semibold">
			<Clock size={18} class="text-muted-fg" />
			Recently Updated
		</h2>
		<a href={resolve('/resumes')} class="text-primary text-sm hover:underline">View all</a>
	</div>
	{#if status === 'loading'}
		<p class="text-muted-fg text-sm">Loading recent resumes...</p>
	{:else if error}
		<p class="text-muted-fg text-sm">{error}</p>
	{:else if resumes.length === 0}
		<p class="text-muted-fg text-sm">No resumes yet.</p>
	{:else}
		<div class="space-y-3">
			{#each resumes as resume (resume.id)}
				<a
					href={resolve('/resumes/[personId]', { personId: resume.talentId })}
					class="hover:bg-muted -mx-2 grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-sm px-2 py-2 transition-colors sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:items-center"
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
					<span class="text-muted-fg col-start-2 text-xs sm:col-auto sm:justify-self-end">
						{formatDate(resume.updatedAt)}
					</span>
				</a>
			{/each}
		</div>
	{/if}
</Card>
