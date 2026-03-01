<script lang="ts">
	import { Circle, Clock, Calendar } from 'lucide-svelte';

	type AvailabilityLike = {
		nowPercent?: number | null;
		futurePercent?: number | null;
		noticePeriodDays?: number | null;
		switchFromDate?: string | null;
		plannedFromDate?: string | null;
		hasData?: boolean;
	} | null;

	let { availability = null, compact = false } = $props<{
		availability?: AvailabilityLike;
		compact?: boolean;
	}>();

	const formatDate = (value: string | null | undefined) => {
		if (!value) return '';
		const parsed = new Date(`${value}T00:00:00`);
		if (Number.isNaN(parsed.getTime())) return value;

		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric'
		}).format(parsed);
	};

	const hasData = $derived(
		availability?.hasData === true ||
			availability?.nowPercent != null ||
			availability?.futurePercent != null ||
			availability?.noticePeriodDays != null ||
			availability?.switchFromDate != null ||
			availability?.plannedFromDate != null
	);

	// Determine primary status
	type Status = 'available' | 'partial' | 'busy' | 'ending-soon';

	const status = $derived.by((): Status => {
		const now = availability?.nowPercent;
		if (now === 100) return 'available';
		if (now != null && now > 0) return 'partial';
		if (availability?.plannedFromDate || availability?.noticePeriodDays != null)
			return 'ending-soon';
		return 'busy';
	});

	const statusLabel = $derived.by(() => {
		if (status === 'available') return 'Available';
		if (status === 'partial') return `${availability?.nowPercent}% available`;
		if (status === 'ending-soon') return 'On assignment';
		return 'On assignment';
	});

	const statusColor = $derived.by(() => {
		if (status === 'available') return 'emerald';
		if (status === 'partial') return 'amber';
		if (status === 'ending-soon') return 'sky';
		return 'slate';
	});

	// Secondary info (when available)
	const secondaryInfo = $derived.by(() => {
		if (status === 'available') return null;

		const hasEndDate = Boolean(availability?.plannedFromDate);
		const hasNotice = availability?.noticePeriodDays != null;

		if (hasEndDate && hasNotice) {
			// Both: "Free Mar 15 or 30d notice"
			return `Free ${formatDate(availability?.plannedFromDate)} or ${availability?.noticePeriodDays}d notice`;
		}
		if (hasEndDate) {
			// Only end date
			return `Free ${formatDate(availability?.plannedFromDate)}`;
		}
		if (hasNotice) {
			// Only notice period
			return `${availability?.noticePeriodDays}d notice`;
		}
		return null;
	});
</script>

{#if compact}
	<!-- Compact: single badge for cards -->
	<div class="flex flex-col gap-1">
		<span
			class="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium
				{statusColor === 'emerald'
				? 'bg-emerald-100 text-emerald-700'
				: statusColor === 'amber'
					? 'bg-amber-100 text-amber-700'
					: statusColor === 'sky'
						? 'bg-sky-100 text-sky-700'
						: 'bg-muted text-secondary-text'}"
		>
			<Circle
				size={6}
				class="fill-current {statusColor === 'emerald'
					? 'text-emerald-500'
					: statusColor === 'amber'
						? 'text-amber-500'
						: statusColor === 'sky'
							? 'text-sky-500'
							: 'text-secondary-text'}"
			/>
			{statusLabel}
		</span>
		{#if secondaryInfo}
			<span class="text-secondary-text text-[11px]">{secondaryInfo}</span>
		{/if}
	</div>
{:else}
	<!-- Full: for profile pages -->
	<div class="flex flex-col gap-1.5">
		<span
			class="inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium
				{statusColor === 'emerald'
				? 'bg-emerald-100 text-emerald-700'
				: statusColor === 'amber'
					? 'bg-amber-100 text-amber-700'
					: statusColor === 'sky'
						? 'bg-sky-100 text-sky-700'
						: 'bg-muted text-secondary-text'}"
		>
			<Circle
				size={8}
				class="fill-current {statusColor === 'emerald'
					? 'text-emerald-500'
					: statusColor === 'amber'
						? 'text-amber-500'
						: statusColor === 'sky'
							? 'text-sky-500'
							: 'text-secondary-text'}"
			/>
			{statusLabel}
		</span>
		{#if secondaryInfo}
			<span class="text-secondary-text flex items-center gap-1.5 text-sm">
				{#if availability?.plannedFromDate}
					<Calendar size={14} class="text-secondary-text" />
				{:else}
					<Clock size={14} class="text-secondary-text" />
				{/if}
				{secondaryInfo}
			</span>
		{/if}
		{#if !hasData}
			<span class="text-secondary-text text-sm">No availability set</span>
		{/if}
	</div>
{/if}
