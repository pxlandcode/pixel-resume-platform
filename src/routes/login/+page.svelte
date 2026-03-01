<script lang="ts">
	import LoginForm from '$lib/components/login-form/login-form.svelte';
	import { page } from '$app/stores';

	const { form } = $props();

	const redirectTo = $derived($page.url.searchParams.get('redirect'));
</script>

<div class="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-12">
	<LoginForm {form} {redirectTo} />
</div>
