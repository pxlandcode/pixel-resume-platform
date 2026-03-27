<script lang="ts">
	import { Input } from '@pixelcode_/blocks/components';
	import { LogOut, Moon, Search, Settings, Sun } from 'lucide-svelte';
	import { mode, toggleMode } from 'mode-watcher';
	import { ripple } from '$lib/utils/ripple';
	import type { QuickSearchSection } from '$lib/types/quickSearch';
	import MenuQuickSearchResults from './MenuQuickSearchResults.svelte';
	import type { MenuNavItem, MenuNavSection, QuickSearchStatus } from './types';
	import { isMenuItemActive } from './utils';

	type Props = {
		activePath: string;
		isOpen: boolean;
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
		searchQuery?: string;
		hasSearchQuery: boolean;
		searchTerm: string;
		quickSearchSections?: QuickSearchSection[];
		quickSearchTotal?: number;
		visibleQuickSearchCount?: number;
		quickSearchStatus: QuickSearchStatus;
		quickSearchError?: string | null;
		onavatarerror?: (event: Event) => void;
		onclose?: () => void;
		onnavigate?: () => void;
		onlogout?: () => void;
	};

	let {
		activePath,
		isOpen,
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
		searchQuery = $bindable(''),
		hasSearchQuery,
		searchTerm,
		quickSearchSections = [],
		quickSearchTotal = 0,
		visibleQuickSearchCount = 0,
		quickSearchStatus,
		quickSearchError = null,
		onavatarerror,
		onclose,
		onnavigate,
		onlogout
	}: Props = $props();

	const themeActionLabel = $derived(mode.current === 'dark' ? 'Light mode' : 'Dark mode');
</script>

<div
	id="mobile-curtain-menu"
	class={`fixed inset-0 z-[80] md:hidden ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
	role="dialog"
	aria-modal="true"
	aria-label="Main menu"
	aria-hidden={isOpen ? 'false' : 'true'}
>
	<button
		type="button"
		class={`absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] transition-opacity ${
			isOpen ? 'opacity-100' : 'opacity-0'
		}`}
		aria-label="Close menu"
		onclick={() => onclose?.()}
	></button>

	<aside
		class={`border-border bg-card absolute right-0 top-0 flex h-dvh w-[min(88vw,320px)] flex-col overflow-y-auto border-l transition-transform duration-300 ${
			isOpen ? 'translate-x-0' : 'translate-x-full'
		}`}
	>
		<div class="border-border border-b px-4 py-4">
			<div class="flex min-w-0 items-center gap-3">
				<div class="flex min-w-0 items-center gap-3">
					{#if showUserAvatar}
						<img
							src={userAvatarSrc}
							srcset={userAvatarSrcSet}
							sizes="48px"
							alt={displayName}
							class="h-12 w-12 shrink-0 rounded-md object-cover"
							loading="eager"
							decoding="async"
							onerror={(event) => onavatarerror?.(event)}
						/>
					{:else}
						<div
							class="bg-primary/12 text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-sm font-semibold uppercase"
						>
							{userInitials}
						</div>
					{/if}
					<div class="min-w-0">
						<p class="text-foreground truncate text-sm font-semibold">{displayName}</p>
						{#if userEmail}
							<p class="text-muted-fg truncate text-xs">{userEmail}</p>
						{/if}
					</div>
				</div>
			</div>

			<div class="mt-4">
				<Input
					icon={Search}
					bind:value={searchQuery}
					placeholder="Quick search"
					class="rounded-sm pl-9"
				/>
			</div>
		</div>

		<nav class="px-4 py-4">
			{#if hasSearchQuery}
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
						<div class="mb-3 flex min-h-4 items-center">
							<p class="text-muted-fg text-[11px] font-semibold uppercase tracking-[0.22em]">
								{section.label}
							</p>
						</div>

						<div class="space-y-1.5">
							{#each section.items as item (item.href)}
								<a
									href={item.href}
									onclick={() => onnavigate?.()}
									use:ripple={{ opacity: 0.14 }}
									class={`relative isolate flex items-center gap-3 rounded-sm px-3 py-2.5 transition-colors ${
										isMenuItemActive(item, activePath)
											? 'bg-primary/10 text-primary'
											: 'text-secondary-text hover:bg-muted/60 hover:text-foreground'
									}`}
								>
									<item.icon size={18} class="relative z-10" />
									<span class="relative z-10 truncate text-sm font-medium">{item.label}</span>
								</a>
							{/each}
						</div>
					</section>
				{/each}
			{/if}
		</nav>

		<div class="border-border border-t px-4 py-4">
			<div class="space-y-1.5">
				{#if showSettingsLink}
					<a
						href={settingsItem.href}
						onclick={() => onnavigate?.()}
						use:ripple={{ opacity: 0.14 }}
						class={`relative isolate flex items-center gap-3 rounded-sm px-3 py-2.5 transition-colors ${
							isMenuItemActive(settingsItem, activePath)
								? 'bg-primary/10 text-primary'
								: 'text-secondary-text hover:bg-muted/60 hover:text-foreground'
						}`}
					>
						<Settings size={18} class="relative z-10" />
						<span class="relative z-10 truncate text-sm font-medium">{settingsItem.label}</span>
					</a>
				{/if}

				<button
					type="button"
					use:ripple={{ opacity: 0.14 }}
					class="text-secondary-text hover:bg-muted/60 hover:text-foreground relative isolate flex w-full items-center gap-3 rounded-sm px-3 py-2.5 transition-colors"
					onclick={toggleMode}
				>
					{#if mode.current === 'dark'}
						<Sun size={18} class="relative z-10" />
					{:else}
						<Moon size={18} class="relative z-10" />
					{/if}
					<span class="relative z-10 truncate text-sm font-medium">{themeActionLabel}</span>
				</button>

				<form method="POST" action="/logout">
					<button
						type="submit"
						use:ripple={{ opacity: 0.14 }}
						class="text-secondary-text hover:bg-muted/60 hover:text-foreground relative isolate flex w-full items-center gap-3 rounded-sm px-3 py-2.5 transition-colors"
						onclick={() => onlogout?.()}
					>
						<LogOut size={18} class="relative z-10" />
						<span class="relative z-10 truncate text-sm font-medium">Log out</span>
					</button>
				</form>
			</div>
		</div>

		<div class="border-border border-t px-4 py-4">
			<p
				class="text-muted-fg mb-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.22em]"
			>
				Powered by
			</p>
			<a
				href="https://pixelcode.se"
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center transition-opacity hover:opacity-100"
			>
				<img src={pixelcodeLogo} alt="Pixel&Code" class="h-5" />
			</a>
		</div>
	</aside>
</div>
