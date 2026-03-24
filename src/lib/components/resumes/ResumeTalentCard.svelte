<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '@pixelcode_/blocks/utils';
	import { Card } from '@pixelcode_/blocks/components';
	import { User } from 'lucide-svelte';
	import type { ResumesTalentListItem } from '$lib/types/resumes';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		supabaseImageSizes,
		supabaseImageSrcsetWidths,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';
	import ResumeOrganisationMark from './ResumeOrganisationMark.svelte';
	import { getTalentName } from './pageShared';

	type Badge = {
		label: string;
		className: string;
	};

	type Props = {
		children?: Snippet;
		href: string;
		talent: ResumesTalentListItem;
		desktopBadge?: Badge | null;
		mobileBadge?: Badge | null;
		highlight?: boolean;
		showOrganisation?: boolean;
		overflowVisible?: boolean;
	};

	let {
		children,
		href,
		talent,
		desktopBadge = null,
		mobileBadge = null,
		highlight = false,
		showOrganisation = true,
		overflowVisible = false
	}: Props = $props();

	const cardAvatarSrc = (url: string | null | undefined) =>
		transformSupabasePublicUrl(url, supabaseImagePresets.avatarCard);

	const cardAvatarSrcSet = (url: string | null | undefined) =>
		transformSupabasePublicUrlSrcSet(url, supabaseImageSrcsetWidths.avatarCard, {
			height: supabaseImagePresets.avatarCard.height,
			quality: supabaseImagePresets.avatarCard.quality,
			resize: supabaseImagePresets.avatarCard.resize
		});

	const cardAvatarFallbackSrc = (url: string | null | undefined) => getOriginalImageUrl(url);

	const resolvedMobileBadge = $derived(mobileBadge ?? desktopBadge);
</script>

<a {href} class="block h-full">
	<Card
		class={cn(
			'flex h-full flex-col rounded-none transition-all hover:shadow-md',
			overflowVisible ? 'overflow-visible' : 'overflow-hidden',
			highlight && 'ring-2 ring-emerald-200'
		)}
	>
		<div class="relative hidden aspect-square w-full sm:block">
			<div class="bg-muted absolute inset-0 overflow-hidden">
				{#if talent.avatar_url}
					<img
						src={cardAvatarSrc(talent.avatar_url)}
						srcset={cardAvatarSrcSet(talent.avatar_url)}
						sizes={supabaseImageSizes.avatarCard}
						alt={getTalentName(talent)}
						class="h-full w-full object-cover object-center transition-transform duration-500 hover:scale-105"
						loading="lazy"
						decoding="async"
						onerror={(event) =>
							applyImageFallbackOnce(event, cardAvatarFallbackSrc(talent.avatar_url))}
					/>
				{:else}
					<div class="text-muted-fg flex h-full w-full items-center justify-center">
						<User size={48} />
					</div>
				{/if}
			</div>

			{#if desktopBadge}
				<span
					class={cn(
						'absolute right-2 top-2 z-10 inline-flex items-center rounded-full px-2 py-1 text-xs font-bold shadow-sm',
						desktopBadge.className
					)}
				>
					{desktopBadge.label}
				</span>
			{/if}
		</div>

		<div class="flex flex-1 flex-col p-5">
			<div class="flex items-center justify-between gap-2">
				<h3 class="text-foreground text-lg font-semibold">{getTalentName(talent)}</h3>
				{#if resolvedMobileBadge}
					<span
						class={cn(
							'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium sm:hidden',
							resolvedMobileBadge.className
						)}
					>
						{resolvedMobileBadge.label}
					</span>
				{/if}
			</div>

			<div class="mt-2">
				<ConsultantAvailabilityPills compact availability={talent.availability ?? null} />
			</div>

			{@render children?.()}

			{#if showOrganisation && (talent.organisation_logo_url || talent.organisation_name)}
				<div class="mt-auto pt-3">
					<ResumeOrganisationMark
						organisationLogoUrl={talent.organisation_logo_url}
						organisationName={talent.organisation_name}
					/>
				</div>
			{/if}
		</div>
	</Card>
</a>
