<script lang="ts">
	import { Input } from '@pixelcode_/blocks/components';
	import { normalizeHexColor } from '$lib/branding/theme';

	type Props = {
		id: string;
		name: string;
		label: string;
		value?: string;
		description?: string;
	};

	const FALLBACK_COLOR = '#000000';

	const resolveColor = (input: string | undefined) => normalizeHexColor(input) ?? FALLBACK_COLOR;

	let { id, name, label, value = FALLBACK_COLOR, description }: Props = $props();

	let color = $state(resolveColor(value));
	let textValue = $state(resolveColor(value));

	$effect(() => {
		const nextColor = resolveColor(value);
		color = nextColor;
		textValue = nextColor;
	});

	const onColorInput = (event: Event) => {
		const target = event.currentTarget as HTMLInputElement | null;
		const next = resolveColor(target?.value);
		color = next;
		textValue = next;
	};

	const onTextInput = (event: Event) => {
		const target = event.currentTarget as HTMLInputElement | null;
		textValue = (target?.value ?? '').toUpperCase();
		const parsed = normalizeHexColor(target?.value);
		if (parsed) color = parsed;
	};

	const onTextBlur = () => {
		const parsed = normalizeHexColor(textValue);
		const committed = parsed ?? color;
		color = committed;
		textValue = committed;
	};
</script>

<div class="space-y-1.5">
	<label for={id} class="text-foreground block text-xs font-medium">{label}</label>
	{#if description}
		<p class="text-muted-fg text-xs">{description}</p>
	{/if}

	<input type="hidden" {name} value={color} />

	<div class="flex items-center gap-2">
		<div class="h-md border-border bg-input w-11 shrink-0 overflow-hidden rounded-sm border p-1">
			<input
				{id}
				type="color"
				value={color}
				oninput={onColorInput}
				class="branding-color-input h-full w-full rounded-sm"
			/>
		</div>
		<Input
			value={textValue}
			oninput={onTextInput}
			onblur={onTextBlur}
			maxlength={7}
			placeholder="#RRGGBB"
			spellcheck={false}
			autocapitalize="off"
			class="font-mono uppercase"
		/>
	</div>
</div>

<style>
	.branding-color-input {
		appearance: none;
		-webkit-appearance: none;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: pointer;
	}

	.branding-color-input::-webkit-color-swatch-wrapper {
		padding: 0;
	}

	.branding-color-input::-webkit-color-swatch {
		border: 0;
		border-radius: 0.125rem;
	}

	.branding-color-input::-moz-color-swatch {
		border: 0;
		border-radius: 0.125rem;
	}
</style>
