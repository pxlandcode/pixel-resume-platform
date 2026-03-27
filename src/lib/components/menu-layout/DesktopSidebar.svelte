<script lang="ts">
	import { Input } from '@pixelcode_/blocks/components';
	import { ChevronLeft, ChevronRight, LogOut, Moon, Search, Settings, Sun } from 'lucide-svelte';
	import { mode, toggleMode } from 'mode-watcher';
	import { ripple } from '$lib/utils/ripple';
	import type { QuickSearchSection } from '$lib/types/quickSearch';
	import MenuQuickSearchResults from './MenuQuickSearchResults.svelte';
	import type { MenuNavItem, MenuNavSection, QuickSearchStatus } from './types';
	import { isMenuItemActive } from './utils';

	type Props = {
		activePath: string;
		sidebarCollapsed: boolean;
		displayName: string;
		userEmail?: string | null;
		showUserAvatar: boolean;
		userAvatarSrc?: string | null;
		userAvatarSrcSet?: string | null;
		userInitials: string;
		visibleNavSections: MenuNavSection[];
		showSettingsLink: boolean;
		settingsItem: MenuNavItem;
		pixelcodeLogo: string;
		andLogo: string;
		searchContainerId: string;
		searchQuery?: string;
		hasSearchQuery: boolean;
		searchTerm: string;
		quickSearchSections?: QuickSearchSection[];
		quickSearchTotal?: number;
		visibleQuickSearchCount?: number;
		quickSearchStatus: QuickSearchStatus;
		quickSearchError?: string | null;
		onavatarerror?: (event: Event) => void;
		ontogglesidebar?: () => void;
		onexpandsearch?: () => void;
		onnavigate?: () => void;
		onlogout?: () => void;
	};

	let {
		activePath,
		sidebarCollapsed,
		displayName,
		userEmail = null,
		showUserAvatar,
		userAvatarSrc = null,
		userAvatarSrcSet = null,
		userInitials,
		visibleNavSections,
		showSettingsLink,
		settingsItem,
		pixelcodeLogo,
		andLogo,
		searchContainerId,
		searchQuery = $bindable(''),
		hasSearchQuery,
		searchTerm,
		quickSearchSections = [],
		quickSearchTotal = 0,
		visibleQuickSearchCount = 0,
		quickSearchStatus,
		quickSearchError = null,
		onavatarerror,
		ontogglesidebar,
		onexpandsearch,
		onnavigate,
		onlogout
	}: Props = $props();

	const themeActionLabel = $derived(mode.current === 'dark' ? 'Light mode' : 'Dark mode');
</script>

<aside
	class={`border-border bg-card/95 relative z-[40] hidden shrink-0 border-r backdrop-blur md:flex md:h-dvh md:flex-col md:overflow-visible md:transition-[width] md:duration-300 ${
		sidebarCollapsed ? 'w-[72px]' : 'w-[256px]'
	}`}
