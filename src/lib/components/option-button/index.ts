import { tv, type VariantProps } from 'tailwind-variants';
import type { Icon as IconType } from 'lucide-svelte';
import Root from './OptionButton.svelte';

export const optionButtonGroupVariants = tv({
	base: 'flex w-full items-stretch gap-1 rounded-sm border p-1 focus-within:outline-1 outline-offset-4 outline-border',
	variants: {
		variant: {
			default: 'border-border bg-input',
			outline: 'border-border bg-background'
		},
		error: {
			true: 'border-destructive',
			false: ''
		}
	},
	defaultVariants: {
		variant: 'default',
		error: false
	}
});

export const optionButtonItemVariants = tv({
	base: 'relative isolate inline-flex min-w-0 flex-1 cursor-pointer select-none items-center justify-center rounded-sm px-3 font-medium transition-all active:scale-[.98] focus-visible:outline-1 outline-offset-2 outline-border disabled:cursor-not-allowed',
	variants: {
		size: {
			lg: 'min-h-11 text-sm',
			md: 'min-h-10 text-sm',
			sm: 'min-h-9 text-xs'
		},
		selected: {
			true: 'bg-primary text-primary-fg shadow-sm',
			false: 'text-foreground hover:bg-muted'
		},
		disabled: {
			true: 'text-muted-fg hover:bg-transparent',
			false: ''
		},
		described: {
			true: 'py-2',
			false: ''
		}
	},
	defaultVariants: {
		size: 'md',
		selected: false,
		disabled: false,
		described: false
	}
});

export type OptionButtonOptionValue = string | number | boolean;

export type OptionButtonOption<T = string> = {
	label: string;
	value: T;
	icon?: typeof IconType;
	description?: string;
	disabled?: boolean;
};

export type OptionButtonVariant = VariantProps<typeof optionButtonGroupVariants>['variant'];
export type OptionButtonSize = VariantProps<typeof optionButtonItemVariants>['size'];

export { Root as OptionButton };
