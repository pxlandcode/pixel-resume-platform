import type { TalentLabelDefinition } from '$lib/types/talentLabels';

export type ResumesAvailabilitySummary = {
	nowPercent: number | null;
	futurePercent: number | null;
	noticePeriodDays: number | null;
	switchFromDate: string | null;
	plannedFromDate: string | null;
	hasData: boolean;
};

export type ResumesTalentListItem = {
	id: string;
	first_name: string;
	last_name: string;
	avatar_url: string | null;
	availability: ResumesAvailabilitySummary;
	organisation_id: string | null;
	organisation_name: string | null;
	organisation_logo_url: string | null;
	labels: TalentLabelDefinition[];
};

export type ResumeTechIndexItem = {
	talentId: string;
	searchTechs: string[];
	techYearsByKey: Record<string, number>;
};

export type ResumeTechIndexScope = {
	orgIds: string[];
	signature: string;
};

export type ResumeTechIndexResponse = {
	scope: ResumeTechIndexScope;
	items: ResumeTechIndexItem[];
	generatedAt: string;
};

export type ResumeSearchReason = {
	label: string;
	text: string;
	resumeId: string | null;
	resumeTitle: string | null;
};

export type ResumeSearchFilterKind = 'technology' | 'role' | 'concept';

export type ResumeSearchFilterTerm = {
	label: string;
	key: string;
	kind: ResumeSearchFilterKind;
};

export type ResumeSearchItem = {
	talentId: string;
	score: number;
	matchPercent: number;
	matchedTerms: string[];
	missingTerms: string[];
	matchedQueryTechs: string[];
	missingQueryTechs: string[];
	matchedTechs: string[];
	reasons: ResumeSearchReason[];
	bestResumeId: string | null;
	bestResumeTitle: string | null;
};

export type ResumeSearchScope = {
	orgIds: string[];
	signature: string;
};

export type ResumeSearchResponse = {
	query: string;
	scope: ResumeSearchScope;
	aiApplied: boolean;
	analyzedTerms: ResumeSearchFilterTerm[];
	appliedTerms: ResumeSearchFilterTerm[];
	items: ResumeSearchItem[];
	generatedAt: string;
};
