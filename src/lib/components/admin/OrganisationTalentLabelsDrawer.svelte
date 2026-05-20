<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import { Button, Input, toast } from '@pixelcode_/blocks/components';
	import { CheckCircle2, LoaderCircle } from 'lucide-svelte';
	import { onDestroy } from 'svelte';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import type { TalentLabelDefinition } from '$lib/types/talentLabels';

	type Organisation = {
		id: string;
		name: string;
	};

	type RefreshOrganisationContext = () => Promise<void> | void;

	let {
		open = $bindable(false),
		organisation = undefined,
		talentLabelDefinitions = [],
		refreshOrganisationContext = undefined
	}: {
		open: boolean;
		organisation?: Organisation;
		talentLabelDefinitions?: TalentLabelDefinition[];
		refreshOrganisationContext?: RefreshOrganisationContext;
	} = $props();

	type PendingLabelAction =
		| { type: 'create'; labelDefinitionId: null }
		| { type: 'update' | 'delete'; labelDefinitionId: string };

	let pendingLabelAction = $state<PendingLabelAction | null>(null);
	let drawerFeedback = $state<{ kind: 'success' | 'error'; message: string } | null>(null);
	let feedbackResetTimer: ReturnType<typeof setTimeout> | null = null;

	const isSavingLabel = $derived(pendingLabelAction !== null);

	const isPendingAction = (type: PendingLabelAction['type'], labelDefinitionId?: string) =>
		pendingLabelAction?.type === type &&
		(type === 'create' || pendingLabelAction.labelDefinitionId === labelDefinitionId);

	const setDrawerFeedback = (kind: 'success' | 'error', message: string) => {
		drawerFeedback = { kind, message };
		if (feedbackResetTimer !== null) {
			clearTimeout(feedbackResetTimer);
			feedbackResetTimer = null;
		}
		if (kind === 'success') {
			feedbackResetTimer = setTimeout(() => {
				drawerFeedback = null;
				feedbackResetTimer = null;
			}, 3500);
		}
	};

	const showToast = (kind: 'success' | 'error', message: string) => {
		if (kind === 'error' && typeof toast.error === 'function') {
			toast.error(message);
			return;
		}
		if (kind === 'success' && typeof toast.success === 'function') {
			toast.success(message);
			return;
		}
		toast(message);
	};

	const getActionMessage = (
		result: ActionResult<Record<string, unknown>, Record<string, unknown>>
	) => {
		if (result.type !== 'success' && result.type !== 'failure') return null;
		return typeof result.data?.message === 'string' ? result.data.message : null;
	};

	const createLabelSubmitHandler = (options: {
		reset?: boolean;
		type: PendingLabelAction['type'];
	}): SubmitFunction => {
		return async ({ formData, cancel }) => {
			if (isSavingLabel) {
				cancel();
				return;
			}

			const labelDefinitionId = formData.get('label_definition_id');
			pendingLabelAction =
				options.type === 'create'
					? { type: 'create', labelDefinitionId: null }
					: {
							type: options.type,
							labelDefinitionId: typeof labelDefinitionId === 'string' ? labelDefinitionId : ''
						};
			drawerFeedback = null;

			return async ({ result, update }) => {
				try {
					await update({
						reset: options.reset ?? false,
						invalidateAll: false
					});

					const message = getActionMessage(result);
					if (result.type === 'success') {
						const successMessage = message ?? 'Saved.';
						showToast('success', successMessage);
						setDrawerFeedback('success', successMessage);
						await refreshOrganisationContext?.();
						return;
					}
					if (result.type === 'failure') {
						const errorMessage = message ?? 'Could not save label.';
						showToast('error', errorMessage);
						setDrawerFeedback('error', errorMessage);
						return;
					}
					if (result.type === 'error') {
						showToast('error', 'Could not save label.');
						setDrawerFeedback('error', 'Could not save label.');
					}
				} finally {
					pendingLabelAction = null;
				}
			};
		};
	};

	onDestroy(() => {
		if (feedbackResetTimer !== null) {
			clearTimeout(feedbackResetTimer);
		}
	});
</script>

<Drawer
	variant="right"
	bind:open
	title="Labels"
	subtitle="Manage Finder-style talent labels for {organisation?.name ?? 'this organisation'}."
	class="mr-0 w-full max-w-xl"
	dismissable={!isSavingLabel}
	beforeClose={() => !isSavingLabel}
