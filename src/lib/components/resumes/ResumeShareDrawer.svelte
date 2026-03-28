<script lang="ts">
	import { deserialize } from '$app/forms';
	import { Button, Checkbox, FormControl, Input, TextArea } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { OptionButton, type OptionButtonOption } from '$lib/components/option-button';
	import Check from 'lucide-svelte/icons/check';
	import CheckCircle2 from 'lucide-svelte/icons/check-circle-2';
	import Copy from 'lucide-svelte/icons/copy';
	import { onDestroy } from 'svelte';

	let {
		open = $bindable(false),
		resumeId
	}: {
		open: boolean;
		resumeId: string;
	} = $props();

	let label = $state('');
	let isAnonymized = $state(false);
	let accessMode = $state<'link' | 'password'>('password');
	let languageMode = $state<'sv' | 'en' | 'both'>('both');
	let password = $state('');
	let neverExpires = $state(false);
	let expiresInDays = $state('30');
	let allowDownload = $state(false);
	let includeContactInfo = $state(false);
	let contactName = $state('');
	let contactEmail = $state('');
	let contactPhone = $state('');
	let contactNote = $state('');
	let isSubmitting = $state(false);
	let errorMessage = $state<string | null>(null);
	let createdShareUrl = $state<string | null>(null);
	let hasCopiedLink = $state(false);
	let successStateVersion = $state(0);

	let copyFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;

	const clearCopyFeedbackTimeout = () => {
		if (!copyFeedbackTimeout) return;
		clearTimeout(copyFeedbackTimeout);
		copyFeedbackTimeout = null;
	};

	onDestroy(() => {
		clearCopyFeedbackTimeout();
	});

	const languageOptions = [
		{ label: 'Swedish', value: 'sv' },
		{ label: 'English', value: 'en' },
		{ label: 'Both', value: 'both' }
	] satisfies OptionButtonOption<'sv' | 'en' | 'both'>[];

	const resetResult = () => {
		clearCopyFeedbackTimeout();
		errorMessage = null;
		createdShareUrl = null;
		hasCopiedLink = false;
	};

	const shareSummary = $derived.by(() => {
		const parts = [
			accessMode === 'password' ? 'Password protected' : 'Anyone with link',
			languageMode === 'both'
				? 'Swedish and English'
				: languageMode === 'sv'
					? 'Swedish only'
					: 'English only',
			neverExpires ? 'Never expires' : `Expires in ${expiresInDays} days`,
			allowDownload ? 'PDF download enabled' : 'PDF download disabled'
		];
		if (isAnonymized) {
			parts.push('Anonymized');
		}
		if (includeContactInfo && (contactName || contactEmail || contactPhone || contactNote)) {
			parts.push('Contact info included');
		}
		return parts.join(' · ');
	});

	const copyCreatedLink = async () => {
		if (!createdShareUrl) return;
		errorMessage = null;
		if (typeof navigator === 'undefined' || !navigator.clipboard) {
			errorMessage = 'Clipboard is not available in this browser.';
			return;
		}

		try {
			await navigator.clipboard.writeText(createdShareUrl);
			hasCopiedLink = true;
			clearCopyFeedbackTimeout();
			copyFeedbackTimeout = setTimeout(() => {
				hasCopiedLink = false;
				copyFeedbackTimeout = null;
			}, 2200);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Could not copy share link.';
		}
	};

	const parseActionResponse = async (response: Response) => {
		const result = deserialize(await response.text()) as {
			type?: string;
			data?: Record<string, unknown>;
		};

		return {
			type: result.type ?? 'error',
			data: result.data ?? null
		};
	};

	const submit = async () => {
		isSubmitting = true;
		errorMessage = null;
		try {
			const formData = new FormData();
			formData.set('resume_id', resumeId);
			formData.set('label', label);
			formData.set('is_anonymized', isAnonymized ? 'true' : 'false');
			formData.set('access_mode', accessMode);
			formData.set('language_mode', languageMode);
			formData.set('allow_download', allowDownload ? 'true' : 'false');
			formData.set('never_expires', neverExpires ? 'true' : 'false');
			formData.set('contact_name', includeContactInfo ? contactName : '');
			formData.set('contact_email', includeContactInfo ? contactEmail : '');
			formData.set('contact_phone', includeContactInfo ? contactPhone : '');
			formData.set('contact_note', includeContactInfo ? contactNote : '');
			if (!neverExpires) {
				formData.set('expires_in_days', expiresInDays);
			}
			if (accessMode === 'password') {
				formData.set('password', password);
			}

			const response = await fetch('?/createResumeShareLink', {
				method: 'POST',
				body: formData
			});
			const result = await parseActionResponse(response);
			const payload = result.data;
			if (result.type !== 'success') {
				throw new Error(
					payload && typeof payload.message === 'string'
						? payload.message
						: 'Could not create share link.'
				);
			}

			createdShareUrl =
				payload && typeof payload.shareUrl === 'string' ? payload.shareUrl : null;
			if (!createdShareUrl) {
				throw new Error('Share link was created, but the URL could not be returned.');
			}
			hasCopiedLink = false;
			clearCopyFeedbackTimeout();
			successStateVersion += 1;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Could not create share link.';
		} finally {
			isSubmitting = false;
		}
	};
