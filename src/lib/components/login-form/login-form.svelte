<script lang="ts">
	import { dev } from '$app/environment';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Button, FormControl, Input } from '@pixelcode_/blocks/components';

	const { form = null, redirectTo = null, oauthMessage = null, ...rest } = $props();

	let pending = $state(false);

	const handleEnhance: SubmitFunction = async () => {
		pending = true;

		return async ({ update }) => {
			pending = false;
			await update();
		};
	};
</script>

<div class="border-border bg-card mx-auto w-full max-w-sm space-y-6 rounded-lg border p-8 shadow">
	<header class="space-y-1 text-center">
		<h1 class="text-foreground text-xl font-semibold">Resume Platform</h1>
		<p class="text-muted-fg text-sm">Sign in with your work email to continue.</p>
	</header>

	<form method="POST" action="?/password" class="space-y-5" use:enhance={handleEnhance} {...rest}>
		<FormControl label="Email" required class="text-text gap-2">
			<Input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				class="bg-input text-foreground placeholder:text-muted-fg"
				required
			/>
		</FormControl>

		<FormControl label="Password" required class="text-text gap-2">
			<Input
				id="password"
				name="password"
				type="password"
				class="bg-input text-foreground placeholder:text-muted-fg"
				required
				autocomplete={dev ? 'off' : 'current-password'}
			/>
		</FormControl>

		{#if form?.message || oauthMessage}
			<p class="rounded-md bg-rose-100 px-3 py-2 text-sm text-rose-600">
				{form?.message ?? oauthMessage}
			</p>
		{/if}

		{#if redirectTo}
			<input type="hidden" name="redirectTo" value={redirectTo} />
		{/if}

		<Button type="submit" class="w-full justify-center" disabled={pending}>
			{pending ? 'Signing in…' : 'Sign in'}
		</Button>
	</form>

	<div class="flex items-center gap-3">
		<div class="bg-border h-px flex-1"></div>
		<span class="text-muted-fg text-xs font-medium uppercase">or</span>
		<div class="bg-border h-px flex-1"></div>
	</div>

	<form method="POST" action="?/microsoft">
		{#if redirectTo}
			<input type="hidden" name="redirectTo" value={redirectTo} />
		{/if}
		<Button type="submit" variant="outline" class="w-full justify-center">
			Sign in with Microsoft
		</Button>
	</form>
</div>

<style>
	:global(input:-webkit-autofill),
	:global(input:-webkit-autofill:hover),
	:global(input:-webkit-autofill:focus) {
		-webkit-text-fill-color: var(--color-foreground);
		transition: background-color 9999s ease-out 0s;
	}
</style>
