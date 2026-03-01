import { untrack } from 'svelte';

export type SuperListHead<T = NonNullable<unknown>> = {
	heading: string | null;
	sortable?: keyof T;
	filterable?: keyof T;
	width?: number;
};

export type SuperListData<D> = {
	_filterString: string;
} & D;

export class ListHandler<D> {
	headings: SuperListHead<D>[] = $state([]);
	initData: SuperListData<D>[] = $state([]);
	activeSortedProp: string | undefined = $state(undefined);
	isAscending: boolean = $state(true);
	hasFilterableRows: boolean = $state(false);
	query: string = $state('');

	#filterableProps: (keyof D)[] = [];

	#getNestedProp(obj: Record<string, unknown>, path: string): unknown {
		return path.split('.').reduce<unknown>((acc, part) => {
			if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
				return (acc as Record<string, unknown>)[part];
			}
			return undefined;
		}, obj);
	}

	readonly data: SuperListData<D>[] = $derived.by(() => {
		if (this.query) {
			return this.initData.filter((row) => {
				return row._filterString.includes(this.query.toLocaleLowerCase());
			});
		} else {
			return this.initData;
		}
	});

	#setupFilterStrings(headings: SuperListHead<D>[], data: SuperListData<D>[]) {
		headings.forEach((heading) => {
			if (heading.filterable) {
				this.#filterableProps.push(heading.filterable);
			}
		});

		data.forEach((row) => {
			const filterString: string[] = [];
			this.#filterableProps.forEach((prop) => {
				const value = this.#getNestedProp(
					row as unknown as Record<string, unknown>,
					prop as string
				);
				if (typeof value === 'string') {
					filterString.push(value);
				} else if (value != null) {
					filterString.push(String(value));
				}
			});
			row._filterString = filterString.join(' ').toLocaleLowerCase();
		});
	}

	constructor(headings: SuperListHead<D>[], data: D[]) {
		const listData: SuperListData<D>[] = data.map((d) => ({
			...d,
			_filterString: ''
		}));

		this.#setupFilterStrings(headings, listData);
		this.headings = headings;
		this.initData = listData;
		this.hasFilterableRows = untrack(() => this.headings).some((h) => h.filterable);
	}

	sort(prop: string) {
		if (this.activeSortedProp === prop) {
			this.isAscending = !this.isAscending;
		} else {
			this.activeSortedProp = prop;
			this.isAscending = true;
		}

		this.initData.sort((a, b) => {
			const aValue = this.#getNestedProp(a as unknown as Record<string, unknown>, prop);
			const bValue = this.#getNestedProp(b as unknown as Record<string, unknown>, prop);

			const aStr = aValue == null ? '' : String(aValue);
			const bStr = bValue == null ? '' : String(bValue);

			const compared = aStr.localeCompare(bStr, undefined, { sensitivity: 'base', numeric: true });
			return this.isAscending ? compared : -compared;
		});
	}
}
