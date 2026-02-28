<script lang="ts">
	import { Card, Button } from '@pixelcode_/blocks/components';
	import { FileText, Users, Upload, ArrowRight, Sparkles, BookOpen } from 'lucide-svelte';

	const { data } = $props();

	const quickActions = [
		{
			title: 'View Talents',
			description: 'Browse all consultants and their talent profiles',
			href: '/talents',
			icon: Users,
			color: 'bg-blue-500'
		},
		{
			title: 'Manage Resumes',
			description: 'Create, edit, and organize consultant resumes',
			href: '/resumes',
			icon: FileText,
			color: 'bg-emerald-500'
		}
	];

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
			title: 'Use templates',
			description:
				'Start with a proven structure. Our templates are designed to highlight consultant strengths effectively.',
			icon: BookOpen
		}
	];
</script>

<section class="space-y-8">
	<header>
		<h1 class="text-foreground text-2xl font-bold">Welcome to ResumeBuilder</h1>
		<p class="text-muted-fg mt-1">
			Create and manage professional consultant resumes for your team.
		</p>
	</header>

	<!-- Quick Actions -->
	<div class="grid gap-4 sm:grid-cols-2">
		{#each quickActions as action}
			<a
				href={action.href}
				class="border-border bg-card hover:border-border/80 group relative flex items-start gap-4 rounded-sm border p-5 shadow-sm transition-all hover:shadow-md"
			>
				<div
					class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-sm {action.color} text-white"
				>
					<action.icon size={24} />
				</div>
				<div class="flex-1">
					<h3 class="text-foreground group-hover:text-primary font-semibold">
						{action.title}
					</h3>
					<p class="text-muted-fg mt-1 text-sm">{action.description}</p>
				</div>
				<ArrowRight
					size={20}
					class="text-muted-fg absolute right-5 top-1/2 -translate-y-1/2 transition-transform group-hover:translate-x-1 group-hover:text-primary"
				/>
			</a>
		{/each}
	</div>

	<!-- Your Profile Card -->
	<Card class="p-6">
		<div class="flex items-start justify-between">
			<div>
				<h2 class="text-foreground text-lg font-semibold">Your Profile</h2>
				<div class="text-muted-fg mt-3 space-y-1.5 text-sm">
					<p>
						<span class="text-foreground font-medium">Name:</span>
						{[data.profile?.first_name, data.profile?.last_name].filter(Boolean).join(' ') ||
							'Not set'}
					</p>
					<p>
						<span class="text-foreground font-medium">Email:</span>
						{data.user?.email ?? 'Unknown'}
					</p>
					<p>
						<span class="text-foreground font-medium"
							>Role{(data.roles?.length ?? 0) > 1 ? 's' : ''}:</span
						>
						{(data.roles ?? [data.role])
							.filter(Boolean)
							.map((r) => r.replace('_', ' '))
							.join(', ')}
					</p>
				</div>
			</div>
			<Button
				variant="outline"
				size="sm"
				href={data.currentTalentId ? `/resumes/${data.currentTalentId}` : '/talents'}
			>
				Edit profile
			</Button>
		</div>
	</Card>

	<!-- Tips Section -->
	<div>
		<h2 class="text-foreground mb-4 text-lg font-semibold">Tips for better resumes</h2>
		<div class="grid gap-4 sm:grid-cols-3">
			{#each tips as tip}
				<div class="border-border bg-muted rounded-sm border p-4">
					<div
						class="bg-card mb-3 flex h-10 w-10 items-center justify-center rounded-sm text-primary shadow-sm"
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
