<script lang="ts">
	import TalentProfileAvailabilityEditor from './TalentProfileAvailabilityEditor.svelte';
	import type {
		TalentProfileAvailabilityStatus,
		TalentProfileDatepickerOptions,
		TalentProfileProfile
	} from './types';

	let {
		profile,
		organisationName = null,
		organisationLogoUrl = null,
		isEditing = false,
		canEdit = false,
		editingBio = $bindable(''),
		editingAvatarUrl = '',
		techStackJson = '[]',
		submittedAvailabilityNowPercent = '',
		submittedAvailabilityFuturePercent = '',
		submittedAvailabilityNoticePeriodDays = '',
		submittedAvailabilityPlannedFromDate = '',
		profileActionMessage = null,
		profileActionFailed = false,
		availabilityStatus = $bindable('on-assignment'),
		editingHasAssignment = false,
		editingUseCustomAvailabilityPercentages = $bindable(false),
		editingOpenToSwitchEarly = $bindable(false),
		editingAvailabilityNowPercent = $bindable(''),
		editingAvailabilityFuturePercent = $bindable(''),
		editingAvailabilityNoticePeriodDays = $bindable(''),
		editingAvailabilityPlannedFromDate = $bindable(''),
		hasFutureAvailabilityTiming = false,
		availabilityDatepickerOptions
	}: {
		profile: TalentProfileProfile;
		organisationName?: string | null;
		organisationLogoUrl?: string | null;
		isEditing?: boolean;
		canEdit?: boolean;
		editingBio?: string;
		editingAvatarUrl?: string;
		techStackJson?: string;
		submittedAvailabilityNowPercent?: string;
		submittedAvailabilityFuturePercent?: string;
		submittedAvailabilityNoticePeriodDays?: string;
		submittedAvailabilityPlannedFromDate?: string;
		profileActionMessage?: string | null;
		profileActionFailed?: boolean;
		availabilityStatus?: TalentProfileAvailabilityStatus;
		editingHasAssignment?: boolean;
		editingUseCustomAvailabilityPercentages?: boolean;
		editingOpenToSwitchEarly?: boolean;
		editingAvailabilityNowPercent?: string;
		editingAvailabilityFuturePercent?: string;
		editingAvailabilityNoticePeriodDays?: string;
		editingAvailabilityPlannedFromDate?: string;
		hasFutureAvailabilityTiming?: boolean;
		availabilityDatepickerOptions: TalentProfileDatepickerOptions;
	} = $props();

	const profileName = $derived(
		[profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Unnamed'
	);
</script>

<form
	id="profile-form"
	method="POST"
	action="?/updateProfile"
	class="space-y-4"
	onsubmit={() => {
		// keep editing values
	}}
>
	<input type="hidden" name="talent_id" value={profile.id} />
	<input type="hidden" name="tech_stack" value={techStackJson} />
	<input type="hidden" name="avatar_url" value={editingAvatarUrl} />
	<input type="hidden" name="availability_now_percent" value={submittedAvailabilityNowPercent} />
	<input
		type="hidden"
		name="availability_future_percent"
		value={submittedAvailabilityFuturePercent}
	/>
	<input
		type="hidden"
		name="availability_notice_period_days"
		value={submittedAvailabilityNoticePeriodDays}
	/>
	<input
		type="hidden"
		name="availability_planned_from_date"
		value={submittedAvailabilityPlannedFromDate}
	/>

	{#if profileActionMessage}
		<div
			class="rounded border px-3 py-2 text-sm
				{!profileActionFailed
				? 'border-emerald-200 bg-emerald-50 text-emerald-700'
				: 'border-red-200 bg-red-50 text-red-700'}"
		>
			{profileActionMessage}
		</div>
	{/if}

	<div>
		<h1 class="text-foreground text-3xl font-bold sm:text-4xl">{profileName}</h1>
		{#if profile.title}
			<p class="text-primary mt-1 text-xl font-medium">{profile.title}</p>
		{/if}
		{#if organisationLogoUrl || organisationName}
			<div class="mt-3">
				{#if organisationLogoUrl}
					<img
						src={organisationLogoUrl}
						alt={organisationName ?? 'Organisation'}
						class="h-5 w-auto object-contain"
					/>
				{:else}
					<span class="text-muted-fg text-xs font-medium">{organisationName}</span>
				{/if}
			</div>
		{/if}
	</div>

	<div>
		{#if isEditing && canEdit}
			<textarea
				name="bio"
				bind:value={editingBio}
				class="border-border text-foreground w-full rounded border p-3 text-sm"
				rows="4"
				placeholder="Tell us about this talent"
			></textarea>
		{:else if profile.bio}
			<p class="text-muted-fg max-w-2xl whitespace-pre-wrap text-sm leading-6">{profile.bio}</p>
		{:else}
			<p class="text-muted-fg text-sm">No bio yet.</p>
		{/if}
	</div>

	<div class="pt-2">
		{#if isEditing && canEdit}
			<TalentProfileAvailabilityEditor
				bind:availabilityStatus
				{editingHasAssignment}
				bind:editingUseCustomAvailabilityPercentages
				bind:editingOpenToSwitchEarly
				bind:editingAvailabilityNowPercent
				bind:editingAvailabilityFuturePercent
				bind:editingAvailabilityNoticePeriodDays
				bind:editingAvailabilityPlannedFromDate
				{hasFutureAvailabilityTiming}
				{availabilityDatepickerOptions}
			/>
		{/if}
	</div>
</form>
