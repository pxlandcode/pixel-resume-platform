import { BriefcaseBusiness, Building2, Shield, User } from 'lucide-svelte';
import type { ComponentType, SvelteComponent } from 'svelte';

export type AppRole = 'admin' | 'organisation_admin' | 'broker' | 'talent' | 'employer';

export const ROLE_CONFIG: Record<
	AppRole,
	{
		label: string;
		icon: ComponentType<SvelteComponent>;
		description: string;
	}
> = {
	admin: {
		label: 'Admin',
		icon: Shield,
		description: 'Full access to internal tools.'
	},
	organisation_admin: {
		label: 'Organisation admin',
		icon: Shield,
		description: 'Manage users, settings, and billing for your organisation.'
	},
	broker: {
		label: 'Broker',
		icon: BriefcaseBusiness,
		description: 'Manage content, resumes, and talent flows.'
	},
	talent: {
		label: 'Talent',
		icon: User,
		description: 'Can access talent-facing flows when a talent record is linked.'
	},
	employer: {
		label: 'Employer',
		icon: Building2,
		description: 'Client-side access to assigned resumes.'
	}
};

export const getRoleLabel = (role: string): string => ROLE_CONFIG[role as AppRole]?.label ?? role;

export const getRoleIcon = (role: string): ComponentType<SvelteComponent> =>
	ROLE_CONFIG[role as AppRole]?.icon ?? User;

export const getRoleDescription = (role: string): string =>
	ROLE_CONFIG[role as AppRole]?.description ?? '';
