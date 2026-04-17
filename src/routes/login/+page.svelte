<script lang="ts">
	import LoginForm from '$lib/components/login-form/login-form.svelte';
	import { page } from '$app/stores';

	const { form } = $props();

	const redirectTo = $derived($page.url.searchParams.get('redirect'));
	const microsoftError = $derived.by(() => {
		switch ($page.url.searchParams.get('microsoft_error')) {
			case 'missing_oauth_code':
			case 'microsoft_oauth_failed':
				return 'Microsoft sign-in failed. Please try again.';
			case 'server_not_configured':
				return 'Microsoft sign-in is not configured yet.';
			case 'missing_email':
				return 'Microsoft did not return an email address for this account.';
			case 'unverified_email':
				return 'Your Microsoft email must be verified before you can sign in.';
			case 'inactive':
				return 'Account is inactive. Contact an administrator.';
			case 'unauthorized_domain':
				return 'Your Microsoft email domain is not allowed for this application.';
			case 'not_microsoft':
				return 'This sign-in did not return a Microsoft identity.';
			default:
				return null;
		}
	});
</script>

<div class="bg-background text-foreground flex min-h-screen items-center justify-center px-4 py-12">
	<LoginForm {form} {redirectTo} oauthMessage={microsoftError} />
</div>
