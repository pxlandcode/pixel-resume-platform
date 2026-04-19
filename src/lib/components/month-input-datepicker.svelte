<script lang="ts">
	import AirDatepicker from 'air-datepicker';
	import localeSv from 'air-datepicker/locale/sv';
	import { Input } from '@pixelcode_/blocks/components';
	import { Calendar } from 'lucide-svelte';

	type Props = {
		id?: string;
		name?: string;
		value?: string;
		placeholder?: string;
		class?: string;
		debugLabel: string;
		onMonthSelect?: (value: string, picker: AirDatepicker<HTMLInputElement>) => void;
		onPickerHide?: (isAnimationComplete: boolean, picker: AirDatepicker<HTMLInputElement>) => void;
	};

	let {
		id,
		name,
		value = $bindable(''),
		placeholder = 'YYYY-MM',
		class: className,
		debugLabel,
		onMonthSelect,
		onPickerHide
	}: Props = $props();

	let input = $state<HTMLInputElement | undefined>();
	let container = $state<HTMLDivElement | undefined>();
	let picker = $state<AirDatepicker<HTMLInputElement> | null>(null);

	const parseMonthValue = (month: string) => new Date(`${month}-01T00:00:00`);
	const getSelectedMonth = (instance: AirDatepicker<HTMLInputElement>) => {
		const selectedDate = instance.selectedDates[0];
		return selectedDate instanceof Date ? instance.formatDate(selectedDate, 'yyyy-MM') : null;
	};
	const log = (event: string, details?: Record<string, unknown>) => {
		console.debug(`[billing-month-picker:${debugLabel}] ${event}`, details ?? {});
	};

	$effect(() => {
		if (!input || !container) return;

		const instance = new AirDatepicker(input, {
			view: 'months',
			minView: 'months',
			dateFormat: 'yyyy-MM',
			autoClose: false,
			locale: localeSv,
			position: 'bottom left',
			container,
			selectedDates: input.value ? [parseMonthValue(input.value)] : [],
			onShow(isAnimationComplete) {
				log('onShow', {
					isAnimationComplete,
					inputValue: input?.value ?? ''
				});
			},
			onSelect({ formattedDate, datepicker }) {
				const nextValue = Array.isArray(formattedDate) ? formattedDate[0] ?? '' : formattedDate;
				log('onSelect', {
					nextValue,
					selectedMonth: getSelectedMonth(datepicker as AirDatepicker<HTMLInputElement>)
				});
				value = nextValue;
				onMonthSelect?.(nextValue, datepicker as AirDatepicker<HTMLInputElement>);
				setTimeout(() => {
					if (picker !== instance || !instance.visible) return;
					log('manual-hide-after-select', {
						nextValue
					});
					instance.hide();
				});
			},
			onHide(isAnimationComplete) {
				log('onHide', {
					isAnimationComplete,
					value,
					selectedMonth: getSelectedMonth(instance)
				});
				onPickerHide?.(isAnimationComplete, instance);
			}
		});

		picker = instance;
		log('init', {
			inputValue: input.value
		});

		return () => {
			log('destroy', {
				value,
				selectedMonth: getSelectedMonth(instance)
			});
			if (picker === instance) {
				picker = null;
			}
			instance.destroy();
		};
	});

	$effect(() => {
		const instance = picker;
		if (!instance) return;

		if (!value) {
			if (instance.selectedDates.length > 0) {
				log('sync-clear');
				void instance.clear({ silent: true });
			}
			return;
		}

		const currentSelectedMonth = getSelectedMonth(instance);
		if (currentSelectedMonth !== value) {
			log('sync-selectDate', {
				from: currentSelectedMonth,
				to: value
			});
			void instance.selectDate(parseMonthValue(value), { silent: true });
		}
	});
</script>

<Input
	bind:node={input}
	bind:value
	{id}
	{name}
	icon={Calendar}
	class={className}
	readonly
	{placeholder}
/>
<div bind:this={container}></div>
