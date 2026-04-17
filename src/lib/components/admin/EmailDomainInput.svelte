<script lang="ts">
	import { X } from 'lucide-svelte';

	const DOMAIN_PATTERN =
		/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

	let {
		domains = $bindable([]),
		name = 'email_domains'
	}: {
		domains: string[];
		name?: string;
	} = $props();

	let inputValue = $state('');
	let error = $state('');

	const normalizeDomain = (raw: string) =>
		raw.trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, '');

	const addDomain = () => {
		error = '';
		const domain = normalizeDomain(inputValue);
		if (!domain) return;

		if (!DOMAIN_PATTERN.test(domain)) {
			error = `"${domain}" is not a valid domain. Use a value like example.com.`;
			return;
		}

		if (domains.includes(domain)) {
			error = `"${domain}" is already added.`;
			inputValue = '';
			return;
		}

		domains = [...domains, domain];
		inputValue = '';
	};

	const removeDomain = (domain: string) => {
		domains = domains.filter((d) => d !== domain);
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			addDomain();
		}
	};
</script>

<div class="flex flex-col gap-2">
	<div class="flex gap-2">
		<input
			type="text"
			bind:value={inputValue}
			onkeydown={handleKeydown}
			placeholder="example.com"
			class="border-border bg-input text-foreground min-w-0 flex-1 rounded border p-2.5 text-sm"
		/>
		<button
			type="button"
			onclick={addDomain}
			class="bg-primary text-primary-fg hover:bg-primary/90 shrink-0 rounded px-3 text-sm font-medium transition-colors"
		>
			Add
		</button>
	</div>

	{#if error}
		<p class="text-sm text-rose-600">{error}</p>
	{/if}

	{#if domains.length > 0}
		<div class="flex flex-wrap gap-2">
			{#each domains as domain (domain)}
				<span
					class="bg-muted text-foreground inline-flex items-center gap-1 rounded-full py-1 pl-3 pr-1.5 text-sm"
				>
					{domain}
					<button
						type="button"
						onclick={() => removeDomain(domain)}
						class="text-muted-fg hover:text-foreground rounded-full p-0.5 transition-colors"
						aria-label={`Remove ${domain}`}
					>
						<X size={14} />
					</button>
				</span>
			{/each}
		</div>
	{/if}

	<!-- Hidden inputs so form submission includes all domains -->
	{#each domains as domain (domain)}
		<input type="hidden" {name} value={domain} />
	{/each}
</div>
