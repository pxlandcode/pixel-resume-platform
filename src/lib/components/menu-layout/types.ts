import type { Icon as IconType } from 'lucide-svelte';

export type AdminRole = 'admin' | 'organisation_admin' | 'broker' | 'talent' | 'employer';

export type MenuProfile = {
	first_name: string | null;
	last_name: string | null;
	avatar_url?: string | null;
};

export type MenuNavItem = {
	label: string;
	href: string;
	allowed: AdminRole[];
	match: 'exact' | 'prefix';
	icon: typeof IconType;
};

export type MenuNavSection = {
	id: string;
	label: string;
	items: MenuNavItem[];
};

export type QuickSearchStatus = 'idle' | 'loading' | 'ready' | 'error';
