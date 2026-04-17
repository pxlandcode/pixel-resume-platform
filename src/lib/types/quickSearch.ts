export type QuickSearchResultKind = 'profile' | 'resume';

export type QuickSearchResultAvailability = {
	nowPercent: number | null;
	futurePercent: number | null;
	noticePeriodDays: number | null;
	switchFromDate: string | null;
	plannedFromDate: string | null;
	hasData: boolean;
};

export type QuickSearchResult = {
	id: string;
	kind: QuickSearchResultKind;
	href: string;
	title: string;
	description: string | null;
	matchedTechs: string[];
	availability?: QuickSearchResultAvailability | null;
};

export type QuickSearchSection = {
	id: 'profiles' | 'resumes';
	label: string;
	results: QuickSearchResult[];
};

export type QuickSearchResponse = {
	query: string;
	sections: QuickSearchSection[];
	total: number;
	generatedAt: string;
};