</script>

<Drawer
	bind:open
	variant="right"
	title="Share resume"
	subtitle="Create a private link for this specific resume version."
	beforeClose={() => {
		resetResult();
		return true;
	}}
>
	{#if createdShareUrl}
		{#key successStateVersion}
			<div class="space-y-5">
				<div class="border-border bg-background rounded-sm border px-5 py-6 shadow-sm">
					<div class="flex flex-col items-center text-center">
						<div class="share-success-icon-wrapper">
							<div class="share-success-icon bg-emerald-100 text-emerald-700">
								<CheckCircle2 class="h-8 w-8" />
							</div>
						</div>

						<h3 class="mt-4 text-xl font-semibold text-foreground">
							{hasCopiedLink ? 'Link copied' : 'Share link created'}
						</h3>
						<p class="mt-2 max-w-sm text-sm text-muted-fg">
							{#if hasCopiedLink}
								The private link is now on your clipboard and ready to share.
							{:else}
								The private link is ready. Copy it and send it to the recipient outside the platform.
							{/if}
						</p>
						<p class="mt-3 text-xs text-muted-fg">{shareSummary}</p>
					</div>
				</div>

				{#if errorMessage}
					<p class="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
						{errorMessage}
					</p>
				{/if}

				<Button
					type="button"
					variant="primary"
					class={`w-full justify-center ${hasCopiedLink ? 'share-copy-success' : ''}`}
					onclick={copyCreatedLink}
				>
					{#if hasCopiedLink}
						<Check class="h-4 w-4" />
						Copied
					{:else}
						<Copy class="h-4 w-4" />
						Copy link
					{/if}
				</Button>

				<div class="flex justify-center">
					<Button type="button" variant="ghost" onclick={resetResult}>Create another</Button>
				</div>
			</div>
		{/key}
	{:else}
		<div class="space-y-5">
			<div class="grid gap-3">
				<button
					type="button"
					class={`cursor-pointer rounded-sm border px-4 py-3 text-left transition-colors ${
						accessMode === 'password'
							? 'border-primary bg-primary/5 hover:bg-primary/10'
							: 'border-border hover:border-primary/40 hover:bg-muted/40'
					}`}
					onclick={() => (accessMode = 'password')}
				>
					<p class="text-sm font-semibold text-foreground">Password required</p>
					<p class="mt-1 text-xs text-muted-fg">Recipients must enter a password before viewing.</p>
				</button>

				<button
					type="button"
					class={`cursor-pointer rounded-sm border px-4 py-3 text-left transition-colors ${
						accessMode === 'link'
							? 'border-primary bg-primary/5 hover:bg-primary/10'
							: 'border-border hover:border-primary/40 hover:bg-muted/40'
					}`}
					onclick={() => (accessMode = 'link')}
				>
					<p class="text-sm font-semibold text-foreground">Anyone with link</p>
					<p class="mt-1 text-xs text-muted-fg">No password prompt, but still private and unlisted.</p>
				</button>
			</div>

			{#if accessMode === 'password'}
				<FormControl label="Password" required class="gap-2">
					<Input
						bind:value={password}
						type="password"
						minlength={6}
						autocomplete="new-password"
						class="bg-input text-foreground"
					/>
				</FormControl>
			{/if}

			<FormControl label="Label" class="gap-2">
				<Input
					bind:value={label}
					maxlength={120}
					placeholder="Acme client March pitch"
					class="bg-input text-foreground"
				/>
			</FormControl>

			<OptionButton
				label="Languages"
				bind:value={languageMode}
				options={languageOptions}
				variant="outline"
			/>

			<div class="space-y-3">
				<label class="flex cursor-pointer items-start gap-3 rounded-sm border border-border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-muted/30">
					<Checkbox bind:checked={isAnonymized} />
					<div>
						<p class="text-sm font-semibold text-foreground">Anonymize shared resume</p>
						<p class="mt-1 text-xs text-muted-fg">Hide direct personal identifiers in the shared view.</p>
					</div>
				</label>

				<label class="flex cursor-pointer items-start gap-3 rounded-sm border border-border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-muted/30">
					<Checkbox bind:checked={allowDownload} />
					<div>
						<p class="text-sm font-semibold text-foreground">Allow PDF download</p>
						<p class="mt-1 text-xs text-muted-fg">Expose a PDF download action on the public share page.</p>
					</div>
				</label>
			</div>

			<label class="flex cursor-pointer items-start gap-3 rounded-sm border border-border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-muted/30">
				<Checkbox bind:checked={neverExpires} />
				<div>
					<p class="text-sm font-semibold text-foreground">Never expires</p>
					<p class="mt-1 text-xs text-muted-fg">Leave this off to auto-disable the link after a set number of days.</p>
				</div>
			</label>

			<label class="flex cursor-pointer items-start gap-3 rounded-sm border border-border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-muted/30">
				<Checkbox bind:checked={includeContactInfo} />
				<div>
					<p class="text-sm font-semibold text-foreground">Add contact info</p>
					<p class="mt-1 text-xs text-muted-fg">
						Show a contact button on the shared resume that opens the sender’s contact details.
					</p>
				</div>
			</label>

			{#if includeContactInfo}
				<div class="space-y-4 rounded-sm border border-border px-4 py-4">
					<FormControl label="Contact name" class="gap-2">
						<Input
							bind:value={contactName}
							maxlength={120}
							placeholder="Jane Doe"
							class="bg-input text-foreground"
						/>
					</FormControl>

					<div class="grid gap-4 sm:grid-cols-2">
						<FormControl label="Email" class="gap-2">
							<Input
								bind:value={contactEmail}
								type="email"
								maxlength={320}
								placeholder="jane@company.com"
								class="bg-input text-foreground"
							/>
						</FormControl>

						<FormControl label="Phone number" class="gap-2">
							<Input
								bind:value={contactPhone}
								maxlength={64}
								placeholder="+46 70 123 45 67"
								class="bg-input text-foreground"
							/>
						</FormControl>
					</div>

					<FormControl label="Short note" class="gap-2">
						<TextArea
							bind:value={contactNote}
							rows={4}
							maxlength={1000}
							placeholder="Reach out if you want to discuss the profile or book an intro call."
							class="bg-input text-foreground"
						/>
					</FormControl>
				</div>
			{/if}

			{#if !neverExpires}
				<FormControl label="Expires in days" required class="gap-2">
					<Input
						bind:value={expiresInDays}
						type="number"
						min="1"
						max="365"
						class="bg-input text-foreground"
					/>
				</FormControl>
			{/if}

			{#if errorMessage}
				<p class="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
					{errorMessage}
				</p>
			{/if}

			<div class="flex justify-end gap-2">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Close</Button>
				<Button type="button" variant="primary" onclick={submit} disabled={isSubmitting}>
					{isSubmitting ? 'Generating…' : 'Generate link'}
				</Button>
			</div>
		</div>
	{/if}
</Drawer>

<style>
	.share-success-icon-wrapper {
		display: flex;
		justify-content: center;
	}

	.share-success-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		padding: 0.9rem;
		animation: share-success-pop 360ms ease-out both;
	}

	.share-copy-success {
		animation: share-copy-pulse 220ms ease-out;
	}

	@keyframes share-success-pop {
		0% {
			opacity: 0;
			transform: scale(0.72);
		}

		70% {
			opacity: 1;
			transform: scale(1.08);
		}

		100% {
			opacity: 1;
			transform: scale(1);
		}
	}

	@keyframes share-copy-pulse {
		0% {
			transform: scale(1);
		}

		50% {
			transform: scale(1.03);
		}

		100% {
			transform: scale(1);
		}
	}
</style>
