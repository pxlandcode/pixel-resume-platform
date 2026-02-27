<script lang="ts">
	import X from 'lucide-svelte/icons/x';
	import type { Snippet } from 'svelte';
	import { expoInOut } from 'svelte/easing';
	import type { HTMLAttributes } from 'svelte/elements';
	import { fly, type FlyParams, type TransitionConfig } from 'svelte/transition';
	import { tv } from 'tailwind-variants';
	import type { ClassNameValue } from 'tailwind-merge';
	import { cn } from '@pixelcode_/blocks/utils';

	type DrawerVariant = 'left' | 'right' | 'top' | 'bottom' | 'modal';

	type Props = {
		children: Snippet;
		open: boolean;
		variant?: DrawerVariant;
		class?: ClassNameValue;
		title?: string;
		subtitle?: string;
		dismissable?: boolean;
		beforeClose?: () => boolean | Promise<boolean>;
	};

	const drawerVariants = tv({
		base: 'text-fg m-auto max-w-full bg-transparent animate-dialog-backdrop backdrop:animate-dialog-backdrop',
		variants: {
			variant: {
				right: 'mr-0 h-[100dvh] max-h-[100dvh] w-1/3',
				left: 'ml-0 h-[100dvh] max-h-[100dvh] w-1/3',
				top: 'mt-0 w-full',
				bottom: 'mb-0 w-full max-h-[92vh]',
				modal: 'w-full md:w-2/3'
			}
		}
	});

	const drawerContainerVariants = tv({
		base: 'flex min-h-0 w-full flex-col overscroll-contain bg-background p-8',
		variants: {
			variant: {
				right: 'h-full max-h-full overflow-hidden pt-8',
				left: 'h-full max-h-full overflow-hidden pt-8',
				top: '',
				bottom: 'max-h-[92vh] overflow-hidden',
				modal: 'max-h-[90vh] overflow-y-hidden'
			}
		}
	});

	let {
		children,
		class: className,
		title = '',
		subtitle,
		variant = 'modal' as DrawerVariant,
		open = $bindable(false),
		beforeClose,
		dismissable = true,
		...rest
	}: Props & HTMLAttributes<HTMLDialogElement> = $props();

	const transitionConfig: TransitionConfig = $derived.by(() => {
		const base: FlyParams = {
			duration: open ? 500 : 200,
			easing: expoInOut,
			opacity: 0.2
		};

		if (variant === 'right') base.x = '100%';
		if (variant === 'left') base.x = '-100%';
		if (variant === 'top') base.y = '-100%';
		if (variant === 'bottom') base.y = '100%';
		if (variant === 'modal') base.y = '200%';

		return base;
	});

	let dialog: HTMLDialogElement | undefined = $state();
	let container = $state<HTMLDivElement | null>(null);
	let pointerDownInside = $state(false);

	function handleClickOutside(event: MouseEvent) {
		// Only close when the interaction both starts and ends on the backdrop.
		if (!pointerDownInside && event.target === event.currentTarget) {
			void requestClose('outside');
		}
	}

	const requestClose = async (reason: 'button' | 'outside' | 'escape' = 'button') => {
		if ((reason === 'outside' || reason === 'escape') && !dismissable) {
			return;
		}

		const shouldClose = beforeClose ? await beforeClose() : true;
		if (shouldClose) {
			open = false;
		}
	};

	// Sync dialog state with `open`.
	$effect(() => {
		if (!dialog || !dialog.isConnected) return;

		if (open && !dialog.open) {
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	// Prevent background scrolling when open.
	$effect(() => {
		if (typeof document === 'undefined') return;
		if (!open) return;

		const prevBodyOverflow = document.body.style.overflow;
		const prevHtmlOverflow = document.documentElement.style.overflow;
		const prevPosition = document.body.style.position;
		const prevTop = document.body.style.top;
		const prevWidth = document.body.style.width;
		const scrollY = window.scrollY;

		document.body.style.overflow = 'hidden';
		document.documentElement.style.overflow = 'hidden';
		document.body.style.position = 'fixed';
		document.body.style.top = `-${scrollY}px`;
		document.body.style.width = '100%';

		return () => {
			document.body.style.overflow = prevBodyOverflow;
			document.documentElement.style.overflow = prevHtmlOverflow;
			document.body.style.position = prevPosition;
			document.body.style.top = prevTop;
			document.body.style.width = prevWidth;
			window.scrollTo(0, scrollY);
		};
	});
</script>

{#key open}
	<dialog
		onpointerdown={(event) => {
			pointerDownInside = container ? container.contains(event.target as Node) : false;
		}}
		transition:fly={transitionConfig}
		data-open={open}
		class={cn(drawerVariants({ variant, className }), 'overflow-hidden')}
		onclick={handleClickOutside}
		oncancel={(e) => {
			e.preventDefault();
			void requestClose('escape');
		}}
		bind:this={dialog}
		{...rest}
	>
		<div class={cn(drawerContainerVariants({ variant }))} bind:this={container}>
			<div class="flex min-h-0 flex-1 flex-col">
				<div class="flex items-start justify-between">
					<h2 class="text-foreground flex-1 text-2xl font-semibold tracking-tight">{title}</h2>
					<button type="button" onclick={() => void requestClose('button')} aria-label="Close">
						<X class="text-foreground" />
					</button>
				</div>

				{#if subtitle}
					<p class="text-muted-fg tracking-tight">{subtitle}</p>
				{/if}

				<div class="text-foreground relative mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
						<div
							class="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-background via-background/85 to-transparent"
						></div>
					<div class="flex min-h-0 flex-1 flex-col overflow-y-auto pt-4">
						{@render children()}
					</div>
				</div>
			</div>
		</div>
	</dialog>
{/key}
