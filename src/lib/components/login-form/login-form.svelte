<script lang="ts">
	import { dev } from '$app/environment';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Button, FormControl, Input } from '@pixelcode_/blocks/components';

	const { form = null, redirectTo = null, ...rest } = $props();

	let pending = $state(false);

	const handleEnhance: SubmitFunction = async () => {
		pending = true;

		return async ({ update }) => {
			pending = false;
			await update();
		};
	};
</script>

<form
	method="POST"
	class="mx-auto w-full max-w-sm space-y-6 rounded-lg border border-gray-200 bg-white p-8 shadow"
	use:enhance={handleEnhance}
	{...rest}
>
	<header class="space-y-1 text-center">
		<h1 class="text-xl font-semibold text-gray-900">Resume Platform</h1>
		<p class="text-sm text-gray-500">Sign in with your work email to continue.</p>
	</header>

	<FormControl label="Email" required class="text-text gap-2">
		<Input
			id="email"
			name="email"
			type="email"
			autocomplete="email"
			class="text-gray-900 placeholder:text-gray-400 bg-white"
			required
		/>
	</FormControl>

	<FormControl label="Password" required class="text-text gap-2">
		<Input
			id="password"
			name="password"
			type="password"
			class="text-gray-900 placeholder:text-gray-400 bg-white"
			required
			autocomplete={dev ? 'off' : 'current-password'}
		/>
	</FormControl>

	{#if form?.message}
		<p class="rounded-md bg-rose-100 px-3 py-2 text-sm text-rose-600">{form.message}</p>
	{/if}

	{#if redirectTo}
		<input type="hidden" name="redirectTo" value={redirectTo} />
	{/if}

	<Button
		type="submit"
		class="w-full justify-center"
		disabled={pending}
	>
		{pending ? 'Signing in…' : 'Sign in'}
	</Button>
</form>

<style>
	:global(input:-webkit-autofill),
	:global(input:-webkit-autofill:hover),
	:global(input:-webkit-autofill:focus) {
		-webkit-text-fill-color: rgb(17 24 39);
		transition: background-color 9999s ease-out 0s;
	}
</style>
