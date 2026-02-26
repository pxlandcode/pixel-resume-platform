<script lang="ts">
	import { page } from '$app/stores';

	const status = $derived($page.status);
	const errorMessage = $derived(
		typeof $page.error === 'object' && $page.error && 'message' in $page.error
			? String(($page.error as { message?: unknown }).message ?? '')
			: ''
	);
</script>

<div class="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-12">
	<div class="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
		<p class="text-sm font-medium tracking-wide text-primary uppercase">Resume Platform</p>
		<h1 class="mt-2 text-2xl font-semibold text-slate-900">
			{status === 404 ? 'Page not found' : 'Something went wrong'}
		</h1>
		<p class="mt-3 text-sm text-slate-600">
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
				class="inline-flex items-center rounded-sm border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
			>
				Open resumes
			</a>
		</div>
	</div>
</div>
