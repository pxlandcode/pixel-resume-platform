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

export type TooltipOptions =
	| string
	| {
			text: string;
			position?: TooltipPosition;
			backgroundColor?: string;
			textColor?: string;
			openOnClick?: boolean;
	  };

function resolveOptions(options: TooltipOptions) {
	if (typeof options === 'string') {
		return { text: options, position: 'bottom' as TooltipPosition, openOnClick: true };
	}
	return {
		text: options.text,
		position: options.position ?? 'bottom',
		backgroundColor: options.backgroundColor,
		textColor: options.textColor,
		openOnClick: options.openOnClick ?? true
	};
}

export function tooltip(node: HTMLElement, options: TooltipOptions) {
	let { text, position, backgroundColor, textColor, openOnClick } = resolveOptions(options);
	let el: HTMLDivElement | null = null;
	let arrow: HTMLDivElement | null = null;
	let pinnedByClick = false;
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
			} else if (position === 'left' && spaceLeft < ttRect.width + gap && spaceRight > spaceLeft) {
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

	const handleDocumentPointerDown = (event: PointerEvent) => {
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (node.contains(target) || el?.contains(target)) return;

		pinnedByClick = false;
		hide(true);
	};

	const applyTooltipColors = () => {
		if (!el) return;

		const styles = window.getComputedStyle(node);
		const nodeBackground = styles.getPropertyValue('--tooltip-bg').trim();
		const nodeText = styles.getPropertyValue('--tooltip-fg').trim();
		const resolvedBackground = nodeBackground || backgroundColor;
		const resolvedText = nodeText || textColor;

		if (resolvedBackground) {
			el.style.setProperty('--app-tooltip-bg', resolvedBackground);
		} else {
			el.style.removeProperty('--app-tooltip-bg');
		}

		if (resolvedText) {
			el.style.setProperty('--app-tooltip-fg', resolvedText);
		} else {
			el.style.removeProperty('--app-tooltip-fg');
		}
	};

	const show = (pin = false) => {
		if (!text) return;
		if (pin) pinnedByClick = true;
		if (el) {
			positionTooltip();
			return;
		}

		el = document.createElement('div');
		el.className = 'app-tooltip';
		el.style.visibility = 'hidden';
		el.textContent = text;
		applyTooltipColors();

		arrow = document.createElement('div');
		arrow.className = 'app-tooltip__arrow';
		el.appendChild(arrow);

		document.body.appendChild(el);
		window.addEventListener('scroll', handleViewportChange, true);
		window.addEventListener('resize', handleViewportChange);
		document.addEventListener('pointerdown', handleDocumentPointerDown, true);

		// Force a layout pass so getBoundingClientRect returns the real size
		void el.offsetHeight;

		positionTooltip();
		el.style.visibility = '';
	};

	const hide = (force = false) => {
		if (pinnedByClick && !force) return;

		window.removeEventListener('scroll', handleViewportChange, true);
		window.removeEventListener('resize', handleViewportChange);
		document.removeEventListener('pointerdown', handleDocumentPointerDown, true);

		if (el) {
			el.remove();
			el = null;
			arrow = null;
		}
	};

	const handleMouseEnter = () => show();
	const handleMouseLeave = () => hide();
	const handleFocus = () => show();
	const handleBlur = () => hide();
	const handleClick = () => {
		if (!openOnClick) return;
		show(true);
	};

	node.addEventListener('mouseenter', handleMouseEnter);
	node.addEventListener('mouseleave', handleMouseLeave);
	node.addEventListener('focus', handleFocus);
	node.addEventListener('blur', handleBlur);
	node.addEventListener('click', handleClick);

	return {
		update(newOptions: TooltipOptions) {
			({ text, position, backgroundColor, textColor, openOnClick } = resolveOptions(newOptions));
			if (!text) {
				pinnedByClick = false;
				hide(true);
				return;
			}

			if (el) {
				el.textContent = text;
				applyTooltipColors();
				if (!arrow) {
					arrow = document.createElement('div');
				}
				arrow.className = 'app-tooltip__arrow';
				el.appendChild(arrow);
				positionTooltip();
			}
		},
		destroy() {
			pinnedByClick = false;
			hide(true);
			node.removeEventListener('mouseenter', handleMouseEnter);
			node.removeEventListener('mouseleave', handleMouseLeave);
			node.removeEventListener('focus', handleFocus);
			node.removeEventListener('blur', handleBlur);
			node.removeEventListener('click', handleClick);
		}
	};
}
