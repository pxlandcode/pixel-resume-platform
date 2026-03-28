<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { tooltip } from '$lib/utils/tooltip';
	import { confirm } from '$lib/utils/confirm';
	import {
		Button,
		Card,
		Checkbox,
		FormControl,
		Input,
		TextArea,
		toast
	} from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { OptionButton, type OptionButtonOption } from '$lib/components/option-button';
	import {
		Ban,
		CalendarClock,
		CircleCheck,
		CircleX,
		Copy,
		Download,
		Eye,
		ExternalLink,
		Globe2,
		Info,
		KeyRound,
		Languages,
		Link2,
		Mail,
		MessageSquareText,
		PencilLine,
		Phone,
		RefreshCw,
		Shield,
		UserRound
	} from 'lucide-svelte';
	import type {
		ManagedResumeShareLink,
		ResumeShareEvent,
		ResumeShareLanguageMode,
		ResumeShareLink
	} from '$lib/types/resumeShares';

	let { links = [] }: { links: ManagedResumeShareLink[] } = $props();

	const allLinks = $derived((links ?? []) as ManagedResumeShareLink[]);
	const activeLinks = $derived(
		allLinks.filter((link) => link.status === 'active' || link.status === 'expiring_soon')
	);
	const historicalLinks = $derived(
		allLinks.filter((link) => link.status === 'expired' || link.status === 'revoked')
	);

	let tab = $state<'active' | 'history'>('active');
	let detailsOpen = $state(false);
	let editOpen = $state(false);
	let selectedShareLinkId = $state<string | null>(null);
	let isBusy = $state(false);

	const selectedLink = $derived(
		allLinks.find((link) => link.id === selectedShareLinkId) ?? null
	);

	let label = $state('');
	let isAnonymized = $state(false);
	let accessMode = $state<'link' | 'password'>('password');
	let languageMode = $state<ResumeShareLanguageMode>('both');
	let password = $state('');
	let neverExpires = $state(false);
	let expiresInDays = $state('30');
	let allowDownload = $state(false);
	let includeContactInfo = $state(false);
	let contactName = $state('');
	let contactEmail = $state('');
	let contactPhone = $state('');
	let contactNote = $state('');

	const languageOptions = [
		{ label: 'Swedish', value: 'sv' },
		{ label: 'English', value: 'en' },
		{ label: 'Both', value: 'both' }
	] satisfies OptionButtonOption<ResumeShareLanguageMode>[];

	$effect(() => {
		const link = selectedLink;
		if (!link) return;
		label = link.label ?? '';
		isAnonymized = link.isAnonymized;
		accessMode = link.accessMode;
		languageMode = link.languageMode;
		password = '';
		neverExpires = !link.expiresAt;
		expiresInDays = link.expiresAt
			? String(
					Math.max(
						1,
						Math.ceil(
							(new Date(link.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
						)
					)
				)
			: '30';
		allowDownload = link.allowDownload;
		contactName = link.contactName ?? '';
		contactEmail = link.contactEmail ?? '';
		contactPhone = link.contactPhone ?? '';
		contactNote = link.contactNote ?? '';
		includeContactInfo = Boolean(link.contactName || link.contactEmail || link.contactPhone || link.contactNote);
	});

	const formatDate = (value: string | null | undefined) => {
		if (!value) return 'Never';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(parsed);
	};

	const statusLabel = (status: ResumeShareLink['status']) => {
		if (status === 'expiring_soon') return 'Expiring soon';
		return status.charAt(0).toUpperCase() + status.slice(1);
	};

	const statusClass = (status: ResumeShareLink['status']) => {
		if (status === 'active') return 'bg-emerald-100 text-emerald-800';
		if (status === 'expiring_soon') return 'bg-amber-100 text-amber-800';
		if (status === 'expired') return 'bg-slate-200 text-slate-700';
		return 'bg-rose-100 text-rose-700';
	};

	const statusIconClass = (status: ResumeShareLink['status']) => {
		if (status === 'active') return 'text-emerald-500';
		if (status === 'expiring_soon') return 'text-amber-500';
		if (status === 'expired') return 'text-slate-500';
		return 'text-rose-500';
	};

	const statusIcon = (status: ResumeShareLink['status']) => {
		if (status === 'active') return CircleCheck;
		if (status === 'expiring_soon') return CalendarClock;
		if (status === 'expired') return CircleX;
		return Ban;
	};

	const openDetails = (linkId: string) => {
		selectedShareLinkId = linkId;
		editOpen = false;
		detailsOpen = true;
	};

	const openEdit = (linkId: string) => {
		selectedShareLinkId = linkId;
		detailsOpen = false;
		editOpen = true;
	};

	const runAction = async (action: string, formData: FormData) => {
		const response = await fetch(`?/${action}`, {
			method: 'POST',
			body: formData
		});
		const result = deserialize(await response.text()) as {
			type?: string;
			data?: Record<string, unknown>;
		};
		const payload = result.data ?? null;
		if (result.type !== 'success') {
			throw new Error(
				payload && typeof payload.message === 'string'
					? payload.message
					: 'Request failed.'
			);
		}
		return payload as Record<string, unknown> | null;
	};

	const notifySuccess = (message: string) => {
		if (typeof toast.success === 'function') {
			toast.success(message);
		} else {
			toast(message);
		}
	};

	const notifyError = (message: string) => {
		if (typeof toast.error === 'function') {
			toast.error(message);
		} else {
			toast(message);
		}
	};

	const copyLink = async (shareUrl: string) => {
		if (typeof navigator === 'undefined' || !navigator.clipboard) return;
		await navigator.clipboard.writeText(shareUrl);
		notifySuccess('Share link copied.');
	};

	const revokeLink = async (shareLinkId: string) => {
		isBusy = true;
		try {
			const formData = new FormData();
			formData.set('share_link_id', shareLinkId);
			await runAction('revokeResumeShareLink', formData);
			await invalidateAll();
			editOpen = false;
			notifySuccess('Share link revoked.');
		} catch (error) {
			notifyError(error instanceof Error ? error.message : 'Could not revoke share link.');
		} finally {
			isBusy = false;
		}
	};

	const regenerateLink = async (shareLinkId: string) => {
		isBusy = true;
		try {
			const formData = new FormData();
			formData.set('share_link_id', shareLinkId);
			const payload = await runAction('regenerateResumeShareLink', formData);
			await invalidateAll();
			editOpen = false;
			if (payload && typeof payload.shareUrl === 'string') {
				await copyLink(payload.shareUrl);
			}
			notifySuccess('Share link regenerated.');
		} catch (error) {
			notifyError(error instanceof Error ? error.message : 'Could not regenerate share link.');
		} finally {
			isBusy = false;
		}
	};

	const saveSelectedLink = async () => {
		if (!selectedLink) return;
		isBusy = true;
		try {
			const formData = new FormData();
			formData.set('share_link_id', selectedLink.id);
			formData.set('label', label);
			formData.set('is_anonymized', isAnonymized ? 'true' : 'false');
			formData.set('access_mode', accessMode);
			formData.set('language_mode', languageMode);
			formData.set('allow_download', allowDownload ? 'true' : 'false');
			formData.set('never_expires', neverExpires ? 'true' : 'false');
			formData.set('contact_name', includeContactInfo ? contactName : '');
			formData.set('contact_email', includeContactInfo ? contactEmail : '');
			formData.set('contact_phone', includeContactInfo ? contactPhone : '');
			formData.set('contact_note', includeContactInfo ? contactNote : '');
			if (!neverExpires) {
				formData.set('expires_in_days', expiresInDays);
			}
			if (accessMode === 'password' && password.trim()) {
				formData.set('password', password.trim());
			}

			await runAction('updateResumeShareLink', formData);
			password = '';
			await invalidateAll();
			notifySuccess('Share link updated.');
		} catch (error) {
			notifyError(error instanceof Error ? error.message : 'Could not update share link.');
		} finally {
			isBusy = false;
		}
	};

	const extendSelectedLink = async () => {
		if (!selectedLink) return;
		isBusy = true;
		try {
			const formData = new FormData();
			formData.set('share_link_id', selectedLink.id);
			formData.set('never_expires', neverExpires ? 'true' : 'false');
			if (!neverExpires) {
				formData.set('expires_in_days', expiresInDays);
			}

			await runAction('extendResumeShareLink', formData);
			await invalidateAll();
			notifySuccess('Expiration updated.');
		} catch (error) {
			notifyError(error instanceof Error ? error.message : 'Could not update expiration.');
		} finally {
			isBusy = false;
		}
	};

	const languageLabel = (mode: ResumeShareLanguageMode) => {
		if (mode === 'sv') return 'Swedish';
		if (mode === 'en') return 'English';
		return 'Swedish and English';
	};

	const accessModeLabel = (mode: ResumeShareLink['accessMode']) =>
		mode === 'password' ? 'Password required' : 'Anyone with link';

	const boolLabel = (value: boolean) => (value ? 'Yes' : 'No');

	const hasContactInfo = (link: ResumeShareLink) =>
		Boolean(link.contactName || link.contactEmail || link.contactPhone || link.contactNote);

	const eventOutcomeLabel = (outcome: ResumeShareEvent['outcome']) => {
		if (outcome === 'invalid_token') return 'Invalid link';
		if (outcome === 'wrong_password') return 'Wrong password';
		if (outcome === 'rate_limited') return 'Rate limited';
		return outcome.charAt(0).toUpperCase() + outcome.slice(1);
	};

	const eventIcon = (event: ResumeShareEvent) => {
		if (event.downloadTriggered) return Download;
		if (event.outcome === 'success') return Eye;
		if (event.outcome === 'wrong_password') return KeyRound;
		if (event.outcome === 'expired') return CalendarClock;
		if (event.outcome === 'revoked') return Ban;
		if (event.outcome === 'invalid_token') return Link2;
		return Info;
	};

	const eventIconClass = (event: ResumeShareEvent) => {
		if (event.downloadTriggered || event.outcome === 'success') return 'text-emerald-600 bg-emerald-50';
		if (event.outcome === 'wrong_password' || event.outcome === 'rate_limited') {
			return 'text-amber-700 bg-amber-50';
		}
		if (event.outcome === 'expired') return 'text-slate-700 bg-slate-100';
		return 'text-rose-700 bg-rose-50';
	};
</script>

<Card class="border-border/20 bg-card space-y-5 p-5">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<h3 class="text-foreground text-lg font-semibold">Resume share links</h3>
			<p class="text-muted-fg mt-1 text-sm">
				Manage public-facing private links, review activity, and retire older shares.
			</p>
		</div>

		<div class="inline-flex rounded-sm border border-border p-1">
			<button
				type="button"
				class={`rounded-sm px-3 py-1.5 text-sm ${
					tab === 'active' ? 'bg-primary text-white' : 'text-muted-fg hover:text-foreground'
				}`}
				onclick={() => (tab = 'active')}
			>
				Active ({activeLinks.length})
			</button>
			<button
				type="button"
				class={`rounded-sm px-3 py-1.5 text-sm ${
					tab === 'history' ? 'bg-primary text-white' : 'text-muted-fg hover:text-foreground'
				}`}
				onclick={() => (tab = 'history')}
			>
				History ({historicalLinks.length})
			</button>
		</div>
	</div>

	<div class="overflow-x-auto">
		<table class="w-full min-w-[820px] border-collapse text-left">
			<thead>
				<tr class="border-b border-border text-xs uppercase tracking-[0.16em] text-muted-fg">
					<th class="px-3 py-3 font-medium">Label</th>
					<th class="px-3 py-3 font-medium">Resume</th>
					<th class="px-3 py-3 font-medium">Expires</th>
					<th class="px-3 py-3 font-medium">Views</th>
					<th class="px-3 py-3 font-medium">Last viewed</th>
					<th class="px-3 py-3 font-medium">Status</th>
					<th class="px-3 py-3 font-medium text-right">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each (tab === 'active' ? activeLinks : historicalLinks) as link (link.id)}
					<tr class="border-b border-border/70 align-top">
						<td class="px-3 py-4 text-sm text-foreground">
							<div class="max-w-[220px] truncate font-medium" title={link.label ?? 'Untitled link'}>
								{link.label ?? 'Untitled link'}
							</div>
							<div class="mt-1 text-xs text-muted-fg">{link.talentName}</div>
						</td>
						<td class="px-3 py-4 text-sm text-foreground">{link.resumeTitle}</td>
						<td class="px-3 py-4 text-sm text-muted-fg">{formatDate(link.expiresAt)}</td>
						<td class="px-3 py-4 text-sm text-muted-fg">{link.successfulViewCount}</td>
						<td class="px-3 py-4 text-sm text-muted-fg">{formatDate(link.lastViewedAt)}</td>
						<td class="px-3 py-4 text-sm">
							<span
								class={`inline-flex cursor-default ${statusIconClass(link.status)}`}
								use:tooltip={statusLabel(link.status)}
							>
								<svelte:component this={statusIcon(link.status)} size={16} />
							</span>
						</td>
						<td class="px-3 py-4 text-right">
							<div class="flex justify-end gap-2">
								<Button type="button" variant="outline" size="sm" onclick={() => copyLink(link.shareUrl)}>
									<Copy size={14} />
									Copy
								</Button>
								<Button type="button" variant="outline" size="sm" onclick={() => openDetails(link.id)}>
									<Eye size={14} />
									Details
								</Button>
								{#if link.status !== 'revoked'}
									<Button
										type="button"
										variant="outline"
										size="sm"
										onclick={() => openEdit(link.id)}
									>
										<PencilLine size={14} />
										Edit
									</Button>
								{/if}
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="7" class="px-3 py-8 text-center text-sm text-muted-fg">
							No {tab === 'active' ? 'active' : 'historical'} share links.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Card>

<Drawer
	bind:open={detailsOpen}
	variant="bottom"
	title={selectedLink?.label ?? 'Share link details'}
	subtitle={selectedLink ? `${selectedLink.resumeTitle} · ${selectedLink.talentName}` : undefined}
>
	{#if selectedLink}
		<div class="mx-auto w-full max-w-5xl space-y-6 overflow-x-hidden">
			<div class="grid gap-3 sm:grid-cols-3">
				<div class="rounded-sm border border-border px-4 py-3">
					<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
						<Eye size={14} />
						<span>Views</span>
					</div>
					<p class="mt-2 text-2xl font-semibold text-foreground">{selectedLink.successfulViewCount}</p>
				</div>
				<div class="rounded-sm border border-border px-4 py-3">
					<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
						<Download size={14} />
						<span>Downloads</span>
					</div>
					<p class="mt-2 text-2xl font-semibold text-foreground">{selectedLink.downloadCount}</p>
				</div>
				<div class="rounded-sm border border-border px-4 py-3">
					<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
						<Info size={14} />
						<span>Status</span>
					</div>
					<div class="mt-2 flex items-center gap-2">
						<span class={`inline-flex ${statusIconClass(selectedLink.status)}`}>
							<svelte:component this={statusIcon(selectedLink.status)} size={16} />
						</span>
						<p class="text-sm font-semibold text-foreground">{statusLabel(selectedLink.status)}</p>
					</div>
				</div>
			</div>

			<div class="space-y-4 rounded-sm border border-border p-4">
				<div class="flex items-center justify-between gap-3">
					<div class="min-w-0">
						<p class="text-sm font-semibold text-foreground">Link</p>
						<p class="mt-1 break-all text-xs text-muted-fg">{selectedLink.shareUrl}</p>
					</div>
					<Button type="button" variant="outline" onclick={() => copyLink(selectedLink.shareUrl)}>
						<Copy size={14} />
						Copy
					</Button>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					<div class="rounded-sm border border-border px-4 py-3">
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
							<Shield size={14} />
							<span>Access</span>
						</div>
						<p class="mt-2 text-sm font-semibold text-foreground">
							{accessModeLabel(selectedLink.accessMode)}
						</p>
					</div>
					<div class="rounded-sm border border-border px-4 py-3">
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
							<Languages size={14} />
							<span>Languages</span>
						</div>
						<p class="mt-2 text-sm font-semibold text-foreground">
							{languageLabel(selectedLink.languageMode)}
						</p>
					</div>
					<div class="rounded-sm border border-border px-4 py-3">
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
							<Shield size={14} />
							<span>Anonymized</span>
						</div>
						<p class="mt-2 text-sm font-semibold text-foreground">{boolLabel(selectedLink.isAnonymized)}</p>
					</div>
					<div class="rounded-sm border border-border px-4 py-3">
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
							<Download size={14} />
							<span>Download allowed</span>
						</div>
						<p class="mt-2 text-sm font-semibold text-foreground">{boolLabel(selectedLink.allowDownload)}</p>
					</div>
					<div class="rounded-sm border border-border px-4 py-3">
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
							<UserRound size={14} />
							<span>Created by</span>
						</div>
						<p class="mt-2 text-sm font-semibold text-foreground">{selectedLink.createdByName}</p>
					</div>
					<div class="rounded-sm border border-border px-4 py-3">
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
							<CalendarClock size={14} />
							<span>Created</span>
						</div>
						<p class="mt-2 text-sm font-semibold text-foreground">{formatDate(selectedLink.createdAt)}</p>
					</div>
					<div class="rounded-sm border border-border px-4 py-3">
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
							<CalendarClock size={14} />
							<span>Expires</span>
						</div>
						<p class="mt-2 text-sm font-semibold text-foreground">{formatDate(selectedLink.expiresAt)}</p>
					</div>
					<div class="rounded-sm border border-border px-4 py-3">
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
							<Eye size={14} />
							<span>First viewed</span>
						</div>
						<p class="mt-2 text-sm font-semibold text-foreground">{formatDate(selectedLink.firstViewedAt)}</p>
					</div>
					<div class="rounded-sm border border-border px-4 py-3">
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
							<Eye size={14} />
							<span>Last viewed</span>
						</div>
						<p class="mt-2 text-sm font-semibold text-foreground">{formatDate(selectedLink.lastViewedAt)}</p>
					</div>
					<div class="rounded-sm border border-border px-4 py-3">
						<div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-fg">
							<Link2 size={14} />
							<span>Token hint</span>
						</div>
						<p class="mt-2 text-sm font-semibold text-foreground">{selectedLink.tokenHint}</p>
					</div>
				</div>

				{#if hasContactInfo(selectedLink)}
					<div class="space-y-3 rounded-sm border border-border px-4 py-4">
						<div class="flex items-center gap-2">
							<UserRound class="text-muted-fg" size={16} />
							<h4 class="text-sm font-semibold text-foreground">Contact info</h4>
						</div>
						<div class="grid gap-3 text-sm text-muted-fg">
							{#if selectedLink.contactName}
								<div class="flex items-start gap-2">
									<UserRound class="mt-0.5 shrink-0 text-muted-fg" size={14} />
									<div class="min-w-0">
									<span class="font-medium text-foreground">Name:</span> {selectedLink.contactName}
									</div>
								</div>
							{/if}
							{#if selectedLink.contactEmail}
								<div class="flex items-start gap-2">
									<Mail class="mt-0.5 shrink-0 text-muted-fg" size={14} />
									<div class="min-w-0 break-all">
									<span class="font-medium text-foreground">Email:</span> {selectedLink.contactEmail}
									</div>
								</div>
							{/if}
							{#if selectedLink.contactPhone}
								<div class="flex items-start gap-2">
									<Phone class="mt-0.5 shrink-0 text-muted-fg" size={14} />
									<div class="min-w-0 break-all">
									<span class="font-medium text-foreground">Phone:</span> {selectedLink.contactPhone}
									</div>
								</div>
							{/if}
							{#if selectedLink.contactNote}
								<div class="flex items-start gap-2">
									<MessageSquareText class="mt-0.5 shrink-0 text-muted-fg" size={14} />
									<div class="min-w-0 break-words">
									<span class="font-medium text-foreground">Note:</span> {selectedLink.contactNote}
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Info class="text-muted-fg" size={16} />
						<h4 class="text-sm font-semibold text-foreground">Activity history</h4>
					</div>
					<span class="text-xs text-muted-fg">{selectedLink.events.length} recent events</span>
				</div>

				<div class="space-y-2">
					{#each selectedLink.events as event (event.id)}
						<div class="rounded-sm border border-border px-4 py-3">
							<div class="flex min-w-0 items-start gap-3">
								<div class={`mt-0.5 inline-flex shrink-0 rounded-full p-2 ${eventIconClass(event)}`}>
									<svelte:component this={eventIcon(event)} size={14} />
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-2">
										<p class="text-sm font-semibold text-foreground">
											{event.downloadTriggered ? 'Download' : 'Open'} · {eventOutcomeLabel(event.outcome)}
										</p>
										{#if event.downloadTriggered}
											<span class="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
												PDF
											</span>
										{/if}
									</div>
									<p class="mt-1 text-xs text-muted-fg">{formatDate(event.occurredAt)}</p>

									<div class="mt-3 grid gap-2 text-xs text-muted-fg sm:grid-cols-2">
										<div class="min-w-0 rounded-sm bg-muted/30 px-3 py-2">
											<div class="flex items-center gap-2 font-medium text-foreground/80">
												<Info size={12} />
												<span>User agent</span>
											</div>
											<p class="mt-1 break-all">{event.userAgent ?? 'Unavailable'}</p>
										</div>
										<div class="min-w-0 rounded-sm bg-muted/30 px-3 py-2">
											<div class="flex items-center gap-2 font-medium text-foreground/80">
												<ExternalLink size={12} />
												<span>Referrer</span>
											</div>
											<p class="mt-1 break-all">{event.referrerUrlSanitized ?? 'Unavailable'}</p>
										</div>
									</div>
								</div>
							</div>
						</div>
					{:else}
						<p class="rounded-sm border border-border px-4 py-6 text-sm text-muted-fg">
							No activity has been recorded for this share link yet.
						</p>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</Drawer>

<Drawer
	bind:open={editOpen}
	variant="right"
	title="Edit share link"
	subtitle={selectedLink ? `${selectedLink.resumeTitle} · ${selectedLink.talentName}` : undefined}
>
	{#if selectedLink}
		<div class="space-y-6">
			<div class="space-y-4 rounded-sm border border-border p-4">
				<div class="flex items-center justify-between gap-3">
					<div class="min-w-0">
						<p class="text-sm font-semibold text-foreground">Link</p>
						<p class="mt-1 break-all text-xs text-muted-fg">{selectedLink.shareUrl}</p>
					</div>
					<Button type="button" variant="outline" onclick={() => copyLink(selectedLink.shareUrl)}>
						<Copy size={14} />
						Copy
					</Button>
				</div>

				<FormControl label="Label" class="gap-2">
					<Input bind:value={label} maxlength={120} class="bg-input text-foreground" />
				</FormControl>

				<OptionButton
					label="Languages"
					bind:value={languageMode}
					options={languageOptions}
					variant="outline"
				/>

				<div class="grid gap-3">
					<button
						type="button"
						class={`cursor-pointer rounded-sm border px-4 py-3 text-left transition-colors ${
							accessMode === 'password'
								? 'border-primary bg-primary/5 hover:bg-primary/10'
								: 'border-border hover:border-primary/40 hover:bg-muted/40'
						}`}
						onclick={() => (accessMode = 'password')}
					>
						<p class="text-sm font-semibold text-foreground">Password required</p>
						<p class="mt-1 text-xs text-muted-fg">Require a password before the resume is shown.</p>
					</button>

					<button
						type="button"
						class={`cursor-pointer rounded-sm border px-4 py-3 text-left transition-colors ${
							accessMode === 'link'
								? 'border-primary bg-primary/5 hover:bg-primary/10'
								: 'border-border hover:border-primary/40 hover:bg-muted/40'
						}`}
						onclick={() => (accessMode = 'link')}
					>
						<p class="text-sm font-semibold text-foreground">Anyone with link</p>
						<p class="mt-1 text-xs text-muted-fg">No password prompt, but still unlisted and private.</p>
					</button>
				</div>

				{#if accessMode === 'password'}
					<FormControl label="Set new password" class="gap-2">
						<Input
							bind:value={password}
							type="password"
							minlength={6}
							placeholder="Leave blank to keep current password"
							class="bg-input text-foreground"
						/>
					</FormControl>
				{/if}

				<div class="grid gap-3">
					<label class="flex cursor-pointer items-start gap-3 rounded-sm border border-border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-muted/30">
						<Checkbox bind:checked={isAnonymized} />
						<div>
							<p class="text-sm font-semibold text-foreground">Anonymize resume</p>
							<p class="mt-1 text-xs text-muted-fg">Hide direct personal identifiers in the shared view.</p>
						</div>
					</label>

					<label class="flex cursor-pointer items-start gap-3 rounded-sm border border-border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-muted/30">
						<Checkbox bind:checked={allowDownload} />
						<div>
							<p class="text-sm font-semibold text-foreground">Allow PDF download</p>
							<p class="mt-1 text-xs text-muted-fg">Expose download actions on the public page.</p>
						</div>
					</label>
				</div>

				<label class="flex cursor-pointer items-start gap-3 rounded-sm border border-border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-muted/30">
					<Checkbox bind:checked={neverExpires} />
					<div>
						<p class="text-sm font-semibold text-foreground">Never expires</p>
						<p class="mt-1 text-xs text-muted-fg">Turn this off to auto-disable the link after a set number of days.</p>
					</div>
				</label>

				<label class="flex cursor-pointer items-start gap-3 rounded-sm border border-border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-muted/30">
					<Checkbox bind:checked={includeContactInfo} />
					<div>
						<p class="text-sm font-semibold text-foreground">Add contact info</p>
						<p class="mt-1 text-xs text-muted-fg">Show a contact button on the public share page.</p>
					</div>
				</label>

				{#if includeContactInfo}
					<div class="space-y-4 rounded-sm border border-border px-4 py-4">
						<FormControl label="Contact name" class="gap-2">
							<Input bind:value={contactName} maxlength={120} class="bg-input text-foreground" />
						</FormControl>

						<div class="grid gap-4 sm:grid-cols-2">
							<FormControl label="Email" class="gap-2">
								<Input bind:value={contactEmail} type="email" maxlength={320} class="bg-input text-foreground" />
							</FormControl>

							<FormControl label="Phone number" class="gap-2">
								<Input bind:value={contactPhone} maxlength={64} class="bg-input text-foreground" />
							</FormControl>
						</div>

						<FormControl label="Short note" class="gap-2">
							<TextArea bind:value={contactNote} rows={4} maxlength={1000} class="bg-input text-foreground" />
						</FormControl>
					</div>
				{/if}

				{#if !neverExpires}
					<FormControl label="Expires in days" class="gap-2">
						<Input bind:value={expiresInDays} type="number" min="1" max="365" class="bg-input text-foreground" />
					</FormControl>
				{/if}

				<div class="flex flex-wrap justify-end gap-2">
					<Button type="button" variant="outline" onclick={extendSelectedLink} disabled={isBusy}>
						<CalendarClock size={14} />
						Extend expiration
					</Button>
					<Button type="button" variant="primary" onclick={saveSelectedLink} disabled={isBusy}>
						<PencilLine size={14} />
						Save changes
					</Button>
				</div>
			</div>

			{#if selectedLink.status !== 'revoked'}
				<div class="space-y-3 rounded-sm border border-rose-200 bg-rose-50/50 p-4">
					<div>
						<h4 class="text-sm font-semibold text-foreground">Link actions</h4>
						<p class="mt-1 text-xs text-muted-fg">
							Regenerating creates a new URL. Revoking immediately disables this share link.
						</p>
					</div>

					<div class="flex flex-wrap justify-end gap-2">
						<button
							type="button"
							disabled={isBusy}
							class="border-border bg-card text-foreground inline-flex cursor-pointer items-center justify-center rounded-sm border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
							use:confirm={{
								title: 'Regenerate share link?',
								description: 'The current URL will stop working and a new URL will be created.',
								actionLabel: 'Regenerate',
								action: () => {
									void regenerateLink(selectedLink.id);
								}
							}}
						>
							<RefreshCw size={14} />
							Regenerate link
						</button>
						<button
							type="button"
							disabled={isBusy}
							class="border-border bg-card text-foreground inline-flex cursor-pointer items-center justify-center rounded-sm border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
							use:confirm={{
								title: 'Revoke share link?',
								description: 'Anyone using this link will lose access immediately.',
								actionLabel: 'Revoke',
								action: () => {
									void revokeLink(selectedLink.id);
								}
							}}
						>
							<Ban size={14} />
							Revoke link
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</Drawer>
