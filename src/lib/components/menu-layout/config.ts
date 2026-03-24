import { Briefcase, Building2, FileText, House, Settings, Users } from 'lucide-svelte';
import type { MenuNavItem, MenuNavSection } from './types';

export const menuNavSections: MenuNavSection[] = [
	{
		id: 'workspace',
		label: 'Workspace',
		items: [
			{
				label: 'Dashboard',
				href: '/',
				allowed: ['admin', 'broker', 'talent', 'employer'],
				match: 'exact',
				icon: House
			}
		]
	},
	{
		id: 'talent',
		label: 'Talent',
		items: [
			{
				label: 'Talents',
				href: '/talents',
				allowed: ['admin', 'broker', 'employer', 'talent'],
				match: 'prefix',
				icon: Briefcase
			},
			{
				label: 'Resumes',
				href: '/resumes',
				allowed: ['admin', 'broker', 'talent', 'employer'],
				match: 'prefix',
				icon: FileText
			}
		]
	},
	{
		id: 'admin',
		label: 'Administration',
		items: [
			{
				label: 'Users',
				href: '/users',
				allowed: ['admin', 'broker', 'employer'],
				match: 'prefix',
				icon: Users
			},
			{
				label: 'Organisations',
				href: '/organisations',
				allowed: ['admin'],
				match: 'prefix',
				icon: Building2
			}
		]
	}
];

export const menuSettingsItem: MenuNavItem = {
	label: 'Settings',
	href: '/settings',
	allowed: ['admin'],
	match: 'prefix',
	icon: Settings
};
