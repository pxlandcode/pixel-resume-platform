<script lang="ts">
	export const ssr = false;

	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData } from './$types';
	import { getSupabaseClient } from '$lib/supabaseClient';
	import { Button, FormControl, Input } from '@pixelcode_/blocks/components';

	let { form }: { form: ActionData | null } = $props();

	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let errorMessage = $state<string | null>(null);
	let pending = $state(false);

	let tokens = $state<{
		accessToken: string;
		refreshToken: string;
		expiresAt: number | null;
		expiresIn: number | null;
	} | null>(null);

	const handleSubmit: SubmitFunction<ActionData, ActionData> = async () => {
		pending = true;

		return async ({ update }) => {
			pending = false;
			await update();
		};
	};

	onMount(async () => {
		const hash = window.location.hash?.slice(1) ?? '';

		if (!hash) {
			status = 'error';
			errorMessage = 'This reset link is invalid or has already been used. Please request a new email.';
			return;
		}

		const params = new URLSearchParams(hash);
		const type = params.get('type');
		const accessToken = params.get('access_token');
		const refreshToken = params.get('refresh_token');
		const expiresAt = params.get('expires_at');
		const expiresIn = params.get('expires_in');

		if (type !== 'recovery' || !accessToken || !refreshToken) {
			status = 'error';
			errorMessage = 'This reset link is invalid or has already been used. Please request a new email.';
			return;
		}

		const expiresAtNumber = expiresAt ? Number(expiresAt) : null;
		const now = Math.floor(Date.now() / 1000);

		if (expiresAtNumber && expiresAtNumber <= now) {
			status = 'error';
			errorMessage = 'This reset link has expired. Please request a new email.';
			return;
		}

		const expiresInNumber = expiresIn ? Number(expiresIn) : null;

		tokens = {
			accessToken,
			refreshToken,
			expiresAt: expiresAtNumber,
			expiresIn: Number.isFinite(expiresInNumber) ? expiresInNumber : null
		};

		try {
			const supabase = getSupabaseClient();
			const { data, error } = await supabase.auth.setSession({
				access_token: accessToken,
				refresh_token: refreshToken
			});

			if (error || !data.session) {
				status = 'error';
				errorMessage = error?.message ?? 'Unable to validate this reset link. Please try again.';
				return;
			}

			const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
			window.history.replaceState({}, '', cleanUrl);

			status = 'ready';
		} catch (error) {
			status = 'error';
			errorMessage =
				error instanceof Error
					? error.message
					: 'We could not validate this reset link. Please request a new one.';
		}
	});
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-100 px-4 py-12">
	<div class="w-full max-w-md space-y-6 rounded-lg border border-gray-200 bg-white p-8 shadow">
		<header class="space-y-1 text-center">
			<h1 class="text-xl font-semibold text-gray-900">Reset your password</h1>
			<p class="text-sm text-gray-700">Choose a new password to regain access to Resume Platform.</p>
		</header>

		{#if status === 'loading'}
			<p class="text-sm text-gray-700">Validating your reset link…</p>
		{:else if status === 'error'}
			<p class="rounded-md bg-rose-100 px-3 py-2 text-sm text-rose-600">
				{errorMessage ?? 'We could not validate this reset link. Please request a new one.'}
			</p>
		{:else if tokens}
			<form method="POST" class="space-y-5" use:enhance={handleSubmit}>
				<input type="hidden" name="access_token" value={tokens.accessToken} />
				<input type="hidden" name="refresh_token" value={tokens.refreshToken} />
				{#if tokens.expiresAt}
					<input type="hidden" name="expires_at" value={tokens.expiresAt} />
				{/if}
				{#if tokens.expiresIn}
					<input type="hidden" name="expires_in" value={tokens.expiresIn} />
				{/if}

				<FormControl label="New password" required class="text-text gap-2">
					<Input
						id="password"
						name="password"
						type="password"
						class="text-gray-900 placeholder:text-gray-400 bg-white"
						required
						minlength="8"
						autocomplete="new-password"
					/>
				</FormControl>

				<FormControl label="Confirm password" required class="text-text gap-2">
					<Input
						id="confirm_password"
						name="confirm_password"
						type="password"
						class="text-gray-900 placeholder:text-gray-400 bg-white"
						required
						minlength="8"
						autocomplete="new-password"
					/>
				</FormControl>

				{#if form?.message}
					<p
						class={`rounded-md px-3 py-2 text-sm ${
							form.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-600'
						}`}
					>
						{form.message}
					</p>
				{/if}

				<Button type="submit" class="w-full justify-center" disabled={pending}>
					{pending ? 'Saving…' : 'Update password'}
				</Button>
			</form>
		{/if}
	</div>
</div>
