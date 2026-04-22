type AvailabilityDateLike =
	| {
			switchFromDate?: string | null;
			plannedFromDate?: string | null;
	  }
	| null
	| undefined;

type AvailabilitySortLike =
	| {
			nowPercent?: number | null;
			futurePercent?: number | null;
			noticePeriodDays?: number | null;
			switchFromDate?: string | null;
			plannedFromDate?: string | null;
			hasData?: boolean;
	  }
	| null
	| undefined;

export const getEarliestAvailabilityDate = (availability: AvailabilityDateLike): string | null => {
	const switchDate =
		typeof availability?.switchFromDate === 'string' ? availability.switchFromDate : null;
	const plannedDate =
		typeof availability?.plannedFromDate === 'string' ? availability.plannedFromDate : null;

	if (switchDate && plannedDate) return switchDate < plannedDate ? switchDate : plannedDate;
	return switchDate ?? plannedDate;
};

const padSortNumber = (value: number) => String(Math.max(0, value)).padStart(3, '0');

export const getAvailabilitySortKey = (availability: AvailabilitySortLike): string => {
	const nowPercent = typeof availability?.nowPercent === 'number' ? availability.nowPercent : null;
	const futurePercent =
		typeof availability?.futurePercent === 'number' ? availability.futurePercent : null;
	const earliestDate = getEarliestAvailabilityDate(availability);
	const hasData =
		availability?.hasData === true ||
		nowPercent !== null ||
		futurePercent !== null ||
		availability?.noticePeriodDays != null ||
		earliestDate !== null;

	// Keep lexical sorting aligned with best-to-worst availability on first click.
	if (nowPercent !== null && nowPercent > 0) {
		return `0:${padSortNumber(100 - nowPercent)}:${earliestDate ?? '9999-12-31'}:${padSortNumber(100 - (futurePercent ?? 0))}`;
	}

	if (earliestDate) {
		return `1:${earliestDate}:${padSortNumber(100 - (futurePercent ?? 100))}`;
	}

	if (futurePercent !== null && futurePercent > 0) {
		return `2:${padSortNumber(100 - futurePercent)}`;
	}

	if (hasData) {
		return '3:9999-12-31:999';
	}

	return '4:9999-12-31:999';
};
