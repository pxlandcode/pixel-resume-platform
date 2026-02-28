<script lang="ts">
	import { page } from '$app/stores';

	const status = $derived($page.status);
	const errorMessage = $derived(
		typeof $page.error === 'object' && $page.error && 'message' in $page.error
			? String(($page.error as { message?: unknown }).message ?? '')
			: ''
	);
</script>

<div class="bg-background text-foreground flex min-h-screen items-center justify-center px-6 py-12">
	<div class="border-border bg-card w-full max-w-xl rounded-lg border p-8 shadow-sm">
		<p class="text-sm font-medium tracking-wide text-primary uppercase">Resume Platform</p>
		<h1 class="text-foreground mt-2 text-2xl font-semibold">
			{status === 404 ? 'Page not found' : 'Something went wrong'}
		</h1>
		<p class="text-muted-fg mt-3 text-sm">
			{errorMessage || 'The page could not be loaded. Please try again or go back to the dashboard.'}
		</p>

		<div class="mt-6 flex flex-wrap gap-3">
			<a
				href="/"
				class="inline-flex items-center rounded-sm bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90"
			>
				Go to dashboard
			</a>
			<a
				href="/resumes"
				class="border-border text-muted-fg hover:bg-muted/70 inline-flex items-center rounded-sm border px-4 py-2 text-sm font-medium transition"
			>
				Open resumes
			</a>
		</div>
	</div>
</div>
