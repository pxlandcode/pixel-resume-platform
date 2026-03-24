import { tv } from 'tailwind-variants';
import Root from './ResumeFreeTextSearchInput.svelte';

export const resumeFreeTextSearchRootVariants = tv({
	base: 'relative flex w-full flex-col gap-2'
});

export const resumeFreeTextSearchFieldVariants = tv({
	base: 'border-border bg-input outline-border text-foreground w-full rounded-sm border text-sm transition-[height,padding,box-shadow] duration-250 ease-out focus-visible:outline-1 outline-offset-4 disabled:bg-muted disabled:text-muted-fg disabled:cursor-not-allowed',
	variants: {
		expanded: {
			true: 'h-40 min-h-40 max-w-full resize-y overflow-auto px-10 py-3 shadow-sm',
			false: 'h-md min-h-0 resize-none overflow-hidden px-10 py-2.5'
		},
		loading: {
			true: 'pr-28',
			false: 'pr-24'
		}
	},
	defaultVariants: {
		expanded: false,
		loading: false
	}
});

export const resumeFreeTextSearchIconVariants = tv({
	base: 'pointer-events-none absolute left-3 top-3 z-10 text-border',
	variants: {
		expanded: {
			true: '',
			false: ''
		}
	},
	defaultVariants: {
		expanded: false
	}
});

export const resumeFreeTextSearchTrailingVariants = tv({
	base: 'absolute right-2 top-2 z-10 flex items-center gap-2',
	variants: {
		expanded: {
			true: '',
			false: ''
		}
	},
	defaultVariants: {
		expanded: false
	}
});

export { Root as ResumeFreeTextSearchInput };
