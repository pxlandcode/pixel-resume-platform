<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '@pixelcode_/blocks/utils';
	import { Card } from '@pixelcode_/blocks/components';
	import { User } from 'lucide-svelte';
	import type { ResumesTalentListItem } from '$lib/types/resumes';
	import type { TalentLabelDefinition } from '$lib/types/talentLabels';
	import { tooltip } from '$lib/utils/tooltip';
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
	import TalentLabelCluster from './TalentLabelCluster.svelte';
	import { getTalentName } from './pageShared';

	type Badge = {
		label: string;
		className: string;
		tooltip?: string;
	};

	type Props = {
		children?: Snippet;
		href: string;
		talent: ResumesTalentListItem;
		desktopBadge?: Badge | null;
		mobileBadge?: Badge | null;
		extraBadges?: Badge[];
		badgePlacement?: 'image' | 'header';
		highlight?: boolean;
		showOrganisation?: boolean;
		overflowVisible?: boolean;
		inlineMetaRow?: boolean;
		labelDefinitions?: TalentLabelDefinition[];
		canManageTalentLabels?: boolean;
		labelMutationBusy?: boolean;
		onAssignTalentLabel?: (talentId: string, labelDefinitionId: string) => void;
		onRemoveTalentLabel?: (talentId: string, labelDefinitionId: string) => void;
	};

	let {
		children,
		href,
		talent,
		desktopBadge = null,
		mobileBadge = null,
		extraBadges = [],
		badgePlacement = 'image',
		highlight = false,
		showOrganisation = true,
		overflowVisible = false,
		inlineMetaRow = false,
		labelDefinitions = [],
		canManageTalentLabels = false,
		labelMutationBusy = false,
		onAssignTalentLabel,
		onRemoveTalentLabel
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
	const headerBadges = $derived.by<Badge[]>(() => {
		if (badgePlacement !== 'header') return [];

		const badges: Badge[] = [];
		if (desktopBadge) badges.push(desktopBadge);
		else if (resolvedMobileBadge) badges.push(resolvedMobileBadge);

		return [...badges, ...extraBadges];
	});
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

			{#if badgePlacement === 'image' && (desktopBadge || talent.labels.length > 0 || canManageTalentLabels)}
				<div class="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2">
					{#if desktopBadge}
						<span
							class={cn(
								'inline-flex items-center rounded-full px-2 py-1 text-xs font-bold shadow-sm',
								desktopBadge.tooltip && 'cursor-help',
								desktopBadge.className
							)}
							use:tooltip={desktopBadge.tooltip ?? ''}
						>
							{desktopBadge.label}
						</span>
					{:else}
						<span></span>
					{/if}

					{#if talent.labels.length > 0 || canManageTalentLabels}
						<TalentLabelCluster
							talentId={talent.id}
							labels={talent.labels}
							{labelDefinitions}
							canManage={canManageTalentLabels}
							busy={labelMutationBusy}
							menuAlign="right"
							onAssign={onAssignTalentLabel}
							onRemove={onRemoveTalentLabel}
						/>
					{/if}
				</div>
			{/if}
		</div>

		<div class="flex flex-1 flex-col p-5">
			<div class="flex items-start justify-between gap-2">
				<h3 class="text-foreground min-w-0 text-lg font-semibold">{getTalentName(talent)}</h3>
				{#if headerBadges.length > 0}
					<div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
						{#each headerBadges as headerBadge, badgeIndex (`${headerBadge.label}-${badgeIndex}`)}
							<span
								class={cn(
									'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
									headerBadge.tooltip && 'cursor-help',
									headerBadge.className
								)}
								use:tooltip={headerBadge.tooltip ?? ''}
							>
								{headerBadge.label}
							</span>
						{/each}
					</div>
				{:else if resolvedMobileBadge}
					<span
						class={cn(
							'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium sm:hidden',
							resolvedMobileBadge.tooltip && 'cursor-help',
							resolvedMobileBadge.className
						)}
						use:tooltip={resolvedMobileBadge.tooltip ?? ''}
					>
						{resolvedMobileBadge.label}
					</span>
				{/if}
			</div>

			{#if inlineMetaRow}
				<div class="mt-2 flex flex-wrap items-start gap-2">
					<div class="min-w-0">
						<ConsultantAvailabilityPills compact availability={talent.availability ?? null} />
					</div>
					{#if talent.labels.length > 0 || canManageTalentLabels}
						<TalentLabelCluster
							talentId={talent.id}
							labels={talent.labels}
							{labelDefinitions}
							canManage={canManageTalentLabels}
							busy={labelMutationBusy}
							menuAlign="right"
							class="shrink-0"
							onAssign={onAssignTalentLabel}
							onRemove={onRemoveTalentLabel}
						/>
					{/if}
				</div>
			{:else}
				<div class="mt-2">
					<ConsultantAvailabilityPills compact availability={talent.availability ?? null} />
				</div>
			{/if}

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
