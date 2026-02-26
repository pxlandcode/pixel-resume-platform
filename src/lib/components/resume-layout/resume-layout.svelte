<script module lang="ts">
	export type AdminRole = 'admin' | 'cms_admin' | 'employee' | 'employer';
</script>

<script lang="ts">
	import { Badge, Button, Mode } from '@pixelcode_/blocks/components';
	import { createEventDispatcher } from 'svelte';
	import { page } from '$app/stores';
	import pixelcodeLogo from '$lib/assets/pixelcodelogodark.svg';

	const dispatch = createEventDispatcher<{ logout: void }>();

	interface Profile {
		first_name: string | null;
		last_name: string | null;
	}

	export let profile: Profile | null = null;
	export let role: AdminRole | null = null;
	export let roles: AdminRole[] = [];
	export let userEmail: string | null = null;
	export let unauthorizedMessage: string | null = null;

	type NavItem = {
		label: string;
		href: string;
		allowed: AdminRole[];
		match: 'exact' | 'prefix';
	};

	const navItems: NavItem[] = [
		{
			label: 'Dashboard',
			href: '/',
			allowed: ['admin', 'cms_admin', 'employee', 'employer'],
			match: 'exact'
		},
		{
			label: 'Users',
			href: '/users',
			allowed: ['admin', 'employer'],
			match: 'prefix'
		},
		{
			label: 'Employees',
			href: '/employees',
			allowed: ['admin', 'employer', 'employee'],
			match: 'prefix'
		},
		{
			label: 'Resumes',
			href: '/resumes',
			allowed: ['admin', 'cms_admin', 'employee'],
			match: 'prefix'
		}
	];

	$: activePath = $page.url.pathname;
	$: displayName = profile
		? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || userEmail || 'User'
		: userEmail || 'User';

	const canView = (allowed: AdminRole[]) => {
		const effectiveRoles = roles.length ? roles : role ? [role] : [];
		return effectiveRoles.some((r) => allowed.includes(r));
	};

	const isActive = (item: NavItem, currentPath: string) => {
		if (item.match === 'exact') return currentPath === item.href;
		return currentPath === item.href || currentPath.startsWith(`${item.href}/`);
	};
</script>

<div class="flex min-h-screen bg-slate-50">
	<!-- Sidebar -->
	<aside class="hidden w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
		<!-- Logo / Brand -->
		<div class="border-b border-slate-100 px-6 py-5">
			<h1 class="text-xl font-bold tracking-tight text-slate-900">
				<span class="text-primary">Resume</span>Builder
			</h1>
		</div>

		<!-- Navigation -->
		<nav class="flex-1 space-y-1 px-3 py-4">
			{#each navItems as item}
				{#if canView(item.allowed)}
					<a
						href={item.href}
						class="flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition-colors {isActive(
							item,
							activePath
						)
							? 'bg-primary/10 text-primary'
							: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}"
					>
						{item.label}
					</a>
				{/if}
			{/each}
		</nav>

		<!-- Powered by -->
		<div class="border-t border-slate-100 px-6 py-4">
			<p class="mb-2 text-xs font-medium tracking-wider text-slate-400 uppercase">Powered by</p>
			<a
				href="https://pixelcode.se"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-block transition-opacity hover:opacity-100"
			>
				<img src={pixelcodeLogo} alt="Pixel&Code" class="h-5 opacity-60" />
			</a>
		</div>
	</aside>

	<!-- Main content -->
	<div class="flex flex-1 flex-col">
		<!-- Header -->
		<header class="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
			<div>
				<h2 class="text-lg font-semibold text-slate-900">Build & manage resumes</h2>
				<p class="text-sm text-slate-500">Create professional consultant profiles</p>
			</div>

			<div class="flex items-center gap-4">
				<div class="text-right">
					<p class="text-sm font-medium text-slate-900">{displayName}</p>
					{#if (roles?.length ?? 0) > 0}
						<div class="mt-1 flex flex-wrap justify-end gap-1">
							{#each roles as r}
								<Badge variant="info" size="xs" class="tracking-wide uppercase">
									{r.replace('_', ' ')}
								</Badge>
							{/each}
						</div>
					{:else if role}
						<Badge variant="info" size="xs" class="tracking-wide uppercase">
							{role.replace('_', ' ')}
						</Badge>
					{/if}
				</div>
				<Mode.Switch
					class="h-9 w-9 rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 focus:ring-2 focus:ring-primary/40 focus:ring-offset-1 focus:outline-none"
				/>
				<form method="POST" action="/logout">
					<Button type="submit" variant="outline" size="sm" onclick={() => dispatch('logout')}>
						Log out
					</Button>
				</form>
			</div>
		</header>

		{#if unauthorizedMessage}
			<div class="border-b border-amber-100 bg-amber-50 px-6 py-3 text-sm text-amber-800">
				{unauthorizedMessage}
			</div>
		{/if}

		<!-- Page content -->
		<main class="flex-1 p-6">
			<slot />
		</main>
	</div>
</div>
