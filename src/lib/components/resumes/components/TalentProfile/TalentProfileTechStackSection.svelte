<script lang="ts">
	import TechStackEditor from '$lib/components/tech-stack-editor/tech-stack-editor.svelte';
	import type { TechCategory } from '$lib/types/resume';
	import type { TalentTechCategory } from './types';

	let {
		isEditing = false,
		canEdit = false,
		editingTechStack = $bindable([] as TechCategory[]),
		viewCategories = []
	}: {
		isEditing?: boolean;
		canEdit?: boolean;
		editingTechStack?: TechCategory[];
		viewCategories?: TalentTechCategory[];
	} = $props();
</script>

<div class={isEditing ? 'pt-2' : ''}>
	<h3
		class="text-foreground {isEditing
			? 'mb-2 text-lg font-semibold'
			: 'mb-2 text-sm font-semibold'}"
	>
		Tech Stack
	</h3>

	{#if isEditing && canEdit}
		<TechStackEditor bind:categories={editingTechStack} isEditing />
	{:else if viewCategories.length === 0}
		<p class="text-muted-fg text-sm">No tech stack recorded yet.</p>
	{:else}
		<div class="space-y-3">
			{#each viewCategories as category (category.name ?? '')}
				<div class="space-y-1">
					<p
						class="text-foreground text-xs uppercase tracking-wide {isEditing
							? 'font-semibold'
							: ''}"
					>
						{category.name}
					</p>
					<div class="flex flex-wrap gap-2">
						{#each category.skills ?? [] as skill, skillIndex (`${category.name ?? 'cat'}-${skill}-${skillIndex}`)}
							<span class="rounded-xs bg-muted text-foreground px-3 py-1 text-xs">
								{skill}
							</span>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
