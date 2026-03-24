<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ComponentProps } from 'svelte';
	import { Alert, Button, Checkbox, FormControl, Input } from '@pixelcode_/blocks/components';
	import LegalDocumentsManager from '$lib/components/admin/LegalDocumentsManager.svelte';
	import { Dropdown } from '$lib/components/dropdown';
	import { OptionButton, type OptionButtonOption } from '$lib/components/option-button';
	import { ripple } from '$lib/utils/ripple';
	import type { ActionData, PageData } from './$types';
	import Scale from 'lucide-svelte/icons/scale';
	import KeyRound from 'lucide-svelte/icons/key-round';
	import Share2 from 'lucide-svelte/icons/share-2';
	import Building2 from 'lucide-svelte/icons/building-2';
	import UserRound from 'lucide-svelte/icons/user-round';
	import Eye from 'lucide-svelte/icons/eye';
	import Pencil from 'lucide-svelte/icons/pencil';
	import CircleOff from 'lucide-svelte/icons/circle-off';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	type OrganisationOption = {
		id: string;
		name: string;
	};

	type SourceTalentOption = {
		id: string;
		organisation_id: string;
		first_name: string;
		last_name: string;
	};

	type OrganisationShareRule = {
		id: string;
		source_organisation_id: string;
		target_organisation_id: string;
		access_level: 'read' | 'write';
		allow_target_logo_export: boolean;
	};

	type TalentShareRule = {
		id: string;
		source_organisation_id: string;
		target_organisation_id: string;
		talent_id: string;
		access_level: 'none' | 'read' | 'write';
		allow_target_logo_export: boolean;
	};

	type LegalDocumentsProp = ComponentProps<typeof LegalDocumentsManager>['documents'];
	type SettingsPanel = 'account' | 'legal' | 'sharing' | null;

	const organisationRuleAccessOptions = [
		{ value: 'read', label: 'Read only', icon: Eye },
		{ value: 'write', label: 'Full access', icon: Pencil }
	] satisfies OptionButtonOption<OrganisationShareRule['access_level']>[];

	const talentRuleAccessOptions = [
		{ value: 'read', label: 'Read only', icon: Eye },
		{ value: 'write', label: 'Full access', icon: Pencil },
		{ value: 'none', label: 'Exclude', icon: CircleOff }
	] satisfies OptionButtonOption<TalentShareRule['access_level']>[];

	let isPasswordSavePending = $state(false);

	const submitPasswordChange: SubmitFunction = async () => {
		isPasswordSavePending = true;

		return async ({ update }) => {
			isPasswordSavePending = false;
			await update();
		};
	};

	const sourceOrganisationOptions = $derived(
		(data.sourceOrganisationOptions as OrganisationOption[] | undefined) ?? []
	);
	const allOrganisations = $derived(
		(data.allOrganisations as OrganisationOption[] | undefined) ?? []
	);
	const sourceTalentOptions = $derived(
		(data.sourceTalentOptions as SourceTalentOption[] | undefined) ?? []
	);
	const organisationShareRules = $derived(
		(data.organisationShareRules as OrganisationShareRule[] | undefined) ?? []
	);
	const talentShareRules = $derived((data.talentShareRules as TalentShareRule[] | undefined) ?? []);
	const passwordMessage = $derived(
		form?.type === 'changePassword' && typeof form.message === 'string' ? form.message : null
	);
	const isPasswordMessageSuccess = $derived(form?.type === 'changePassword' && form.ok === true);
	const actionMessage = $derived(
		form?.type !== 'changePassword' && typeof form?.message === 'string' ? form.message : null
	);
	const actionFailed = $derived(form?.type !== 'changePassword' && form?.ok === false);
	const legalDocuments = $derived((data.legalDocuments as LegalDocumentsProp | undefined) ?? []);
	const sourceContextFromForm =
		form &&
		typeof form === 'object' &&
		'source_context_id' in form &&
		typeof form.source_context_id === 'string'
			? form.source_context_id
			: null;

	const initialSourceOrganisationId =
		sourceContextFromForm ?? data.defaultSourceOrganisationId ?? '';
	const initialExpandedPanel: SettingsPanel =
		form?.type === 'changePassword' ? 'account' : form?.type ? 'sharing' : null;

	let selectedSourceOrganisationId = $state(initialSourceOrganisationId);
	let expandedPanel = $state<SettingsPanel>(initialExpandedPanel);
	let organisationRuleTargetOrganisationId = $state('');
	let organisationRuleAccessLevel = $state<'read' | 'write'>('read');
	let organisationRuleAllowTargetLogoExport = $state(false);
	let organisationRuleEditingId = $state<string | null>(null);

	let talentRuleTargetOrganisationId = $state('');
	let talentRuleTalentId = $state('');
	let talentRuleAccessLevel = $state<'none' | 'read' | 'write'>('read');
	let talentRuleAllowTargetLogoExport = $state(false);
	let talentRuleEditingId = $state<string | null>(null);
	let previousSourceOrganisationId = $state(initialSourceOrganisationId);

	const organisationNameById = $derived(
		Object.fromEntries(
			allOrganisations.map((organisation) => [organisation.id, organisation.name] as const)
		) as Record<string, string>
	);

	const talentLabelById = $derived(
		Object.fromEntries(
			sourceTalentOptions.map((talent) => [
				talent.id,
				[talent.first_name, talent.last_name].filter(Boolean).join(' ').trim() || 'Unnamed talent'
			]) as Array<readonly [string, string]>
		) as Record<string, string>
	);

	const selectableTargetOrganisationOptions = $derived(
		allOrganisations
			.filter((organisation) => organisation.id !== selectedSourceOrganisationId)
			.map((organisation) => ({
				label: organisation.name,
				value: organisation.id
			}))
	);

	const selectableTalentOptions = $derived(
		sourceTalentOptions
			.filter((talent) => talent.organisation_id === selectedSourceOrganisationId)
			.map((talent) => ({
				label:
					[talent.first_name, talent.last_name].filter(Boolean).join(' ').trim() ||
					'Unnamed talent',
				value: talent.id
			}))
	);

	const selectedSourceOrganisationName = $derived(
		organisationNameById[selectedSourceOrganisationId] ?? 'this organisation'
	);

	const scopedOrganisationShareRules = $derived(
		organisationShareRules
			.filter((rule) => rule.source_organisation_id === selectedSourceOrganisationId)
			.sort((left, right) =>
				(organisationNameById[left.target_organisation_id] ?? '').localeCompare(
					organisationNameById[right.target_organisation_id] ?? ''
				)
			)
	);

	const scopedOrganisationRuleKeyLookup = $derived(
		Object.fromEntries(
			scopedOrganisationShareRules.map((rule) => [
				`${rule.source_organisation_id}:${rule.target_organisation_id}`,
				true
			])
		) as Record<string, true>
	);

	const scopedTalentShareGroups = $derived.by(() => {
		const groups: Array<{
			targetOrganisationId: string;
			targetOrganisationName: string;
			rules: Array<
				TalentShareRule & {
					talentLabel: string;
					shareKind: 'One-off share' | 'Override';
				}
			>;
		}> = [];
		const groupByTargetId: Record<string, (typeof groups)[number]> = {};

		const scopedRules = talentShareRules
			.filter((rule) => rule.source_organisation_id === selectedSourceOrganisationId)
			.sort((left, right) => {
				const leftTarget = organisationNameById[left.target_organisation_id] ?? '';
				const rightTarget = organisationNameById[right.target_organisation_id] ?? '';
				if (leftTarget !== rightTarget) return leftTarget.localeCompare(rightTarget);
				return (talentLabelById[left.talent_id] ?? '').localeCompare(
					talentLabelById[right.talent_id] ?? ''
				);
			});

		for (const rule of scopedRules) {
			const targetOrganisationName =
				organisationNameById[rule.target_organisation_id] ?? rule.target_organisation_id;
			const shareKind: 'One-off share' | 'Override' = scopedOrganisationRuleKeyLookup[
				`${rule.source_organisation_id}:${rule.target_organisation_id}`
			]
				? 'Override'
				: 'One-off share';
			const group = groupByTargetId[rule.target_organisation_id];
			const enrichedRule = {
				...rule,
				talentLabel: talentLabelById[rule.talent_id] ?? rule.talent_id,
				shareKind
			};

			if (group) {
				group.rules.push(enrichedRule);
				continue;
			}

			const newGroup = {
				targetOrganisationId: rule.target_organisation_id,
				targetOrganisationName,
				rules: [enrichedRule]
			};

			groupByTargetId[rule.target_organisation_id] = newGroup;
			groups.push(newGroup);
		}

		return groups;
	});

	const organisationShareCount = $derived(scopedOrganisationShareRules.length);
	const talentShareCount = $derived(
		scopedTalentShareGroups.reduce((total, group) => total + group.rules.length, 0)
	);

	$effect(() => {
		if (
			selectedSourceOrganisationId &&
			!sourceOrganisationOptions.some(
				(organisation) => organisation.id === selectedSourceOrganisationId
			)
		) {
			selectedSourceOrganisationId = sourceOrganisationOptions[0]?.id ?? '';
		}
	});

	$effect(() => {
		if (selectedSourceOrganisationId !== previousSourceOrganisationId) {
			previousSourceOrganisationId = selectedSourceOrganisationId;
			resetOrganisationRuleForm();
			resetTalentRuleForm();
		}
	});

	$effect(() => {
		if (!selectedSourceOrganisationId) {
			organisationRuleTargetOrganisationId = '';
			talentRuleTargetOrganisationId = '';
			talentRuleTalentId = '';
			organisationRuleEditingId = null;
			talentRuleEditingId = null;
			return;
		}

		const targetOptions = selectableTargetOrganisationOptions;
		if (
			!targetOptions.some(
				(organisation) => organisation.value === organisationRuleTargetOrganisationId
			)
		) {
			organisationRuleTargetOrganisationId = '';
		}
		if (
			!targetOptions.some((organisation) => organisation.value === talentRuleTargetOrganisationId)
		) {
			talentRuleTargetOrganisationId = '';
		}
		if (!selectableTalentOptions.some((talent) => talent.value === talentRuleTalentId)) {
			talentRuleTalentId = '';
		}
	});

	function resetOrganisationRuleForm() {
		organisationRuleEditingId = null;
		organisationRuleTargetOrganisationId = '';
		organisationRuleAccessLevel = 'read';
		organisationRuleAllowTargetLogoExport = false;
	}

	function beginOrganisationRuleEdit(rule: OrganisationShareRule) {
		organisationRuleEditingId = rule.id;
		organisationRuleTargetOrganisationId = rule.target_organisation_id;
		organisationRuleAccessLevel = rule.access_level;
		organisationRuleAllowTargetLogoExport = rule.allow_target_logo_export;
	}

	function resetTalentRuleForm() {
		talentRuleEditingId = null;
		talentRuleTargetOrganisationId = '';
		talentRuleTalentId = '';
		talentRuleAccessLevel = 'read';
		talentRuleAllowTargetLogoExport = false;
	}

	function beginTalentRuleEdit(rule: TalentShareRule) {
		talentRuleEditingId = rule.id;
		talentRuleTargetOrganisationId = rule.target_organisation_id;
		talentRuleTalentId = rule.talent_id;
		talentRuleAccessLevel = rule.access_level;
		talentRuleAllowTargetLogoExport = rule.allow_target_logo_export;
	}

	const accessLabel = (accessLevel: 'none' | 'read' | 'write') => {
		if (accessLevel === 'none') return 'Excluded';
		if (accessLevel === 'write') return 'Write access';
		return 'Read access';
	};

	const brandingLabel = (allowTargetLogoExport: boolean) =>
		allowTargetLogoExport ? 'Uses target organisation branding' : 'Uses talent owner branding';

	function togglePanel(panel: Exclude<SettingsPanel, null>) {
		expandedPanel = expandedPanel === panel ? null : panel;
	}
