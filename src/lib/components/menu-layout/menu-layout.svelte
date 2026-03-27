<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { Button } from '@pixelcode_/blocks/components';
	import { Menu } from 'lucide-svelte';
	import { mode } from 'mode-watcher';
	import { onDestroy, tick } from 'svelte';
	import type { Snippet } from 'svelte';
	import andLogo from '$lib/assets/and.svg';
	import pixelcodeLogoDark from '$lib/assets/pixelcodelogodark.svg';
	import pixelcodeLogoLight from '$lib/assets/pixelcodelogolight.svg';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		supabaseImageSrcsetWidths,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';
	import { userSettingsStore } from '$lib/stores/userSettings';
	import type { QuickSearchResponse, QuickSearchSection } from '$lib/types/quickSearch';
	import DesktopSidebar from './DesktopSidebar.svelte';
	import MobileMenu from './MobileMenu.svelte';
	import { menuNavSections, menuSettingsItem } from './config';
	import type { AdminRole, MenuProfile, QuickSearchStatus } from './types';

	type Props = {
		profile?: MenuProfile | null;
		role?: AdminRole | null;
		roles?: AdminRole[];
		currentTalentId?: string | null;
		userEmail?: string | null;
		unauthorizedMessage?: string | null;
		children: Snippet;
		onlogout?: () => void;
	};

	let {
		profile = null,
		role = null,
		roles = [],
		currentTalentId = null,
		userEmail = null,
		unauthorizedMessage = null,
		children,
		onlogout
	}: Props = $props();

	const CURTAIN_BODY_CLASS = 'mobile-curtain-open';
	const DESKTOP_SEARCH_CONTAINER_ID = 'menu-layout-desktop-search';

	const activePath = $derived($page.url.pathname);
	const displayName = $derived(
		profile
			? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || userEmail || 'User'
			: userEmail || 'User'
	);
	const sidebarCollapsed = $derived($userSettingsStore.settings.navigation.sidebarCollapsed);
	const pixelcodeLogo = $derived(mode.current === 'dark' ? pixelcodeLogoLight : pixelcodeLogoDark);
	const userAvatarUrl = $derived(profile?.avatar_url ?? null);
	const userAvatarSrc = $derived(
		transformSupabasePublicUrl(userAvatarUrl, supabaseImagePresets.avatarList)
	);
	const userAvatarSrcSet = $derived(
		transformSupabasePublicUrlSrcSet(userAvatarUrl, supabaseImageSrcsetWidths.avatarList, {
			height: supabaseImagePresets.avatarList.height,
			quality: supabaseImagePresets.avatarList.quality,
			resize: supabaseImagePresets.avatarList.resize
		})
	);
	const userAvatarFallbackSrc = $derived(getOriginalImageUrl(userAvatarUrl));
	const userInitials = $derived.by(() => {
		const preferredName =
			[profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() ||
			userEmail?.split('@')[0] ||
			'User';
		const parts = preferredName.split(/[\s._-]+/).filter(Boolean);
		if (!parts.length) return 'U';
		if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
		return parts
			.slice(0, 2)
			.map((part) => part.charAt(0))
			.join('')
			.toUpperCase();
	});

	const canView = (allowed: AdminRole[]) => {
		const effectiveRoles = roles.length ? roles : role ? [role] : [];
		return effectiveRoles.some((value) => allowed.includes(value));
	};

	let isMobileMenuOpen = $state(false);
	let previousPath = '';
	let searchQuery = $state('');
	let quickSearchSections = $state<QuickSearchSection[]>([]);
	let quickSearchTotal = $state(0);
	let quickSearchStatus = $state<QuickSearchStatus>('idle');
	let quickSearchError = $state<string | null>(null);
	let quickSearchAbortController: AbortController | null = null;
	let quickSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let userAvatarFailed = $state(false);

	const focusDesktopSearch = () => {
		if (!browser) return;
		const input = document
			.getElementById(DESKTOP_SEARCH_CONTAINER_ID)
			?.querySelector<HTMLInputElement>('input');
		input?.focus();
	};

	const expandAndFocusSearch = async () => {
		if (sidebarCollapsed) {
			void userSettingsStore.setSidebarCollapsed(false);
			await tick();
			setTimeout(() => {
				focusDesktopSearch();
			}, 320);
			return;
		}

		focusDesktopSearch();
	};

	const showUserAvatar = $derived(Boolean(userAvatarUrl) && !userAvatarFailed);

	const handleUserAvatarError = (event: Event) => {
		const target = event.currentTarget as HTMLImageElement | null;
		const fallbackSrc = userAvatarFallbackSrc;
		const currentSrc = target?.currentSrc || target?.src || '';
		const hasSrcset = Boolean(target?.getAttribute('srcset'));

		if (fallbackSrc && target && (currentSrc !== fallbackSrc || hasSrcset)) {
			applyImageFallbackOnce(event, fallbackSrc);
			return;
		}

		userAvatarFailed = true;
	};

	const visibleNavSections = $derived.by(() =>
		menuNavSections
			.map((section) => ({
				...section,
				items: section.items.filter((item) => canView(item.allowed))
			}))
			.filter((section) => section.items.length > 0)
	);

	const showSettingsLink = $derived(canView(menuSettingsItem.allowed));
	const searchTerm = $derived(searchQuery.trim());
	const hasSearchQuery = $derived(searchTerm.length > 0);
	const visibleQuickSearchCount = $derived(
		quickSearchSections.reduce((sum, section) => sum + section.results.length, 0)
	);

	const clearQuickSearchDebounce = () => {
		if (quickSearchDebounceTimer === null) return;
		clearTimeout(quickSearchDebounceTimer);
		quickSearchDebounceTimer = null;
	};

	const abortQuickSearch = () => {
		quickSearchAbortController?.abort();
		quickSearchAbortController = null;
	};

	const resetQuickSearch = () => {
		clearQuickSearchDebounce();
		abortQuickSearch();
		quickSearchSections = [];
		quickSearchTotal = 0;
		quickSearchStatus = 'idle';
		quickSearchError = null;
	};

	const clearSearch = () => {
		searchQuery = '';
		resetQuickSearch();
	};

	const loadQuickSearch = async (query: string) => {
		abortQuickSearch();
		const controller = new AbortController();
		quickSearchAbortController = controller;
		quickSearchStatus = 'loading';
		quickSearchError = null;

		try {
			const response = await fetch(`/internal/api/quick-search?q=${encodeURIComponent(query)}`, {
				method: 'GET',
				credentials: 'include',
				signal: controller.signal
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
				throw new Error(
					typeof payload?.message === 'string'
						? payload.message
						: 'Could not load quick search results.'
				);
			}

			const payload = (await response.json()) as QuickSearchResponse;
			if (controller.signal.aborted || searchQuery.trim() !== query) return;

			quickSearchSections = Array.isArray(payload?.sections) ? payload.sections : [];
			quickSearchTotal = typeof payload?.total === 'number' ? payload.total : 0;
			quickSearchStatus = 'ready';
			quickSearchError = null;
		} catch (error) {
			if (controller.signal.aborted) return;
			quickSearchSections = [];
			quickSearchTotal = 0;
			quickSearchStatus = 'error';
			quickSearchError =
				error instanceof Error ? error.message : 'Could not load quick search results.';
		} finally {
			if (quickSearchAbortController === controller) {
				quickSearchAbortController = null;
			}
		}
	};

	const closeMobileMenu = () => {
		isMobileMenuOpen = false;
		clearSearch();
	};

	const toggleMobileMenu = () => {
		if (isMobileMenuOpen) {
			closeMobileMenu();
			return;
		}

		isMobileMenuOpen = true;
	};

	const toggleDesktopSidebar = () => {
		const nextCollapsed = !sidebarCollapsed;
		if (nextCollapsed) clearSearch();
		void userSettingsStore.setSidebarCollapsed(nextCollapsed);
	};

	const handleMenuKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && isMobileMenuOpen) {
			closeMobileMenu();
			return;
		}

		if (event.key === 'Escape' && searchTerm) {
			clearSearch();
		}
	};

	const handleMenuNavClick = () => {
		if (isMobileMenuOpen) {
			closeMobileMenu();
			return;
		}

		clearSearch();
	};

	const handleMobileLogout = () => {
		closeMobileMenu();
		onlogout?.();
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

	$effect(() => {
		userAvatarUrl;
		userAvatarFailed = false;
	});

	$effect(() => {
		const query = searchTerm;
		clearQuickSearchDebounce();

		if (!query) {
			resetQuickSearch();
			return;
		}

		quickSearchStatus = 'loading';
		quickSearchError = null;
		quickSearchDebounceTimer = setTimeout(() => {
			void loadQuickSearch(query);
			quickSearchDebounceTimer = null;
		}, 180);

		return () => {
			clearQuickSearchDebounce();
		};
	});

	onDestroy(() => {
		clearQuickSearchDebounce();
		abortQuickSearch();
		if (browser) {
			document.body.classList.remove('overflow-hidden', CURTAIN_BODY_CLASS);
		}
	});
</script>

<svelte:window on:keydown={handleMenuKeydown} />

<div
	class="bg-background text-foreground flex min-h-screen md:h-dvh md:min-h-dvh md:overflow-hidden"
>
	<DesktopSidebar
		{activePath}
		{sidebarCollapsed}
		{displayName}
		{userEmail}
		{showUserAvatar}
		{userAvatarSrc}
		{userAvatarSrcSet}
		{userInitials}
		{visibleNavSections}
		{showSettingsLink}
		settingsItem={menuSettingsItem}
		{pixelcodeLogo}
		{andLogo}
		searchContainerId={DESKTOP_SEARCH_CONTAINER_ID}
		bind:searchQuery
		{hasSearchQuery}
		{searchTerm}
		{quickSearchSections}
		{quickSearchTotal}
		{visibleQuickSearchCount}
		{quickSearchStatus}
		{quickSearchError}
		onavatarerror={handleUserAvatarError}
		ontogglesidebar={toggleDesktopSidebar}
		onexpandsearch={expandAndFocusSearch}
		onnavigate={handleMenuNavClick}
		{onlogout}
	/>

	<div class="flex min-w-0 flex-1 flex-col md:min-h-0">
		{#if !isMobileMenuOpen}
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="border-border bg-card text-foreground fixed bottom-4 right-4 z-50 inline-flex h-10 w-10 min-w-10 items-center justify-center rounded-sm p-0 md:hidden"
				aria-controls="mobile-curtain-menu"
				aria-expanded={isMobileMenuOpen ? 'true' : 'false'}
				aria-label="Open menu"
				onclick={toggleMobileMenu}
			>
				<Menu size={18} />
			</Button>
		{/if}

		<main class="flex-1 p-4 pb-20 md:min-h-0 md:overflow-y-auto md:p-6">
			{#if unauthorizedMessage}
				<div
					class="mb-4 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
				>
					{unauthorizedMessage}
				</div>
			{/if}

			{@render children()}
		</main>
	</div>

	<MobileMenu
		{activePath}
		isOpen={isMobileMenuOpen}
		{displayName}
		{userEmail}
		{showUserAvatar}
		{userAvatarSrc}
		{userAvatarSrcSet}
		{userInitials}
		{visibleNavSections}
		{showSettingsLink}
		settingsItem={menuSettingsItem}
		{pixelcodeLogo}
		bind:searchQuery
		{hasSearchQuery}
		{searchTerm}
		{quickSearchSections}
		{quickSearchTotal}
		{visibleQuickSearchCount}
		{quickSearchStatus}
		{quickSearchError}
		onavatarerror={handleUserAvatarError}
		onclose={closeMobileMenu}
		onnavigate={handleMenuNavClick}
		onlogout={handleMobileLogout}
	/>
</div>
