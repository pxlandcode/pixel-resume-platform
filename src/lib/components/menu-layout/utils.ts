import { Briefcase, FileText } from 'lucide-svelte';
import type { QuickSearchResult } from '$lib/types/quickSearch';
import type { MenuNavItem } from './types';

export const isMenuItemActive = (item: MenuNavItem, currentPath: string) => {
	if (item.match === 'exact') return currentPath === item.href;
	return currentPath === item.href || currentPath.startsWith(`${item.href}/`);
};

export const isSearchResultActive = (href: string, currentPath: string) =>
	currentPath === href || currentPath.startsWith(`${href}/`);

export const getQuickSearchResultLabel = (kind: QuickSearchResult['kind']) =>
	kind === 'resume' ? 'Resume' : 'Profile';

export const getQuickSearchResultIcon = (kind: QuickSearchResult['kind']) =>
	kind === 'resume' ? FileText : Briefcase;

export const getQuickSearchEmptyMessage = (query: string) =>
	`No talents, profiles, resumes, or tech stack matches for “${query}”.`;

export const getQuickSearchErrorMessage = (error: string | null) =>
	error || 'Could not load quick search results.';
