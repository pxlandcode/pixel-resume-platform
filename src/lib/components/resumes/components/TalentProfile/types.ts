import type { TechCategory as ResumeTechCategory } from '$lib/types/resume';

export type TalentProfileProfile = {
	id: string;
	first_name: string | null;
	last_name: string | null;
	title?: string | null;
	bio?: string | null;
	avatar_url?: string | null;
};

export type TalentProfileAvailability = {
	nowPercent?: number | null;
	futurePercent?: number | null;
	noticePeriodDays?: number | null;
	switchFromDate?: string | null;
	plannedFromDate?: string | null;
	hasData?: boolean;
} | null;

export type TalentProfileResume = {
	id: string;
	talent_id: string;
	version_name: string | null;
	is_main: boolean;
	is_active: boolean;
	allow_word_export: boolean;
	preview_html: string | null;
	created_at: string | null;
	updated_at: string | null;
};

export type TalentTechCategory = ResumeTechCategory;

export type TalentProfileMessage = {
	type: 'success' | 'error';
	message: string;
};

export type TalentProfileAvailabilityStatus = 'available-now' | 'on-assignment';

export type TalentProfileDatepickerOptions = {
	dateFormat: string;
	clearButton: boolean;
};
