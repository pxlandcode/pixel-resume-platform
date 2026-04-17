<script lang="ts">
	import { Upload, Sparkles, BookOpen } from 'lucide-svelte';
	import type { ComponentType } from 'svelte';

	const tips: Array<{ title: string; description: string; icon: ComponentType }> = [
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
</script>

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
