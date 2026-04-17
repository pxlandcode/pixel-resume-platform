import { getEarliestAvailabilityDate } from '$lib/utils/availability';

export type ConsultantAvailability = {
	nowPercent: number | null;
	futurePercent: number | null;
	noticePeriodDays: number | null;
	switchFromDate: string | null;
	plannedFromDate: string | null;
	hasData: boolean;
};

export type ConsultantAvailabilityDbFields = {
	availability_now_percent: number | null;
	availability_future_percent: number | null;
	availability_notice_period_days: number | null;
	availability_planned_from_date: string | null;
};

export type ConsultantAvailabilityFormInput = {
	nowPercent: string | null;
	futurePercent: string | null;
	noticePeriodDays: string | null;
	plannedFromDate: string | null;
};

export const PROFILE_AVAILABILITY_SELECT =
	'profile_id, availability_now_percent, availability_future_percent, availability_notice_period_days, availability_planned_from_date';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER_RE = /^\d+$/;

const emptyAvailability = (): ConsultantAvailability => ({
	nowPercent: null,
	futurePercent: null,
	noticePeriodDays: null,
	switchFromDate: null,
	plannedFromDate: null,
	hasData: false
});

const asTrimmedString = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const normalizeDateString = (value: unknown): string | null => {
	const raw = asTrimmedString(value);
	if (!raw) return null;
	if (ISO_DATE_RE.test(raw)) return raw;
	if (raw.length >= 10 && ISO_DATE_RE.test(raw.slice(0, 10))) return raw.slice(0, 10);
	return null;
};

const normalizePercentValue = (value: unknown): number | null => {
	if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100) {
		return value > 0 ? value : null;
	}

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;
		if (!INTEGER_RE.test(trimmed)) return null;
		const parsed = Number.parseInt(trimmed, 10);
		if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) return null;
		return parsed > 0 ? parsed : null;
	}

	return null;
};

const normalizeNoticePeriodDaysValue = (value: unknown): number | null => {
	if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
		return value;
	}

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;
		if (!INTEGER_RE.test(trimmed)) return null;
		const parsed = Number.parseInt(trimmed, 10);
		if (!Number.isInteger(parsed) || parsed < 0) return null;
		return parsed;
	}

	return null;
};

