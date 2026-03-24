/**
 * Universal tooltip Svelte action.
 *
 * Usage:
 *   <button use:tooltip={'Some label'}>…</button>
 *   <span use:tooltip={{ text: 'Hello', position: 'top' }}>…</span>
 *
 * Positions: 'bottom' (default) | 'top' | 'left' | 'right'
 * Bottom/top auto-flip when there isn't enough viewport space.
 */
export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

export type TooltipOptions = string | { text: string; position?: TooltipPosition };

function resolveOptions(options: TooltipOptions) {
	if (typeof options === 'string') return { text: options, position: 'bottom' as TooltipPosition };
	return { text: options.text, position: options.position ?? 'bottom' };
}

export function tooltip(node: HTMLElement, options: TooltipOptions) {
	let { text, position } = resolveOptions(options);
	let el: HTMLDivElement | null = null;
	let arrow: HTMLDivElement | null = null;
	const gap = 8;
	const viewportPadding = 8;
	const arrowInset = 12;

	const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

	const positionTooltip = () => {
		if (!el || !arrow) return;

		const rect = node.getBoundingClientRect();
		const ttRect = el.getBoundingClientRect();
		let resolvedPosition = position;

		if (position === 'bottom' || position === 'top') {
			const spaceBelow = window.innerHeight - rect.bottom;
			const spaceAbove = rect.top;

			if (position === 'bottom' && spaceBelow < ttRect.height + gap && spaceAbove > spaceBelow) {
				resolvedPosition = 'top';
			} else if (
				position === 'top' &&
				spaceAbove < ttRect.height + gap &&
				spaceBelow > spaceAbove
			) {
				resolvedPosition = 'bottom';
			}
		} else {
			const spaceRight = window.innerWidth - rect.right;
			const spaceLeft = rect.left;

			if (position === 'right' && spaceRight < ttRect.width + gap && spaceLeft > spaceRight) {
				resolvedPosition = 'left';
			} else if (
				position === 'left' &&
				spaceLeft < ttRect.width + gap &&
				spaceRight > spaceLeft
			) {
				resolvedPosition = 'right';
			}
		}

		let top = 0;
		let left = 0;
		let arrowX: number | null = null;
		let arrowY: number | null = null;

		switch (resolvedPosition) {
			case 'top': {
				top = rect.top - ttRect.height - gap;
				left = rect.left + rect.width / 2 - ttRect.width / 2;
				left = clamp(left, viewportPadding, window.innerWidth - viewportPadding - ttRect.width);
				arrowX = clamp(rect.left + rect.width / 2 - left, arrowInset, ttRect.width - arrowInset);
				break;
			}
			case 'bottom': {
				top = rect.bottom + gap;
				left = rect.left + rect.width / 2 - ttRect.width / 2;
				left = clamp(left, viewportPadding, window.innerWidth - viewportPadding - ttRect.width);
				arrowX = clamp(rect.left + rect.width / 2 - left, arrowInset, ttRect.width - arrowInset);
				break;
			}
			case 'left': {
				top = rect.top + rect.height / 2 - ttRect.height / 2;
				left = rect.left - ttRect.width - gap;
				top = clamp(top, viewportPadding, window.innerHeight - viewportPadding - ttRect.height);
				arrowY = clamp(rect.top + rect.height / 2 - top, arrowInset, ttRect.height - arrowInset);
				break;
			}
			case 'right': {
				top = rect.top + rect.height / 2 - ttRect.height / 2;
				left = rect.right + gap;
				top = clamp(top, viewportPadding, window.innerHeight - viewportPadding - ttRect.height);
				arrowY = clamp(rect.top + rect.height / 2 - top, arrowInset, ttRect.height - arrowInset);
				break;
			}
		}

		top = clamp(top, viewportPadding, window.innerHeight - viewportPadding - ttRect.height);
		left = clamp(left, viewportPadding, window.innerWidth - viewportPadding - ttRect.width);

		el.className = `app-tooltip app-tooltip--${resolvedPosition}`;
		el.style.top = `${top}px`;
		el.style.left = `${left}px`;

		if (arrowX !== null) {
			el.style.setProperty('--app-tooltip-arrow-x', `${arrowX}px`);
		} else {
			el.style.removeProperty('--app-tooltip-arrow-x');
		}

		if (arrowY !== null) {
			el.style.setProperty('--app-tooltip-arrow-y', `${arrowY}px`);
		} else {
			el.style.removeProperty('--app-tooltip-arrow-y');
		}
	};

	const handleViewportChange = () => {
		positionTooltip();
	};

	const show = () => {
		if (!text || el) return;

		el = document.createElement('div');
		el.className = 'app-tooltip';
		el.style.visibility = 'hidden';
		el.textContent = text;

		arrow = document.createElement('div');
		arrow.className = 'app-tooltip__arrow';
		el.appendChild(arrow);

		document.body.appendChild(el);
		window.addEventListener('scroll', handleViewportChange, true);
		window.addEventListener('resize', handleViewportChange);

		// Force a layout pass so getBoundingClientRect returns the real size
		el.offsetHeight;

		positionTooltip();
		el.style.visibility = '';
	};

	const hide = () => {
		window.removeEventListener('scroll', handleViewportChange, true);
		window.removeEventListener('resize', handleViewportChange);

		if (el) {
			el.remove();
			el = null;
			arrow = null;
		}
	};

	node.addEventListener('mouseenter', show);
	node.addEventListener('mouseleave', hide);
	node.addEventListener('focus', show);
	node.addEventListener('blur', hide);

	return {
		update(newOptions: TooltipOptions) {
			({ text, position } = resolveOptions(newOptions));
			if (!text) {
				hide();
				return;
			}

			if (el) {
				el.textContent = text;
				if (!arrow) {
					arrow = document.createElement('div');
				}
				arrow.className = 'app-tooltip__arrow';
				el.appendChild(arrow);
				positionTooltip();
			}
		},
		destroy() {
			hide();
			node.removeEventListener('mouseenter', show);
			node.removeEventListener('mouseleave', hide);
			node.removeEventListener('focus', show);
			node.removeEventListener('blur', hide);
		}
	};
}
