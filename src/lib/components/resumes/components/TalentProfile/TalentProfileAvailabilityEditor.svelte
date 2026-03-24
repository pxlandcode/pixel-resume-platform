<script lang="ts">
	import { Checkbox, Datepicker, Input, Radio } from '@pixelcode_/blocks/components';
	import type { TalentProfileAvailabilityStatus, TalentProfileDatepickerOptions } from './types';

	let {
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

	const activateStatus = (status: TalentProfileAvailabilityStatus) => {
		availabilityStatus = status;
	};
</script>

<h3 class="text-foreground mb-2 text-lg font-semibold">Availability</h3>
<div class="space-y-4">
	<div class="border-border bg-card rounded-lg border p-5">
		<p class="text-foreground mb-3 text-sm font-medium">Current status</p>
		<div class="flex flex-col gap-2" role="radiogroup" aria-label="Current status">
			<div
				class="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md p-2"
				role="radio"
				tabindex="0"
				aria-checked={availabilityStatus === 'available-now'}
				onclick={() => activateStatus('available-now')}
				onkeydown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						activateStatus('available-now');
					}
				}}
			>
				<Radio name="availability-status" value="available-now" bind:group={availabilityStatus} />
				<div>
					<span class="text-foreground text-sm font-medium">Available now</span>
					<span class="text-muted-fg ml-2 text-xs">100% available immediately</span>
				</div>
			</div>
			<div
				class="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md p-2"
				role="radio"
				tabindex="0"
				aria-checked={availabilityStatus === 'on-assignment'}
				onclick={() => activateStatus('on-assignment')}
				onkeydown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						activateStatus('on-assignment');
					}
				}}
			>
				<Radio name="availability-status" value="on-assignment" bind:group={availabilityStatus} />
				<div>
					<span class="text-foreground text-sm font-medium">On assignment</span>
					<span class="text-muted-fg ml-2 text-xs">Currently busy</span>
				</div>
			</div>
		</div>
	</div>

	{#if editingHasAssignment}
		<div class="border-border bg-card rounded-lg border p-5">
			<p class="text-foreground mb-4 text-sm font-medium">Assignment details</p>
			<div class="space-y-4">
				<div>
					<label
						for="availability-planned-date"
						class="text-muted-fg mb-1.5 block text-sm font-medium"
					>
						Assignment end date
					</label>
					<Datepicker
						id="availability-planned-date"
						bind:value={editingAvailabilityPlannedFromDate}
						options={availabilityDatepickerOptions}
						class="bg-card text-foreground w-full max-w-xs !pl-11"
						placeholder="YYYY-MM-DD"
					/>
					<p class="text-muted-fg mt-1 text-xs">When will the current assignment end?</p>
				</div>

				<div class="border-border/70 border-t pt-4">
					<Checkbox bind:checked={editingOpenToSwitchEarly}>
						<span class="text-foreground text-sm font-medium">Open to switching early</span>
					</Checkbox>

					{#if editingOpenToSwitchEarly}
						<div class="ml-7 mt-3">
							<label
								for="availability-notice-period-days"
								class="text-muted-fg mb-1.5 block text-sm font-medium"
							>
								Notice period (days)
							</label>
							<Input
								id="availability-notice-period-days"
								type="text"
								inputmode="numeric"
								bind:value={editingAvailabilityNoticePeriodDays}
								class="bg-card text-foreground w-full max-w-[120px] text-sm"
								placeholder="e.g. 30"
							/>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	{#if !editingUseCustomAvailabilityPercentages}
		<button
			type="button"
			class="text-muted-fg hover:text-foreground text-sm font-medium"
			onclick={() => (editingUseCustomAvailabilityPercentages = true)}
		>
			+ Advanced options
		</button>
	{:else}
		<div class="border-border bg-muted rounded-lg border p-5">
			<div class="mb-4 flex items-center justify-between">
				<p class="text-foreground text-sm font-medium">Custom availability percentages</p>
				<button
					type="button"
					class="text-muted-fg hover:text-foreground text-xs font-medium"
					onclick={() => {
						editingUseCustomAvailabilityPercentages = false;
						editingAvailabilityNowPercent = '';
						editingAvailabilityFuturePercent = '';
					}}
				>
					Reset to defaults
				</button>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label
						for="availability-now-percent"
						class="text-muted-fg mb-1.5 block text-sm font-medium"
					>
						Available now
					</label>
					<div class="relative max-w-[120px]">
						<Input
							id="availability-now-percent"
							type="text"
							inputmode="numeric"
							bind:value={editingAvailabilityNowPercent}
							class="bg-card text-foreground w-full py-2 pr-8 text-sm"
							placeholder={editingHasAssignment ? '0' : '100'}
						/>
						<span
							class="text-muted-fg pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm"
							>%</span
						>
					</div>
				</div>
				{#if editingHasAssignment && hasFutureAvailabilityTiming}
					<div>
						<label
							for="availability-future-percent"
							class="text-muted-fg mb-1.5 block text-sm font-medium"
						>
							Future availability
						</label>
						<div class="relative max-w-[120px]">
							<Input
								id="availability-future-percent"
								type="text"
								inputmode="numeric"
								bind:value={editingAvailabilityFuturePercent}
								class="bg-card text-foreground w-full py-2 pr-8 text-sm"
								placeholder="100"
							/>
							<span
								class="text-muted-fg pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm"
								>%</span
							>
						</div>
					</div>
				{/if}
			</div>
			<p class="text-muted-fg mt-3 text-xs">
				Override default percentages for part-time or partial availability.
			</p>
		</div>
	{/if}
</div>
