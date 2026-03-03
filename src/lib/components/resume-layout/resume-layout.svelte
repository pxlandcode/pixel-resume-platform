<script module lang="ts">
	export type AdminRole = 'admin' | 'broker' | 'talent' | 'employer';
</script>

<script lang="ts">
	import { browser } from '$app/environment';
	import { Badge, Button, Mode } from '@pixelcode_/blocks/components';
	import { Menu, X } from 'lucide-svelte';
	import { mode } from 'mode-watcher';
	import { page } from '$app/stores';
	import { onDestroy } from 'svelte';
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
			label: 'Settings',
			href: '/settings',
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

	const CURTAIN_BODY_CLASS = 'mobile-curtain-open';

	let isMobileMenuOpen = $state(false);
	let previousPath = '';

	const visibleNavItems = $derived(navItems.filter((item) => canView(item.allowed)));

	const closeMobileMenu = () => {
		isMobileMenuOpen = false;
	};

	const toggleMobileMenu = () => {
		isMobileMenuOpen = !isMobileMenuOpen;
	};

	const handleMenuKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && isMobileMenuOpen) {
			closeMobileMenu();
		}
	};

	const handleMenuNavClick = () => {
		closeMobileMenu();
	};

	$effect(() => {
		if (!browser) return;
		document.body.classList.toggle('overflow-hidden', isMobileMenuOpen);
		document.body.classList.toggle(CURTAIN_BODY_CLASS, isMobileMenuOpen);
	});

	$effect(() => {
		const currentPath = activePath;
		if (!previousPath) {
			previousPath = currentPath;
			return;
		}

		if (currentPath !== previousPath && isMobileMenuOpen) {
			closeMobileMenu();
		}
		previousPath = currentPath;
	});

	$effect(() => {
		if (!browser) return;

		const mediaQuery = window.matchMedia('(min-width: 768px)');
		const onMediaChange = (event: MediaQueryListEvent) => {
			if (event.matches) closeMobileMenu();
		};

		if (mediaQuery.matches) closeMobileMenu();
		mediaQuery.addEventListener('change', onMediaChange);

		return () => {
			mediaQuery.removeEventListener('change', onMediaChange);
		};
	});

	onDestroy(() => {
		if (browser) {
			document.body.classList.remove('overflow-hidden', CURTAIN_BODY_CLASS);
		}
	});
</script>

<svelte:window on:keydown={handleMenuKeydown} />

<div class="bg-background text-foreground flex min-h-screen">
	<!-- Sidebar -->
	<aside class="border-border bg-card hidden w-64 flex-shrink-0 flex-col border-r md:flex">
		<!-- Logo / Brand -->
		<div class="border-border flex min-h-[72px] items-center border-b px-6">
			<h1 class="text-foreground text-xl font-bold tracking-tight">
				<span class="text-primary">Talent</span>Atlas
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
							: 'text-secondary-text hover:bg-muted/60 hover:text-foreground'}"
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
		<header
			class="border-border bg-card flex min-h-[72px] items-center justify-between border-b px-6"
		>
			<div class="md:hidden">
				<h2 class="text-foreground text-lg font-semibold">
					<span class="text-primary">Talent</span>Atlas
				</h2>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="inline-flex h-9 w-9 min-w-9 items-center justify-center p-0 md:hidden"
				aria-controls="mobile-curtain-menu"
				aria-expanded={isMobileMenuOpen ? 'true' : 'false'}
				aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
				onclick={toggleMobileMenu}
			>
				{#if isMobileMenuOpen}
					<X size={18} />
				{:else}
					<Menu size={18} />
				{/if}
			</Button>

			<div class="hidden md:block">
				<h2 class="text-foreground text-lg font-semibold">Build & manage resumes</h2>
				<p class="text-muted-fg text-sm">Create professional talent profiles</p>
			</div>

			<div class="hidden items-center gap-4 md:flex">
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
					class="border-border bg-input text-foreground hover:bg-muted/70 focus:ring-primary/40 hidden h-9 w-9 rounded-full border shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-1 md:inline-flex"
				/>
				<form method="POST" action="/logout" class="hidden md:block">
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

	<div
		id="mobile-curtain-menu"
		class={`bg-background/95 text-foreground fixed inset-0 z-[80] flex h-screen flex-col backdrop-blur-sm transition-transform duration-[600ms] ease-[cubic-bezier(.16,1,.3,1)] md:hidden ${
			isMobileMenuOpen
				? 'pointer-events-auto translate-y-0'
				: 'pointer-events-none -translate-y-full'
		}`}
		role="dialog"
		aria-modal="true"
		aria-label="Main menu"
		aria-hidden={isMobileMenuOpen ? 'false' : 'true'}
	>
		<div class="flex h-full flex-col px-6 py-8">
			<div class="flex items-start justify-between">
				<div>
					<p class="text-primary text-xs font-semibold uppercase tracking-[0.28em]">TalentAtlas</p>
					<p class="text-muted-fg mt-2 text-xs uppercase tracking-[0.18em]">Menu</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="inline-flex h-9 w-9 min-w-9 items-center justify-center p-0"
					aria-label="Close menu"
					onclick={closeMobileMenu}
				>
					<X size={16} />
				</Button>
			</div>

			<nav class="mt-10 flex-1 overflow-y-auto">
				<ul class="space-y-3">
					{#each visibleNavItems as item, index}
						<li
							class={`transition-all duration-500 ease-out ${
								isMobileMenuOpen ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
							}`}
							style={`transition-delay: ${isMobileMenuOpen ? 160 + index * 80 : 0}ms`}
						>
							<a
								href={item.href}
								onclick={handleMenuNavClick}
								class={`inline-flex w-full items-center rounded-sm px-4 py-3 text-2xl font-semibold uppercase tracking-[0.08em] transition-colors ${
									isActive(item, activePath)
										? 'bg-primary/15 text-primary'
										: 'hover:bg-muted/40 text-foreground'
								}`}
							>
								{item.label}
							</a>
						</li>
					{/each}
				</ul>
			</nav>

			<div class="border-border mt-6 border-t pt-6">
				<div class="mb-4 flex items-center justify-between">
					<p class="text-muted-fg text-xs font-semibold uppercase tracking-[0.18em]">Appearance</p>
					<Mode.Switch
						class="border-border bg-input text-foreground hover:bg-muted/70 focus:ring-primary/40 h-9 w-9 rounded-full border shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-1"
					/>
				</div>
				<form method="POST" action="/logout">
					<Button
						type="submit"
						variant="outline"
						size="sm"
						class="w-full justify-center"
						onclick={() => {
							closeMobileMenu();
							onlogout?.();
						}}
					>
						Log out
					</Button>
				</form>
			</div>
		</div>
	</div>
</div>