>
	{#if organisation}
		<div class="flex flex-col gap-6 overflow-y-auto pb-16">
			{#if drawerFeedback}
				<div
					class={`flex items-center gap-2 rounded-sm border px-3 py-2 text-sm ${
						drawerFeedback.kind === 'success'
							? 'border-emerald-200 bg-emerald-50 text-emerald-700'
							: 'border-red-200 bg-red-50 text-red-700'
					}`}
					aria-live="polite"
				>
					{#if drawerFeedback.kind === 'success'}
						<CheckCircle2 size={16} class="shrink-0" />
					{/if}
					<span>{drawerFeedback.message}</span>
				</div>
			{/if}

			<section class="space-y-3">
				<div>
					<h3 class="text-foreground text-sm font-semibold">Create label</h3>
					<p class="text-muted-fg text-xs">
						Add a new organisation label. Labels are available immediately on `/resumes`.
					</p>
				</div>

				<form
					method="POST"
					action="?/createTalentLabelDefinition"
					class="border-border bg-card grid gap-3 rounded-sm border p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
					use:enhance={createLabelSubmitHandler({ reset: true, type: 'create' })}
				>
					<input type="hidden" name="organisation_id" value={organisation.id} />
					<Input
						name="name"
						placeholder="Label name"
						maxlength={60}
						required
						disabled={isSavingLabel}
					/>
					<input
						type="color"
						name="color_hex"
						value="#0A84FF"
						class="border-border bg-input h-10 w-14 cursor-pointer rounded-sm border p-1"
						aria-label="Label color"
						disabled={isSavingLabel}
					/>
					<Button type="submit" variant="outline" disabled={isSavingLabel}>
						{#if isPendingAction('create')}
							<LoaderCircle size={16} class="mr-2 animate-spin" />
							Creating
						{:else}
							Create
						{/if}
					</Button>
				</form>
			</section>

			<section class="space-y-3">
				<div>
					<h3 class="text-foreground text-sm font-semibold">Existing labels</h3>
					<p class="text-muted-fg text-xs">
						Rename, recolor, or delete labels. Deleting a label removes its assignments.
					</p>
				</div>

				<div class="space-y-3">
					{#each talentLabelDefinitions as label (label.id)}
						<div class="border-border bg-card rounded-sm border p-4">
							<div class="mb-3 flex items-center gap-2">
								<span
									class="ring-border/20 h-3.5 w-3.5 rounded-full ring-1"
									style={`background-color: ${label.color_hex};`}
								></span>
								<p class="text-foreground text-sm font-medium">{label.name}</p>
							</div>

							<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
								<form
									method="POST"
									action="?/updateTalentLabelDefinition"
									class="grid flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
									use:enhance={createLabelSubmitHandler({ type: 'update' })}
								>
									<input type="hidden" name="organisation_id" value={organisation.id} />
									<input type="hidden" name="label_definition_id" value={label.id} />
									<Input
										name="name"
										value={label.name}
										maxlength={60}
										required
										disabled={isSavingLabel}
									/>
									<input
										type="color"
										name="color_hex"
										value={label.color_hex}
										class="border-border bg-input h-10 w-14 cursor-pointer rounded-sm border p-1"
										aria-label={`Color for ${label.name}`}
										disabled={isSavingLabel}
									/>
									<Button type="submit" variant="outline" disabled={isSavingLabel}>
										{#if isPendingAction('update', label.id)}
											<LoaderCircle size={16} class="mr-2 animate-spin" />
											Saving
										{:else}
											Save
										{/if}
									</Button>
								</form>

								<form
									method="POST"
									action="?/deleteTalentLabelDefinition"
									use:enhance={createLabelSubmitHandler({ type: 'delete' })}
								>
									<input type="hidden" name="organisation_id" value={organisation.id} />
									<input type="hidden" name="label_definition_id" value={label.id} />
									<Button
										type="submit"
										variant="ghost"
										class="text-red-600 hover:text-red-700"
										disabled={isSavingLabel}
									>
										{#if isPendingAction('delete', label.id)}
											<LoaderCircle size={16} class="mr-2 animate-spin" />
											Deleting
										{:else}
											Delete
										{/if}
									</Button>
								</form>
							</div>
						</div>
					{:else}
						<div class="border-border rounded-sm border border-dashed p-4">
							<p class="text-muted-fg text-sm">No labels configured yet.</p>
						</div>
					{/each}
				</div>
			</section>

			<div class="sticky bottom-0 flex justify-end bg-transparent pt-4">
				<Button
					variant="outline"
					type="button"
					onclick={() => (open = false)}
					class="bg-input hover:bg-muted/70"
					disabled={isSavingLabel}
				>
					Close
				</Button>
			</div>
		</div>
	{/if}
</Drawer>
