import { tv, type VariantProps } from 'tailwind-variants';
import type { Icon as IconType } from 'lucide-svelte';
import Root from './Dropdown.svelte';

export const dropdownButtonVariants = tv({
	base: 'group relative isolate flex w-full items-center justify-between rounded-sm border px-3 py-2 text-left transition-colors focus-visible:outline-1 outline-offset-4 outline-border',
	variants: {
		variant: {
			default:
				'bg-input border-border text-foreground hover:bg-muted disabled:bg-muted disabled:text-muted-fg disabled:cursor-not-allowed',
			outline:
				'bg-background border-border text-foreground hover:bg-muted disabled:bg-muted disabled:text-muted-fg disabled:cursor-not-allowed'
		},
		size: {
			xxl: 'h-14 text-lg',
			xl: 'h-12 text-base',
			lg: 'h-11 text-base',
			md: 'h-10 text-sm',
			sm: 'h-9 text-sm',
			xs: 'h-8 text-xs'
		},
		open: {
			true: 'bg-muted',
			false: ''
		},
		error: {
			true: 'border-destructive',
			false: ''
		}
	},
	defaultVariants: {
		variant: 'default',
		size: 'md',
		open: false,
		error: false
	}
});

export const dropdownListVariants = tv({
	base: 'absolute z-50 max-h-60 w-full overflow-auto rounded-sm border border-border bg-background shadow-md',
	variants: {
		position: {
			up: 'bottom-full mb-1',
			down: 'top-full mt-1'
		}
	},
	defaultVariants: {
		position: 'down'
	}
});

export const dropdownItemVariants = tv({
	base: 'relative isolate flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted focus:bg-muted focus:outline-none',
	variants: {
		active: {
			true: 'bg-muted',
			false: ''
		},
		unavailable: {
			true: 'text-destructive',
			false: 'text-foreground'
		},
		selected: {
			true: 'bg-muted/50',
			false: ''
		}
	},
	defaultVariants: {
		active: false,
		unavailable: false,
		selected: false
	}
});

export type DropdownOption<T = string> =
	| string
	| {
			label: string;
			value: T;
			unavailable?: boolean;
			icon?: typeof IconType;
			icons?: (typeof IconType | { icon: typeof IconType; size?: number })[];
			iconSize?: number;
	  };

export type DropdownVariant = VariantProps<typeof dropdownButtonVariants>['variant'];
export type DropdownSize = VariantProps<typeof dropdownButtonVariants>['size'];
export type DropdownPosition = VariantProps<typeof dropdownListVariants>['position'];

export { Root as Dropdown };
