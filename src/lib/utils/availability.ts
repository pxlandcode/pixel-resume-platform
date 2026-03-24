type AvailabilityDateLike = {
	switchFromDate?: string | null;
	plannedFromDate?: string | null;
} | null | undefined;

export const getEarliestAvailabilityDate = (availability: AvailabilityDateLike): string | null => {
	const switchDate =
		typeof availability?.switchFromDate === 'string' ? availability.switchFromDate : null;
	const plannedDate =
		typeof availability?.plannedFromDate === 'string' ? availability.plannedFromDate : null;

	if (switchDate && plannedDate) return switchDate < plannedDate ? switchDate : plannedDate;
	return switchDate ?? plannedDate;
};