>
	<button
		type="button"
		use:ripple={{ centered: true, opacity: 0.14 }}
		class="border-border bg-card text-muted-fg hover:text-foreground absolute -right-3 top-8 z-[100] flex h-6 w-6 items-center justify-center rounded-full border shadow-sm transition-all hover:shadow-md"
		aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
		onclick={() => ontogglesidebar?.()}
	>
		{#if sidebarCollapsed}
			<ChevronRight size={11} />
		{:else}
			<ChevronLeft size={11} />
		{/if}
	</button>

	<div class="border-border border-b px-3 py-4">
		<div
			class={`sidebar-tooltip-anchor flex ${sidebarCollapsed ? 'justify-center' : 'items-center gap-3'}`}
		>
			{#if showUserAvatar}
				<img
					src={userAvatarSrc}
					srcset={userAvatarSrcSet}
					sizes="36px"
					alt={displayName}
					class="h-9 w-9 shrink-0 rounded-md object-cover"
					loading="eager"
					decoding="async"
					onerror={(event) => onavatarerror?.(event)}
				/>
			{:else}
				<div
					class="bg-primary/12 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold uppercase"
				>
					{userInitials}
				</div>
			{/if}
			{#if !sidebarCollapsed}
				<div class="min-w-0">
					<p class="text-foreground truncate text-sm font-semibold">{displayName}</p>
					{#if userEmail}
						<p class="text-muted-fg truncate text-xs">{userEmail}</p>
					{/if}
				</div>
			{:else}
				<span class="sidebar-tooltip">{displayName}</span>
			{/if}
		</div>

		<div id={searchContainerId} class="mt-3">
			{#if !sidebarCollapsed}
				<Input
					icon={Search}
					bind:value={searchQuery}
					placeholder="Quick search"
					class="rounded-sm pl-9"
				/>
			{:else}
				<div class="sidebar-tooltip-anchor relative">
					<button
						type="button"
						use:ripple={{ centered: true, opacity: 0.14 }}
						class="hover:bg-muted/60 relative isolate flex h-9 w-full cursor-pointer items-center justify-center rounded-sm transition-colors"
						aria-label="Expand sidebar and search"
						onclick={() => onexpandsearch?.()}
					>
						<Search size={16} class="text-muted-fg relative z-10" />
					</button>
					<span class="sidebar-tooltip">Quick search</span>
				</div>
			{/if}
		</div>
	</div>

	<nav
		class={`flex-1 px-2 py-3 ${sidebarCollapsed ? 'overflow-visible' : 'min-h-0 overflow-y-auto'}`}
	>
		{#if hasSearchQuery && !sidebarCollapsed}
			<MenuQuickSearchResults
				{activePath}
				sections={quickSearchSections}
				status={quickSearchStatus}
				error={quickSearchError}
				{searchTerm}
				total={quickSearchTotal}
				visibleCount={visibleQuickSearchCount}
				onselect={onnavigate}
			/>
		{:else if visibleNavSections.length}
			{#each visibleNavSections as section, sectionIndex (section.id)}
				<section class={sectionIndex > 0 ? 'mt-4' : ''}>
					<div class="relative mb-3 flex h-4 items-center overflow-hidden px-3">
						<p
							class={`text-muted-fg absolute inset-0 flex items-center text-[11px] font-semibold uppercase tracking-[0.22em] transition-all duration-300 ${
								sidebarCollapsed
									? 'pointer-events-none -translate-x-2 opacity-0'
									: 'translate-x-0 opacity-100'
							}`}
						>
							{section.label}
						</p>
						<div
							class={`border-border absolute inset-0 flex items-center transition-all duration-300 ${
								sidebarCollapsed && sectionIndex > 0
									? 'translate-x-0 opacity-100'
									: 'pointer-events-none translate-x-2 opacity-0'
							}`}
						>
							<div class="border-border w-full border-t"></div>
						</div>
					</div>

					<div class="space-y-1.5">
						{#each section.items as item (item.href)}
							<div class="sidebar-tooltip-anchor relative">
								<a
									href={item.href}
									onclick={() => onnavigate?.()}
									use:ripple={{ opacity: 0.14 }}
									class={`sidebar-item sidebar-item--nav relative isolate flex h-9 w-full items-center rounded-sm px-3 transition-colors ${sidebarCollapsed ? 'sidebar-item--collapsed' : ''} ${
										isMenuItemActive(item, activePath)
											? 'bg-primary/10 text-primary'
											: 'text-secondary-text hover:bg-muted/60 hover:text-foreground'
									}`}
									aria-label={sidebarCollapsed ? item.label : undefined}
								>
									<span class="sidebar-item__icon">
										<item.icon size={18} class="shrink-0" />
									</span>
									<span class="sidebar-item__label">{item.label}</span>
								</a>
								{#if sidebarCollapsed}<span class="sidebar-tooltip">{item.label}</span>{/if}
							</div>
						{/each}
					</div>
				</section>
			{/each}
		{/if}
	</nav>

	<div class="border-border border-t px-3 py-4">
		<div class="space-y-1.5">
			{#if showSettingsLink}
				<div class="sidebar-tooltip-anchor relative">
					<a
						href={settingsItem.href}
						onclick={() => onnavigate?.()}
						use:ripple={{ opacity: 0.14 }}
						class={`sidebar-item sidebar-item--footer relative isolate flex h-9 w-full items-center rounded-sm px-3 transition-colors ${sidebarCollapsed ? 'sidebar-item--collapsed' : ''} ${
							isMenuItemActive(settingsItem, activePath)
								? 'bg-primary/10 text-primary'
								: 'text-secondary-text hover:bg-muted/60 hover:text-foreground'
						}`}
						aria-label={sidebarCollapsed ? settingsItem.label : undefined}
					>
						<span class="sidebar-item__icon">
							<Settings size={18} class="shrink-0" />
						</span>
						<span class="sidebar-item__label">{settingsItem.label}</span>
					</a>
					{#if sidebarCollapsed}<span class="sidebar-tooltip">{settingsItem.label}</span>{/if}
				</div>
			{/if}

			<div class="sidebar-tooltip-anchor relative">
				<button
					type="button"
					use:ripple={{ opacity: 0.14 }}
					class={`sidebar-item sidebar-item--footer text-secondary-text hover:bg-muted/60 hover:text-foreground relative isolate flex h-9 w-full items-center rounded-sm px-3 transition-colors ${sidebarCollapsed ? 'sidebar-item--collapsed' : ''}`}
					aria-label={sidebarCollapsed ? themeActionLabel : undefined}
					onclick={toggleMode}
				>
					<span class="sidebar-item__icon">
						{#if mode.current === 'dark'}
							<Sun size={18} class="shrink-0" />
						{:else}
							<Moon size={18} class="shrink-0" />
						{/if}
					</span>
					<span class="sidebar-item__label">{themeActionLabel}</span>
				</button>
				{#if sidebarCollapsed}<span class="sidebar-tooltip">{themeActionLabel}</span>{/if}
			</div>

			<form method="POST" action="/logout">
				<div class="sidebar-tooltip-anchor relative">
					<button
						type="submit"
						use:ripple={{ opacity: 0.14 }}
						class={`sidebar-item sidebar-item--footer text-secondary-text hover:bg-muted/60 hover:text-foreground relative isolate flex h-9 w-full items-center rounded-sm px-3 transition-colors ${sidebarCollapsed ? 'sidebar-item--collapsed' : ''}`}
						aria-label={sidebarCollapsed ? 'Log out' : undefined}
						onclick={() => onlogout?.()}
					>
						<span class="sidebar-item__icon">
							<LogOut size={18} class="shrink-0" />
						</span>
						<span class="sidebar-item__label">Log out</span>
					</button>
					{#if sidebarCollapsed}<span class="sidebar-tooltip">Log out</span>{/if}
				</div>
			</form>
		</div>
	</div>

	<div class="border-border border-t px-4 py-4">
		{#if !sidebarCollapsed}
			<p
				class="text-muted-fg mb-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.22em]"
			>
				Powered by
			</p>
		{/if}
		<a
			href="https://pixelcode.se"
			target="_blank"
			rel="noopener noreferrer"
			class={`sidebar-tooltip-anchor relative flex transition-opacity hover:opacity-100 ${
				sidebarCollapsed ? 'justify-center' : 'items-center'
			}`}
			aria-label={sidebarCollapsed ? 'Powered by Pixel&Code' : undefined}
		>
			<img
				src={sidebarCollapsed ? andLogo : pixelcodeLogo}
				alt="Pixel&Code"
				class={sidebarCollapsed ? 'h-10 w-10' : 'h-5'}
			/>
			{#if sidebarCollapsed}
				<span class="sidebar-tooltip">Powered by pixel&amp;code_</span>
			{/if}
		</a>
	</div>
</aside>

<style>
	.sidebar-tooltip-anchor {
		position: relative;
		overflow: visible;
	}

	.sidebar-item__icon {
		position: absolute;
		left: var(--sidebar-item-icon-left, 19px);
		top: 50%;
		z-index: 1;
		display: flex;
		height: 18px;
		width: 18px;
		align-items: center;
		justify-content: center;
		transform: translateY(-50%);
	}

	.sidebar-item__label {
		margin-left: 3.25rem;
		max-width: 200px;
		overflow: hidden;
		white-space: nowrap;
		font-size: 0.875rem;
		font-weight: 500;
		position: relative;
		z-index: 1;
		opacity: 1;
		transition:
			margin-left 300ms ease,
			max-width 300ms ease,
			opacity 300ms ease;
	}

	.sidebar-item--collapsed .sidebar-item__label {
		margin-left: 0;
		max-width: 0;
		opacity: 0;
	}

	.sidebar-item--footer {
		--sidebar-item-icon-left: 15px;
	}

	.sidebar-tooltip {
		position: absolute;
		left: calc(100% + 14px);
		top: 50%;
		z-index: 9999;
		min-width: max-content;
		max-width: 220px;
		border: 1px solid transparent;
		border-radius: 0.25rem;
		background: var(--color-primary);
		color: var(--color-primary-fg);
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.2;
		opacity: 0;
		padding: 0.6rem 0.75rem;
		pointer-events: none;
		transform: translate(-6px, -50%);
		transition:
			opacity 180ms ease,
			transform 180ms ease;
		white-space: nowrap;
	}

	.sidebar-tooltip::before {
		position: absolute;
		left: -6px;
		top: 50%;
		height: 12px;
		width: 12px;
		border-left: 1px solid transparent;
		border-bottom: 1px solid transparent;
		background: inherit;
		content: '';
		transform: translateY(-50%) rotate(45deg);
	}

	.sidebar-tooltip-anchor:hover .sidebar-tooltip,
	.sidebar-tooltip-anchor:focus-within .sidebar-tooltip {
		opacity: 1;
		transform: translate(0, -50%);
	}
</style>
