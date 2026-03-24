<script lang="ts">
	import type { ResumeSearchReason } from '$lib/types/resumes';
	import { formatSearchReasonLabel } from './pageShared';

	let { reasons } = $props<{
		reasons: ResumeSearchReason[];
	}>();
</script>

{#if reasons.length > 0}
	<div class="space-y-2">
		{#each reasons as reason, reasonIndex (`${reason.label}-${reasonIndex}`)}
			<div class="border-border rounded-none border p-2">
				<p class="text-foreground text-[11px] font-semibold uppercase tracking-wide">
					{formatSearchReasonLabel(reason)}
				</p>
				<p class="text-muted-fg mt-1 text-xs">{reason.text}</p>
			</div>
		{/each}
	</div>
{/if}
