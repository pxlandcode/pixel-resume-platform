import type {
	ResumeSearchItem,
	ResumeSearchReason,
	ResumesTalentListItem
} from '$lib/types/resumes';

export type AvailabilityMode = 'all' | 'now' | 'within-days';
export type TechStatus = 'met' | 'insufficient' | 'missing';

export type SelectedTechFilter = {
	label: string;
	key: string;
	requiredYears: number | null;
};

export type TechMatch = SelectedTechFilter & {
	actualYears: number;
	status: TechStatus;
};

export type TechMatchSummary = {
	metCount: number;
	insufficientCount: number;
	missingCount: number;
	total: number;
	techMatches: TechMatch[];
};

export type TalentWithScore = ResumesTalentListItem & TechMatchSummary;

export type TalentGroup = {
	metCount: number;
	insufficientCount: number;
	total: number;
	talents: TalentWithScore[];
};

export type FreeTextTalentResult = ResumesTalentListItem &
	TechMatchSummary & {
		search: ResumeSearchItem;
		sortScore: number;
	};

export const getTalentName = (talent: Pick<ResumesTalentListItem, 'first_name' | 'last_name'>) =>
	[talent.first_name, talent.last_name].filter(Boolean).join(' ') || 'Unnamed';

export const isPerfectMatch = (metCount: number, total: number, insufficientCount: number) =>
	metCount === total && insufficientCount === 0;

export const getMatchPillClass = (metCount: number, total: number, insufficientCount: number) => {
	if (isPerfectMatch(metCount, total, insufficientCount)) return 'bg-emerald-100 text-emerald-700';
	if (metCount + insufficientCount > 0) return 'bg-amber-100 text-amber-700';
	return 'bg-muted text-muted-fg';
};

export const getMatchBadgeClass = (metCount: number, total: number, insufficientCount: number) => {
	if (isPerfectMatch(metCount, total, insufficientCount)) return 'bg-emerald-500 text-white';
	if (metCount + insufficientCount > 0) return 'bg-amber-500 text-white';
	return 'bg-muted-fg text-white';
};

export const getTechStatusClass = (status: TechStatus) => {
	if (status === 'met') return 'bg-emerald-100 text-emerald-700';
	if (status === 'insufficient') return 'bg-amber-100 text-amber-700';
	return 'bg-red-100 text-red-700';
};

const roundUpOneDecimal = (value: number) => Math.ceil(value * 10) / 10;

export const formatYears = (value: number) => {
	const rounded = roundUpOneDecimal(value);
	const nearestInteger = Math.round(rounded);
	if (Math.abs(rounded - nearestInteger) < 0.000001) return `${nearestInteger}y`;
	return `${rounded.toFixed(1).replace(/\.0$/, '')}y`;
};

export const getSearchMatchBadgeClass = (matchPercent: number) => {
	if (matchPercent >= 80) return 'bg-emerald-500 text-white';
	if (matchPercent >= 55) return 'bg-amber-500 text-white';
	return 'bg-slate-500 text-white';
};

export const getSearchMatchPillClass = (matchPercent: number) => {
	if (matchPercent >= 80) return 'bg-emerald-100 text-emerald-700';
	if (matchPercent >= 55) return 'bg-amber-100 text-amber-700';
	return 'bg-slate-100 text-slate-700';
};

export const formatSearchReasonLabel = (reason: ResumeSearchReason) =>
	reason.resumeTitle ? `${reason.label} · ${reason.resumeTitle}` : reason.label;
