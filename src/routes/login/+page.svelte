<script lang="ts">
	import LoginForm from '$lib/components/login-form/login-form.svelte';
	import { page } from '$app/stores';

	const { form } = $props();

	const redirectTo = $derived($page.url.searchParams.get('redirect'));
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-100 px-4 py-12">
	<LoginForm {form} {redirectTo} />
</div>
