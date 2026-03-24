export type QuickSearchResultKind = 'profile' | 'resume';

export type QuickSearchResult = {
	id: string;
	kind: QuickSearchResultKind;
	href: string;
	title: string;
	description: string | null;
	matchedTechs: string[];
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
