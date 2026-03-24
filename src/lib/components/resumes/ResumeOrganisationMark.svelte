<script lang="ts">
	import { cn } from '@pixelcode_/blocks/utils';

	let {
		organisationLogoUrl = null,
		organisationName = null,
		showNameWithLogo = false,
		class: className
	} = $props<{
		organisationLogoUrl?: string | null;
		organisationName?: string | null;
		showNameWithLogo?: boolean;
		class?: string;
	}>();
</script>

{#if organisationLogoUrl && organisationName && showNameWithLogo}
	<span class={cn('inline-flex items-center gap-2', className)}>
		<img src={organisationLogoUrl} alt={organisationName} class="h-5 w-auto object-contain" />
		<span class="text-muted-fg text-xs font-medium">{organisationName}</span>
	</span>
{:else if organisationLogoUrl}
	<img
		src={organisationLogoUrl}
		alt={organisationName ?? 'Organisation'}
		class={cn('h-5 w-auto object-contain', className)}
	/>
{:else if organisationName}
	<span class={cn('text-muted-fg text-xs font-medium', className)}>{organisationName}</span>
{/if}
