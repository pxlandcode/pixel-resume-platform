<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Button, FormControl, Input } from '@pixelcode_/blocks/components';
	import LegalDocumentsDrawer from '$lib/components/admin/LegalDocumentsDrawer.svelte';
	import type { ActionData, PageData } from './$types';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Scale from 'lucide-svelte/icons/scale';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();
	let isLegalDrawerOpen = $state(false);
	let isPasswordSavePending = $state(false);

	const submitPasswordChange: SubmitFunction = async () => {
		isPasswordSavePending = true;

		return async ({ update }) => {
			isPasswordSavePending = false;
			await update();
		};
	};

	const passwordMessage = $derived(
		form?.type === 'changePassword' && typeof form.message === 'string' ? form.message : null
	);
	const isPasswordMessageSuccess = $derived(
		form?.type === 'changePassword' && form.ok === true
	);

	type SettingItem = {
		id: string;
		title: string;
		description: string;
		icon: typeof Scale;
		action: () => void;
	};

	const settingsItems: SettingItem[] = [
		{
			id: 'legal',
			title: 'Legal documents',
			description: 'Manage terms of service, privacy notices, and other legal documents.',
			icon: Scale,
			action: () => {
				isLegalDrawerOpen = true;
			}
		}
	];
</script>

{#if data.mode === 'admin'}
	<div class="space-y-6">
		<header>
			<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Settings</h1>
			<p class="text-muted-fg mt-3 text-lg">Manage administrative workspace settings.</p>
		</header>

		<div class="border-border bg-card divide-border divide-y rounded-sm border">
			{#each settingsItems as item (item.id)}
				<button
					type="button"
					class="hover:bg-muted/50 flex w-full items-center gap-4 p-4 text-left transition-colors"
					onclick={item.action}
				>
					<div
						class="bg-muted text-muted-fg flex h-10 w-10 shrink-0 items-center justify-center rounded-sm"
					>
						<item.icon class="h-5 w-5" />
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-foreground text-sm font-semibold">{item.title}</p>
						<p class="text-muted-fg mt-0.5 text-sm">{item.description}</p>
					</div>
					<ChevronRight class="text-muted-fg h-5 w-5 shrink-0" />
				</button>
			{/each}
		</div>
	</div>

	<LegalDocumentsDrawer bind:open={isLegalDrawerOpen} documents={data.legalDocuments ?? []} />
{:else}
	<div class="space-y-6">
		<header>
			<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Settings</h1>
			<p class="text-muted-fg mt-3 text-lg">Manage your account settings.</p>
		</header>

		<section class="border-border bg-card rounded-sm border p-5 sm:p-6">
			<h2 class="text-foreground text-lg font-semibold">Change password</h2>
			<p class="text-muted-fg mt-1 text-sm">Set a new password for your account.</p>

			<form
				method="POST"
				action="?/changePassword"
				class="mt-6 max-w-md space-y-5"
				use:enhance={submitPasswordChange}
			>
				<FormControl label="New password" required class="text-text gap-2">
					<Input
						id="password"
						name="password"
						type="password"
						class="bg-input text-foreground placeholder:text-muted-fg"
						required
						minlength={8}
						autocomplete="new-password"
					/>
				</FormControl>

				<FormControl label="Confirm password" required class="text-text gap-2">
					<Input
						id="confirm_password"
						name="confirm_password"
						type="password"
						class="bg-input text-foreground placeholder:text-muted-fg"
						required
						minlength={8}
						autocomplete="new-password"
					/>
				</FormControl>

				{#if passwordMessage}
					<p
						class={`rounded-md px-3 py-2 text-sm ${
							isPasswordMessageSuccess
								? 'bg-emerald-100 text-emerald-800'
								: 'bg-rose-100 text-rose-700'
						}`}
					>
						{passwordMessage}
					</p>
				{/if}

				<Button type="submit" class="justify-center" disabled={isPasswordSavePending}>
					{isPasswordSavePending ? 'Saving…' : 'Update password'}
				</Button>
			</form>
		</section>
	</div>
{/if}