</script>

<div class="space-y-8">
	<header class="space-y-3">
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Settings</h1>
		<p class="text-muted-fg max-w-3xl text-lg">
			Manage your account, workspace governance, and how other organisations can work with your
			talents.
		</p>
	</header>

	{#if actionMessage}
		<Alert variant={actionFailed ? 'destructive' : 'success'} size="sm">
			<p class="text-foreground text-sm font-medium">{actionMessage}</p>
		</Alert>
	{/if}

	<section
		class={`bg-card group overflow-hidden rounded-sm border transition-colors ${
			expandedPanel === 'account' ? 'border-primary/50' : 'border-border hover:border-primary/50'
		}`}
	>
		<button
			type="button"
			use:ripple={{ opacity: 0.14 }}
			class="w-full text-left"
			onclick={() => togglePanel('account')}
			aria-expanded={expandedPanel === 'account'}
			aria-controls="settings-account-panel"
		>
			<div
				class="group-hover:bg-muted/50 flex items-start gap-3 px-5 py-5 transition-colors sm:px-6"
			>
				<div
					class="bg-muted text-muted-fg flex h-10 w-10 shrink-0 items-center justify-center rounded-sm"
				>
					<KeyRound class="h-5 w-5" />
				</div>
				<div class="min-w-0 flex-1">
					<h2 class="text-foreground text-lg font-semibold">Account</h2>
					<p class="text-muted-fg mt-1 text-sm">Update your password for this account.</p>
				</div>
				<div class="text-muted-fg flex shrink-0 items-center gap-2">
					<span class="hidden text-xs font-medium uppercase tracking-[0.16em] sm:block">
						Manage
					</span>
					{#if expandedPanel === 'account'}
						<ChevronDown class="h-5 w-5" />
					{:else}
						<ChevronRight class="h-5 w-5" />
					{/if}
				</div>
			</div>
		</button>

		{#if expandedPanel === 'account'}
			<div id="settings-account-panel" class="border-border border-t px-5 py-5 sm:px-6">
				<form
					method="POST"
					action="?/changePassword"
					class="max-w-md space-y-5"
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
			</div>
		{/if}
	</section>

	{#if data.canManageLegalDocuments}
		<section
			class={`bg-card group overflow-hidden rounded-sm border transition-colors ${
				expandedPanel === 'legal' ? 'border-primary/50' : 'border-border hover:border-primary/50'
			}`}
		>
			<button
				type="button"
				use:ripple={{ opacity: 0.14 }}
				class="w-full text-left"
				onclick={() => togglePanel('legal')}
				aria-expanded={expandedPanel === 'legal'}
				aria-controls="settings-legal-panel"
			>
				<div
					class="group-hover:bg-muted/50 flex items-start gap-3 px-5 py-5 transition-colors sm:px-6"
				>
					<div
						class="bg-muted text-muted-fg flex h-10 w-10 shrink-0 items-center justify-center rounded-sm"
					>
						<Scale class="h-5 w-5" />
					</div>
					<div class="min-w-0 flex-1">
						<h2 class="text-foreground text-lg font-semibold">Legal documents</h2>
						<p class="text-muted-fg mt-1 text-sm">
							Manage terms of service, privacy notices, and other mandatory legal documents.
						</p>
					</div>
					<div class="text-muted-fg flex shrink-0 items-center gap-2">
						<span class="hidden text-xs font-medium uppercase tracking-[0.16em] sm:block">
							Manage
						</span>
						{#if expandedPanel === 'legal'}
							<ChevronDown class="h-5 w-5" />
						{:else}
							<ChevronRight class="h-5 w-5" />
						{/if}
					</div>
				</div>
			</button>

			{#if expandedPanel === 'legal'}
				<div id="settings-legal-panel" class="border-border border-t px-5 py-5 sm:px-6">
					<LegalDocumentsManager documents={legalDocuments} />
				</div>
			{/if}
		</section>
	{/if}

	{#if data.canManageSharing}
		<section
			class={`bg-card group overflow-hidden rounded-sm border transition-colors ${
				expandedPanel === 'sharing' ? 'border-primary/50' : 'border-border hover:border-primary/50'
			}`}
		>
			<button
				type="button"
				use:ripple={{ opacity: 0.14 }}
				class="w-full text-left"
				onclick={() => togglePanel('sharing')}
				aria-expanded={expandedPanel === 'sharing'}
				aria-controls="settings-sharing-panel"
			>
				<div
					class="group-hover:bg-muted/50 flex items-start gap-3 px-5 py-5 transition-colors sm:px-6"
				>
					<div
						class="bg-muted text-muted-fg flex h-10 w-10 shrink-0 items-center justify-center rounded-sm"
					>
						<Share2 class="h-5 w-5" />
					</div>
					<div class="min-w-0 flex-1">
						<h2 class="text-foreground text-lg font-semibold">Sharing & access</h2>
						<p class="text-muted-fg mt-1 text-sm">
							Configure organisation-wide sharing, one-off talent access, and exceptions.
						</p>
					</div>
					<div class="text-muted-fg flex shrink-0 items-center gap-3">
						{#if sourceOrganisationOptions.length > 0}
							<div class="hidden text-right sm:block">
								<p class="text-foreground text-sm font-semibold">{organisationShareCount}</p>
								<p class="text-[11px] uppercase tracking-[0.16em]">Org rules</p>
							</div>
							<div class="hidden text-right sm:block">
								<p class="text-foreground text-sm font-semibold">{talentShareCount}</p>
								<p class="text-[11px] uppercase tracking-[0.16em]">Exceptions</p>
							</div>
						{/if}
						{#if expandedPanel === 'sharing'}
							<ChevronDown class="h-5 w-5" />
						{:else}
							<ChevronRight class="h-5 w-5" />
						{/if}
					</div>
				</div>
			</button>

			{#if expandedPanel === 'sharing'}
				<div id="settings-sharing-panel" class="border-border space-y-6 border-t px-5 py-5 sm:px-6">
					{#if sourceOrganisationOptions.length === 0}
						<Alert variant="destructive" size="sm">
							<p class="text-foreground text-sm font-medium">
								Connect your account to a home organisation before managing sharing settings.
							</p>
						</Alert>
					{:else}
						<div class="grid gap-4 lg:grid-cols-[minmax(0,1.2fr),repeat(2,minmax(0,1fr))]">
							<div>
								<Dropdown
									label="Source organisation"
									bind:value={selectedSourceOrganisationId}
									options={sourceOrganisationOptions.map((organisation) => ({
										label: organisation.name,
										value: organisation.id
									}))}
									placeholder="Choose organisation"
									search={sourceOrganisationOptions.length > 6}
									searchPlaceholder="Search organisations"
									class="w-full"
								/>
							</div>

							<div class="border-border bg-background rounded-sm border p-4">
								<p class="text-muted-fg text-xs uppercase tracking-wide">Organisation rules</p>
								<p class="text-foreground mt-2 text-2xl font-semibold">{organisationShareCount}</p>
								<p class="text-muted-fg mt-1 text-sm">
									Cross-org defaults for {selectedSourceOrganisationName}.
								</p>
							</div>

							<div class="border-border bg-background rounded-sm border p-4">
								<p class="text-muted-fg text-xs uppercase tracking-wide">Talent exceptions</p>
								<p class="text-foreground mt-2 text-2xl font-semibold">{talentShareCount}</p>
								<p class="text-muted-fg mt-1 text-sm">
									Overrides and one-off shares for individual talents.
								</p>
							</div>
						</div>
					{/if}

					{#if selectedSourceOrganisationId}
						<section class="grid gap-6 xl:grid-cols-2">
							<div class="border-border bg-card rounded-sm border p-5 sm:p-6">
								<div class="flex items-start gap-3">
									<div
										class="bg-muted text-muted-fg flex h-10 w-10 shrink-0 items-center justify-center rounded-sm"
									>
										<Building2 class="h-5 w-5" />
									</div>
									<div class="min-w-0 flex-1">
										<h3 class="text-foreground text-lg font-semibold">Organisation-wide sharing</h3>
										<p class="text-muted-fg mt-1 text-sm">
											Share all talents from {selectedSourceOrganisationName} with another organisation,
											then use talent exceptions to override specific people.
										</p>
									</div>
								</div>

								<form method="POST" action="?/upsertOrganisationShareRule" class="mt-6 space-y-4">
									<input
										type="hidden"
										name="source_context_id"
										value={selectedSourceOrganisationId}
									/>
									<input
										type="hidden"
										name="source_organisation_id"
										value={selectedSourceOrganisationId}
									/>
									<input
										type="hidden"
										name="existing_rule_id"
										value={organisationRuleEditingId ?? ''}
									/>
									<input
										type="hidden"
										name="allow_target_logo_export"
										value={organisationRuleAllowTargetLogoExport ? 'true' : 'false'}
									/>

									<Dropdown
										name="target_organisation_id"
										label="Target organisation"
										bind:value={organisationRuleTargetOrganisationId}
										options={selectableTargetOrganisationOptions}
										placeholder="Choose target organisation"
										search={selectableTargetOrganisationOptions.length > 6}
										searchPlaceholder="Search organisations"
										class="w-full"
									/>

									<OptionButton
										name="access_level"
										label="Access level"
										bind:value={organisationRuleAccessLevel}
										options={organisationRuleAccessOptions}
									/>

									<div class="border-border bg-background rounded-sm border p-4">
										<Checkbox bind:checked={organisationRuleAllowTargetLogoExport}>
											Allow exports with the target organisation&apos;s branding
										</Checkbox>
										<p class="text-muted-fg mt-2 text-xs">
											If disabled, exports keep the talent owner organisation&apos;s branding
											instead.
										</p>
									</div>

									<div class="flex flex-wrap items-center gap-3">
										<Button type="submit">
											{organisationRuleEditingId
												? 'Save organisation rule'
												: 'Add organisation rule'}
										</Button>
										{#if organisationRuleEditingId}
											<Button type="button" variant="outline" onclick={resetOrganisationRuleForm}>
												Cancel edit
											</Button>
										{/if}
									</div>
								</form>

								<div class="mt-6 space-y-3">
									{#each scopedOrganisationShareRules as rule (rule.id)}
										<div class="border-border bg-background rounded-sm border p-4">
											<div
												class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
											>
												<div class="space-y-1">
													<p class="text-foreground text-sm font-semibold">
														{organisationNameById[rule.target_organisation_id] ??
															rule.target_organisation_id}
													</p>
													<p class="text-muted-fg text-sm">{accessLabel(rule.access_level)}</p>
													<p class="text-muted-fg text-xs">
														{brandingLabel(rule.allow_target_logo_export)}
													</p>
												</div>

												<div class="flex flex-wrap gap-2">
													<Button
														type="button"
														variant="outline"
														size="sm"
														onclick={() => beginOrganisationRuleEdit(rule)}
													>
														Edit
													</Button>
													<form method="POST" action="?/deleteOrganisationShareRule">
														<input
															type="hidden"
															name="source_context_id"
															value={selectedSourceOrganisationId}
														/>
														<input type="hidden" name="rule_id" value={rule.id} />
														<Button type="submit" variant="ghost" size="sm">Remove</Button>
													</form>
												</div>
											</div>
										</div>
									{:else}
										<p class="text-muted-fg text-sm">
											No organisation-wide sharing has been configured for {selectedSourceOrganisationName}.
										</p>
									{/each}
								</div>
							</div>

							<div class="border-border bg-card rounded-sm border p-5 sm:p-6">
								<div class="flex items-start gap-3">
									<div
										class="bg-muted text-muted-fg flex h-10 w-10 shrink-0 items-center justify-center rounded-sm"
									>
										<UserRound class="h-5 w-5" />
									</div>
									<div class="min-w-0 flex-1">
										<h3 class="text-foreground text-lg font-semibold">
											Talent sharing & exceptions
										</h3>
										<p class="text-muted-fg mt-1 text-sm">
											Create one-off shares or override the organisation-wide default for a specific
											talent.
										</p>
									</div>
								</div>

								<form method="POST" action="?/upsertTalentShareRule" class="mt-6 space-y-4">
									<input
										type="hidden"
										name="source_context_id"
										value={selectedSourceOrganisationId}
									/>
									<input
										type="hidden"
										name="source_organisation_id"
										value={selectedSourceOrganisationId}
									/>
									<input type="hidden" name="existing_rule_id" value={talentRuleEditingId ?? ''} />
									<input
										type="hidden"
										name="allow_target_logo_export"
										value={talentRuleAllowTargetLogoExport ? 'true' : 'false'}
									/>

									<Dropdown
										name="target_organisation_id"
										label="Target organisation"
										bind:value={talentRuleTargetOrganisationId}
										options={selectableTargetOrganisationOptions}
										placeholder="Choose target organisation"
										search={selectableTargetOrganisationOptions.length > 6}
										searchPlaceholder="Search organisations"
										class="w-full"
									/>

									<Dropdown
										name="talent_id"
										label="Talent"
										bind:value={talentRuleTalentId}
										options={selectableTalentOptions}
										placeholder="Choose talent"
										search={selectableTalentOptions.length > 6}
										searchPlaceholder="Search talents"
										class="w-full"
									/>

									<OptionButton
										name="access_level"
										label="Access level"
										bind:value={talentRuleAccessLevel}
										options={talentRuleAccessOptions}
									/>

									<div class="border-border bg-background rounded-sm border p-4">
										<Checkbox bind:checked={talentRuleAllowTargetLogoExport}>
											Allow exports with the target organisation&apos;s branding
										</Checkbox>
										<p class="text-muted-fg mt-2 text-xs">
											If disabled, exports keep the talent owner organisation&apos;s branding
											instead.
										</p>
									</div>

									<div class="flex flex-wrap items-center gap-3">
										<Button type="submit">
											{talentRuleEditingId ? 'Save talent rule' : 'Add talent rule'}
										</Button>
										{#if talentRuleEditingId}
											<Button type="button" variant="outline" onclick={resetTalentRuleForm}>
												Cancel edit
											</Button>
										{/if}
									</div>
								</form>

								<div class="mt-6 space-y-4">
									{#each scopedTalentShareGroups as group (group.targetOrganisationId)}
										<div class="space-y-3">
											<div>
												<p class="text-foreground text-sm font-semibold">
													{group.targetOrganisationName}
												</p>
												<p class="text-muted-fg text-xs">
													Specific rules that apply when sharing from {selectedSourceOrganisationName}.
												</p>
											</div>

											<div class="space-y-3">
												{#each group.rules as rule (rule.id)}
													<div class="border-border bg-background rounded-sm border p-4">
														<div
															class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
														>
															<div class="space-y-1">
																<p class="text-foreground text-sm font-semibold">
																	{rule.talentLabel}
																</p>
																<p class="text-muted-fg text-sm">
																	{rule.shareKind} · {accessLabel(rule.access_level)}
																</p>
																<p class="text-muted-fg text-xs">
																	{brandingLabel(rule.allow_target_logo_export)}
																</p>
															</div>

															<div class="flex flex-wrap gap-2">
																<Button
																	type="button"
																	variant="outline"
																	size="sm"
																	onclick={() => beginTalentRuleEdit(rule)}
																>
																	Edit
																</Button>
																<form method="POST" action="?/deleteTalentShareRule">
																	<input
																		type="hidden"
																		name="source_context_id"
																		value={selectedSourceOrganisationId}
																	/>
																	<input type="hidden" name="rule_id" value={rule.id} />
																	<Button type="submit" variant="ghost" size="sm">Remove</Button>
																</form>
															</div>
														</div>
													</div>
												{/each}
											</div>
										</div>
									{:else}
										<p class="text-muted-fg text-sm">
											No talent-specific shares or exceptions exist for {selectedSourceOrganisationName}.
										</p>
									{/each}
								</div>
							</div>
						</section>
					{/if}
				</div>
			{/if}
		</section>
	{/if}
</div>