const toIsoUtcDate = (date: Date) => {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

const computeSwitchFromDate = (noticePeriodDays: number | null): string | null => {
	if (noticePeriodDays === null) return null;

	const now = new Date();
	const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	todayUtc.setUTCDate(todayUtc.getUTCDate() + noticePeriodDays);
	return toIsoUtcDate(todayUtc);
};

const getTodayIsoUtcDate = () => {
	const now = new Date();
	return toIsoUtcDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
};

const normalizeElapsedFutureAvailability = (
	availability: Omit<ConsultantAvailability, 'hasData'>
): Omit<ConsultantAvailability, 'hasData'> => {
	const effectiveDate = getEarliestAvailabilityDate(availability);
	if (!effectiveDate) return availability;
	if (effectiveDate > getTodayIsoUtcDate()) return availability;

	return {
		nowPercent: availability.futurePercent ?? availability.nowPercent ?? 100,
		futurePercent: null,
		noticePeriodDays: null,
		switchFromDate: null,
		plannedFromDate: null
	};
};

const computeHasData = (availability: Omit<ConsultantAvailability, 'hasData'>) =>
	availability.nowPercent !== null ||
	availability.futurePercent !== null ||
	availability.noticePeriodDays !== null ||
	availability.switchFromDate !== null ||
	availability.plannedFromDate !== null;

export const normalizeAvailabilityRow = (row: unknown): ConsultantAvailability => {
	if (!row || typeof row !== 'object') return emptyAvailability();

	const data = row as Partial<ConsultantAvailabilityDbFields>;

	const noticePeriodDays = normalizeNoticePeriodDaysValue(data.availability_notice_period_days);
	const switchFromDate = computeSwitchFromDate(noticePeriodDays);
	const plannedFromDate = normalizeDateString(data.availability_planned_from_date);
	const hasFutureDate = noticePeriodDays !== null || plannedFromDate !== null;
	const rawNowPercent = normalizePercentValue(data.availability_now_percent);
	const rawFuturePercent = normalizePercentValue(data.availability_future_percent);
	const normalizedNowPercent =
		hasFutureDate && rawNowPercent === 100 ? null : rawNowPercent;

	const availabilityBase = normalizeElapsedFutureAvailability({
		// A future assignment date takes precedence over contradictory "100% now" values.
		nowPercent: normalizedNowPercent,
		futurePercent: rawFuturePercent ?? (hasFutureDate ? 100 : null),
		noticePeriodDays,
		switchFromDate,
		plannedFromDate
	});

	return {
		...availabilityBase,
		hasData: computeHasData(availabilityBase)
	};
};

const getFormString = (formData: FormData, name: string): string | null => {
	const value = formData.get(name);
	return asTrimmedString(value);
};

export const parseAvailabilityForm = (formData: FormData): ConsultantAvailabilityFormInput => ({
	nowPercent: getFormString(formData, 'availability_now_percent'),
	futurePercent: getFormString(formData, 'availability_future_percent'),
	noticePeriodDays: getFormString(formData, 'availability_notice_period_days'),
	plannedFromDate: getFormString(formData, 'availability_planned_from_date')
});

const parsePercentInput = (
	label: string,
	value: string | null
): { ok: true; value: number | null } | { ok: false; message: string } => {
	if (value === null) return { ok: true, value: null };
	if (!INTEGER_RE.test(value)) {
		return { ok: false, message: `${label} must be a whole number between 0 and 100.` };
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
		return { ok: false, message: `${label} must be a whole number between 0 and 100.` };
	}

	return { ok: true, value: parsed > 0 ? parsed : null };
};

const parseDateInput = (
	label: string,
	value: string | null
): { ok: true; value: string | null } | { ok: false; message: string } => {
	if (value === null) return { ok: true, value: null };
	if (!ISO_DATE_RE.test(value)) {
		return { ok: false, message: `${label} must be a valid date.` };
	}

	return { ok: true, value };
};

const parseNoticePeriodDaysInput = (
	value: string | null
): { ok: true; value: number | null } | { ok: false; message: string } => {
	if (value === null) return { ok: true, value: null };
	if (!INTEGER_RE.test(value)) {
		return { ok: false, message: 'Uppsagningstid (days) must be a whole number of days.' };
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 0) {
		return { ok: false, message: 'Uppsagningstid (days) must be 0 or more.' };
	}

	return { ok: true, value: parsed };
};

export const validateAvailability = (
	input: ConsultantAvailabilityFormInput
):
	| { ok: true; availability: ConsultantAvailability; db: ConsultantAvailabilityDbFields }
	| { ok: false; message: string } => {
	const nowPercent = parsePercentInput('Available now (%)', input.nowPercent);
	if (!nowPercent.ok) return nowPercent;

	const futurePercent = parsePercentInput('Future availability (%)', input.futurePercent);
	if (!futurePercent.ok) return futurePercent;

	const noticePeriodDays = parseNoticePeriodDaysInput(input.noticePeriodDays);
	if (!noticePeriodDays.ok) return noticePeriodDays;

	const plannedFromDate = parseDateInput('Planned available from', input.plannedFromDate);
	if (!plannedFromDate.ok) return plannedFromDate;

	const switchFromDate = computeSwitchFromDate(noticePeriodDays.value);

	if (
		switchFromDate &&
		plannedFromDate.value &&
		switchFromDate > plannedFromDate.value
	) {
		return {
			ok: false,
			message:
				'Uppsagningstid results in a switch date later than the planned available from date.'
		};
	}

	const hasFutureDate = noticePeriodDays.value !== null || plannedFromDate.value !== null;
	const normalizedNowPercent =
		hasFutureDate && nowPercent.value === 100 ? null : nowPercent.value;
	const normalizedFuturePercent = futurePercent.value ?? (hasFutureDate ? 100 : null);

	const availabilityBase = {
		nowPercent: normalizedNowPercent,
		futurePercent: normalizedFuturePercent,
		noticePeriodDays: noticePeriodDays.value,
		switchFromDate,
		plannedFromDate: plannedFromDate.value
	};

	const availability: ConsultantAvailability = {
		...availabilityBase,
		hasData: computeHasData(availabilityBase)
	};

	return {
		ok: true,
		availability,
		db: {
			availability_now_percent: availability.nowPercent,
			availability_future_percent: availability.futurePercent,
			availability_notice_period_days: availability.noticePeriodDays,
			availability_planned_from_date: availability.plannedFromDate
		}
	};
};
