<script lang="ts">
	import { goto } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { Button, Card, FormControl, Icon, Input, toast } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { OptionButton, type OptionButtonOption } from '$lib/components/option-button';
	import ResumePrint from '$lib/components/resumes/ResumePrint.svelte';
	import ResumeView from '$lib/components/resumes/ResumeView.svelte';
	import {
		DEFAULT_ORGANISATION_BRANDING_THEME,
		organisationBrandingThemeToInlineStyle
	} from '$lib/branding/theme';
	import { Download, Globe2, Mail, MessageSquareText, MoreHorizontal, Phone, X } from 'lucide-svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData | null } = $props();

	const status = $derived(data.status);
	const readyData = $derived(
		data.status === 'ready' ? (data as Extract<PageData, { status: 'ready' }>) : null
	);
	const language = $derived((data.language as 'sv' | 'en') ?? 'sv');
	const sharingOrganisationName = $derived(data.organisationName?.trim() || 'The organisation');
	const templateBrandingStyle = $derived.by(() => {
		const theme = data.templateContext?.brandingTheme ?? DEFAULT_ORGANISATION_BRANDING_THEME;
		const inlineVars = organisationBrandingThemeToInlineStyle(theme);
		return [
			inlineVars,
			`--color-primary: ${theme.light.primary}`,
			`--color-background: ${theme.light.background}`,
			`--color-foreground: ${theme.light.foreground}`,
			`--color-text: ${theme.light.text}`,
			`--color-secondary-text: ${theme.light.secondaryText}`,
			`--color-secondary: ${theme.light.secondaryText}`,
			`--color-card: ${theme.light.card}`,
			`--color-card-fg: ${theme.light.cardForeground}`,
			`--color-card-bg: ${theme.light.card}`,
			`--color-card-border: ${theme.light.border}`,
			`--color-border: ${theme.light.border}`,
			`--color-input: ${theme.light.input}`,
			`--color-muted: ${theme.light.muted}`,
			`--color-muted-fg: ${theme.light.mutedForeground}`
		].join('; ');
	});

	const errorTitle = $derived.by(() => {
		if (status === 'expired') return 'This share link has expired';
		if (status === 'revoked') return 'This share link is no longer active';
		if (status === 'rate_limited') return 'Too many attempts';
		return 'This share link is not available';
	});

	const errorDescription = $derived.by(() => {
		if (status === 'expired') return `Ask ${sharingOrganisationName} for a new share link.`;
		if (status === 'revoked') return `Ask ${sharingOrganisationName} for an updated share link.`;
		if (status === 'rate_limited') return 'Please wait a few minutes before trying again.';
		return 'Check the URL or ask the organisation to generate a new link.';
	});
	const downloadHref = $derived.by(() => {
		if (!data.downloadHref) return null;
		const target = new URL(data.downloadHref, 'https://share.invalid');
		target.searchParams.set('lang', language);
		return `${target.pathname}${target.search}`;
	});
	const languageOptions = [
		{ label: 'SV', value: 'sv' },
		{ label: 'EN', value: 'en' }
	] satisfies OptionButtonOption<'sv' | 'en'>[];
	const hasContactInfo = $derived(
		Boolean(
			readyData?.contactInfo?.name ||
				readyData?.contactInfo?.email ||
				readyData?.contactInfo?.phone ||
				readyData?.contactInfo?.note
		)
	);
	const canSwitchLanguage = $derived((readyData?.availableLanguages?.length ?? 0) > 1);
	const showFloatingBar = $derived(Boolean(downloadHref || hasContactInfo || canSwitchLanguage));
	let contactDrawerOpen = $state(false);
	let mobileActionsOpen = $state(false);
	let isSwitchingLanguage = $state(false);
	let isCreatingPdf = $state(false);
	let pendingLanguage = $state<'sv' | 'en' | null>(null);

	const notifyError = (message: string) => {
		if (typeof toast.error === 'function') {
			toast.error(message);
		} else {
			toast(message);
		}
	};

	const switchLanguage = async (nextLanguage: 'sv' | 'en') => {
		if (nextLanguage === language || !readyData || !canSwitchLanguage || isSwitchingLanguage) return;
		isSwitchingLanguage = true;
		pendingLanguage = nextLanguage;
		const target = new URL(window.location.href);
		target.searchParams.set('lang', nextLanguage);
		try {
			await goto(`${target.pathname}${target.search}`, {
				replaceState: true,
				noScroll: true,
				keepFocus: true
			});
		} finally {
			isSwitchingLanguage = false;
			pendingLanguage = null;
		}
	};

	const handleLanguageChange = (value: string) => {
		if (value !== 'sv' && value !== 'en') return;
		void switchLanguage(value);
	};

	const handleDownloadPdf = async () => {
		if (!downloadHref || isCreatingPdf) return;

		isCreatingPdf = true;
		try {
			const target = new URL(downloadHref, window.location.origin);
			target.searchParams.set('prepare', '1');
			const response = await fetch(`${target.pathname}${target.search}`, {
				method: 'GET',
				credentials: 'same-origin'
			});
			if (!response.ok) {
				throw new Error('Could not create the PDF.');
			}

			const payload = (await response.json()) as {
				ok?: boolean;
				filename?: string;
				downloadUrl?: string;
			};
			if (!payload.downloadUrl) {
				throw new Error('Could not prepare the PDF download.');
			}

			const link = document.createElement('a');
			link.href = payload.downloadUrl;
			link.download = payload.filename ?? 'shared-resume.pdf';
			link.rel = 'noreferrer';
			document.body.appendChild(link);
			link.click();
			link.remove();
		} catch (error) {
			notifyError(error instanceof Error ? error.message : 'Could not create the PDF.');
		} finally {
			isCreatingPdf = false;
		}
	};

	const openContactDrawer = () => {
		contactDrawerOpen = true;
	};
