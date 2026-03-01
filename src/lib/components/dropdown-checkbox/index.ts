import Root from './DropdownCheckbox.svelte';
import {
	dropdownButtonVariants,
	dropdownListVariants,
	type DropdownVariant,
	type DropdownSize,
	type DropdownPosition
} from '../dropdown/index.js';

export type DropdownCheckboxOption<T = string> =
	| string
	| {
			label: string;
			value: T;
	  };

export {
	Root as DropdownCheckbox,
	dropdownButtonVariants,
	dropdownListVariants,
	type DropdownVariant,
	type DropdownSize,
	type DropdownPosition
};
