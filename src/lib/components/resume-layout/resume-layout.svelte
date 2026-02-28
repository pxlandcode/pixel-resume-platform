<script module lang="ts">
	export type AdminRole = 'admin' | 'broker' | 'talent' | 'employer';
</script>

<script lang="ts">
	import { Badge, Button, Mode } from '@pixelcode_/blocks/components';
	import { mode } from 'mode-watcher';
	import { page } from '$app/stores';
	import type { Snippet } from 'svelte';
	import pixelcodeLogoDark from '$lib/assets/pixelcodelogodark.svg';
	import pixelcodeLogoLight from '$lib/assets/pixelcodelogolight.svg';

	interface Profile {
		first_name: string | null;
		last_name: string | null;
	}

	type Props = {
		profile?: Profile | null;
		role?: AdminRole | null;
		roles?: AdminRole[];
		userEmail?: string | null;
		unauthorizedMessage?: string | null;
		children: Snippet;
		onlogout?: () => void;
	};

	let {
		profile = null,
		role = null,
		roles = [],
		userEmail = null,
		unauthorizedMessage = null,
		children,
		onlogout
	}: Props = $props();

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
			allowed: ['admin', 'broker', 'talent', 'employer'],
			match: 'exact'
		},
		{
			label: 'Users',
			href: '/users',
			allowed: ['admin', 'broker', 'employer'],
			match: 'prefix'
		},
		{
			label: 'Organisations',
			href: '/organisations',
			allowed: ['admin'],
			match: 'prefix'
		},
		{
			label: 'Talents',
			href: '/talents',
			allowed: ['admin', 'broker', 'employer', 'talent'],
			match: 'prefix'
		},
		{
			label: 'Resumes',
			href: '/resumes',
			allowed: ['admin', 'broker', 'talent', 'employer'],
			match: 'prefix'
		}
	];

	const activePath = $derived($page.url.pathname);
	const displayName = $derived(
		profile
			? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || userEmail || 'User'
			: userEmail || 'User'
	);

	// Use light logo when dark mode is active (for contrast)
	const pixelcodeLogo = $derived(mode.current === 'dark' ? pixelcodeLogoLight : pixelcodeLogoDark);

	const canView = (allowed: AdminRole[]) => {
		const effectiveRoles = roles.length ? roles : role ? [role] : [];
		return effectiveRoles.some((r) => allowed.includes(r));
	};

	const isActive = (item: NavItem, currentPath: string) => {
		if (item.match === 'exact') return currentPath === item.href;
		return currentPath === item.href || currentPath.startsWith(`${item.href}/`);
	};
</script>

<div class="bg-background text-foreground flex min-h-screen">
	<!-- Sidebar -->
	<aside class="border-border bg-card hidden w-64 flex-shrink-0 flex-col border-r md:flex">
		<!-- Logo / Brand -->
		<div class="border-border border-b px-6 py-5">
			<h1 class="text-foreground text-xl font-bold tracking-tight">
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
							: 'text-muted-fg hover:bg-muted/60 hover:text-foreground'}"
					>
						{item.label}
					</a>
				{/if}
			{/each}
		</nav>

		<!-- Powered by -->
		<div class="border-border border-t px-6 py-4">
			<p class="text-muted-fg mb-2 text-xs font-medium uppercase tracking-wider">Powered by</p>
			<a
				href="https://pixelcode.se"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-block transition-opacity hover:opacity-100"
			>
				<img src={pixelcodeLogo} alt="Pixel&Code" class="h-5" />
			</a>
		</div>
	</aside>

	<!-- Main content -->
	<div class="flex flex-1 flex-col">
		<!-- Header -->
		<header class="border-border bg-card flex items-center justify-between border-b px-6 py-4">
			<div>
				<h2 class="text-foreground text-lg font-semibold">Build & manage resumes</h2>
				<p class="text-muted-fg text-sm">Create professional talent profiles</p>
			</div>

			<div class="flex items-center gap-4">
				<div class="text-right">
					<p class="text-foreground text-sm font-medium">{displayName}</p>
					{#if (roles?.length ?? 0) > 0}
						<div class="mt-1 flex flex-wrap justify-end gap-1">
							{#each roles as r}
								<Badge variant="info" size="xs" class="uppercase tracking-wide">
									{r.replace('_', ' ')}
								</Badge>
							{/each}
						</div>
					{:else if role}
						<Badge variant="info" size="xs" class="uppercase tracking-wide">
							{role.replace('_', ' ')}
						</Badge>
					{/if}
				</div>
				<Mode.Switch
					class="border-border bg-input text-foreground hover:bg-muted/70 focus:ring-primary/40 h-9 w-9 rounded-full border shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-1"
				/>
				<form method="POST" action="/logout">
					<Button type="submit" variant="outline" size="sm" onclick={() => onlogout?.()}>
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
			{@render children()}
		</main>
	</div>
</div>