</script>

<svelte:head>
	<title>{data.meta?.title ?? 'Shared resume'}</title>
	{#if data.templateContext?.mainFontFaceCss}
		{@html `<style id="share-template-font-face">${data.templateContext.mainFontFaceCss}</style>`}
	{/if}
</svelte:head>

{#if readyData && data.printMode}
	<div class="bg-white text-slate-900" style={templateBrandingStyle}>
		<ResumePrint
			data={readyData.resume.data}
			image={readyData.resumePerson?.avatar_url}
			{language}
			person={readyData.resumePerson ?? undefined}
			profileTechStack={readyData.resumePerson?.techStack}
			templateKey={readyData.templateContext?.templateKey}
			templateMainLogotypeUrl={readyData.templateContext?.mainLogotypeUrl}
			templateAccentLogoUrl={readyData.templateContext?.accentLogoUrl}
			templateEndLogoUrl={readyData.templateContext?.endLogoUrl}
			templateHomepageUrl={readyData.templateContext?.homepageUrl}
			templateMainFontCssStack={readyData.templateContext?.mainFontCssStack}
			templateIsPixelCode={readyData.templateContext?.isPixelCode}
		/>
	</div>
{:else if readyData}
	<div class="min-h-screen bg-[#f4f1eb] px-4 py-6 pb-28 sm:px-6 lg:px-8" style={templateBrandingStyle}>
		<div
			class="mx-auto max-w-6xl overflow-hidden rounded-sm border border-black/10 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)]"
		>
			<ResumeView
				data={readyData.resume.data}
				image={readyData.resumePerson?.avatar_url}
				{language}
				showLanguageToggle={false}
				showMobileProfileHeading
				person={readyData.resumePerson ?? undefined}
				profileTechStack={readyData.resumePerson?.techStack}
				templateMainLogotypeUrl={readyData.templateContext?.mainLogotypeUrl}
				templateAccentLogoUrl={readyData.templateContext?.accentLogoUrl}
				templateEndLogoUrl={readyData.templateContext?.endLogoUrl}
				templateHomepageUrl={readyData.templateContext?.homepageUrl}
				templateMainFontCssStack={readyData.templateContext?.mainFontCssStack}
				templateIsPixelCode={readyData.templateContext?.isPixelCode}
			/>
		</div>

		{#if showFloatingBar}
			<div class="pointer-events-none fixed bottom-4 right-4 z-20 hidden flex-wrap items-center justify-end gap-3 sm:bottom-6 sm:right-6 sm:flex">
				{#if canSwitchLanguage}
					<div class="pointer-events-auto relative min-w-[168px]">
						<OptionButton
							label="Language"
							hideLabel
							value={language}
							options={languageOptions}
							variant="outline"
							size="sm"
							disabled={isSwitchingLanguage}
							loadingValue={pendingLanguage}
							onchange={handleLanguageChange}
							class="border-black/10 bg-transparent shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
						/>
					</div>
				{/if}

				{#if downloadHref}
					<Button
						type="button"
						variant="primary"
						class="pointer-events-auto shadow-[0_12px_32px_rgba(15,23,42,0.18)]"
						loading={isCreatingPdf}
						loading-text="Creating PDF"
						onclick={handleDownloadPdf}
					>
						Download PDF
					</Button>
				{/if}

				{#if hasContactInfo}
					<Button
						type="button"
						variant="outline"
						class="pointer-events-auto border-black/10 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
						onclick={openContactDrawer}
					>
						Contact
					</Button>
				{/if}
			</div>

			<div class="fixed bottom-4 right-4 z-30 sm:hidden">
				<div class="relative flex flex-col items-end gap-3">
					{#if mobileActionsOpen}
						<div class="absolute bottom-full right-0 mb-3 flex flex-col items-end gap-2">
							{#if canSwitchLanguage}
								<div
									in:fly={{ y: 28, duration: 220, delay: 100 }}
									out:fly={{ y: 18, duration: 140 }}
									class="w-[164px]"
								>
									<div class="mb-2 flex items-center justify-end gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
										<Globe2 class="h-3.5 w-3.5" />
										<span>Language</span>
									</div>
									<OptionButton
										label="Language"
										hideLabel
										value={language}
										options={languageOptions}
										variant="outline"
										size="sm"
										disabled={isSwitchingLanguage}
										loadingValue={pendingLanguage}
										onchange={handleLanguageChange}
										class="border-black/10 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
									/>
								</div>
							{/if}

							{#if hasContactInfo}
								<div
									in:fly={{ y: 28, duration: 220, delay: downloadHref ? 50 : 0 }}
									out:fly={{ y: 18, duration: 140 }}
								>
									<Button
										type="button"
										variant="outline"
										class="min-w-[164px] justify-center border-black/10 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
										onclick={openContactDrawer}
									>
										<Mail class="h-4 w-4" />
										<span>Contact</span>
									</Button>
								</div>
							{/if}

							{#if downloadHref}
								<div
									in:fly={{ y: 28, duration: 220 }}
									out:fly={{ y: 18, duration: 140 }}
								>
									<Button
										type="button"
										variant="primary"
										class="min-w-[164px] justify-center shadow-[0_12px_32px_rgba(15,23,42,0.18)]"
										loading={isCreatingPdf}
										loading-text="Creating PDF"
										onclick={handleDownloadPdf}
									>
										<Download class="h-4 w-4" />
										<span>Download PDF</span>
									</Button>
								</div>
							{/if}
						</div>
					{/if}

					<Button
						type="button"
						variant="outline"
						class="h-12 w-12 rounded-sm border-black/10 bg-white p-0 shadow-[0_12px_32px_rgba(15,23,42,0.18)]"
						aria-label={mobileActionsOpen ? 'Close share actions' : 'Open share actions'}
						onclick={() => (mobileActionsOpen = !mobileActionsOpen)}
					>
						{#if mobileActionsOpen}
							<Icon icon={X} size="sm" />
						{:else}
							<Icon icon={MoreHorizontal} size="sm" />
						{/if}
					</Button>
				</div>
			</div>
		{/if}
	</div>

	<Drawer
		bind:open={contactDrawerOpen}
		variant="bottom"
		style={templateBrandingStyle}
		title={`Contact ${sharingOrganisationName}`}
		subtitle={`Get in touch with ${sharingOrganisationName} about this shared resume.`}
	>
		<div class="space-y-4 pb-4">
			{#if readyData.contactInfo?.email}
				<a
					href={`mailto:${readyData.contactInfo.email}`}
					class="flex items-start gap-3 rounded-sm border border-border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-muted/30"
				>
					<Mail class="mt-0.5 h-4 w-4 shrink-0 text-muted-fg" />
					<div>
						{#if readyData.contactInfo?.name}
							<p class="text-sm font-semibold text-foreground">{readyData.contactInfo.name}</p>
						{/if}
						<p class="text-xs uppercase tracking-[0.16em] text-muted-fg">Email</p>
						<p class="mt-1 text-sm font-medium text-foreground">{readyData.contactInfo.email}</p>
					</div>
				</a>
			{/if}

			{#if readyData.contactInfo?.phone}
				<a
					href={`tel:${readyData.contactInfo.phone}`}
					class="flex items-start gap-3 rounded-sm border border-border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-muted/30"
				>
					<Phone class="mt-0.5 h-4 w-4 shrink-0 text-muted-fg" />
					<div>
						{#if readyData.contactInfo?.name && !readyData.contactInfo?.email}
							<p class="text-sm font-semibold text-foreground">{readyData.contactInfo.name}</p>
						{/if}
						<p class="text-xs uppercase tracking-[0.16em] text-muted-fg">Phone</p>
						<p class="mt-1 text-sm font-medium text-foreground">{readyData.contactInfo.phone}</p>
					</div>
				</a>
			{/if}

			{#if readyData.contactInfo?.note}
				<div class="rounded-sm border border-border px-4 py-3">
					<div class="flex items-start gap-3">
						<MessageSquareText class="mt-0.5 h-4 w-4 shrink-0 text-muted-fg" />
						<div>
							{#if readyData.contactInfo?.name && !readyData.contactInfo?.email && !readyData.contactInfo?.phone}
								<p class="text-sm font-semibold text-foreground">{readyData.contactInfo.name}</p>
							{/if}
							<p class="text-xs uppercase tracking-[0.16em] text-muted-fg">Note</p>
							<p class="mt-1 whitespace-pre-wrap text-sm text-foreground">{readyData.contactInfo.note}</p>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</Drawer>
{:else if status === 'password_required'}
	<div class="flex min-h-screen items-center justify-center bg-[#f4f1eb] px-4 py-10">
		<Card class="w-full max-w-md border-black/10 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
			<p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
				Shared by {sharingOrganisationName}
			</p>
			<h1 class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
				Enter password
			</h1>
			<p class="mt-2 text-sm text-slate-600">
				{sharingOrganisationName} has shared a resume with you. Enter the password you received to continue.
			</p>

			<form method="POST" class="mt-6 space-y-4">
				<FormControl label="Password" required class="gap-2">
					<Input
						name="password"
						type="password"
						required
						autocomplete="current-password"
						class="bg-input text-foreground"
					/>
				</FormControl>

				{#if form?.message}
					<p class="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
						{form.message}
					</p>
				{/if}

				<Button type="submit" variant="primary" class="w-full justify-center">
					Continue
				</Button>
			</form>
		</Card>
	</div>
{:else}
	<div class="flex min-h-screen items-center justify-center bg-[#f4f1eb] px-4 py-10">
		<Card class="w-full max-w-lg border-black/10 bg-white p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
			<p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
				{data.organisationName ? `Shared by ${sharingOrganisationName}` : 'Resume share'}
			</p>
			<h1 class="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{errorTitle}</h1>
			<p class="mx-auto mt-3 max-w-md text-sm text-slate-600">{errorDescription}</p>
		</Card>
	</div>
{/if}
