let NOISE_DATA_URL: string | null = null;

function getNoiseDataURL(size = 64): string {
	if (NOISE_DATA_URL) return NOISE_DATA_URL;

	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;

	const context = canvas.getContext('2d');
	if (!context) return '';

	const image = context.createImageData(size, size);
	const { data } = image;

	for (let index = 0; index < data.length; index += 4) {
		const value = Math.floor(Math.random() * 256);
		data[index] = value;
		data[index + 1] = value;
		data[index + 2] = value;
		data[index + 3] = 255;
	}

	context.putImageData(image, 0, 0);
	NOISE_DATA_URL = canvas.toDataURL('image/png');
	return NOISE_DATA_URL;
}

export type RippleOptions = {
	color?: string;
	opacity?: number;
	duration?: number;
	easing?: string;
	centered?: boolean;
	radius?: number;
	disabled?: boolean;
	grain?: boolean;
	grainOpacity?: number;
	grainScale?: number;
	grainBlendMode?: string;
};

export function ripple(node: HTMLElement, opts: RippleOptions = {}) {
	let options: RippleOptions = {
		color: 'currentColor',
		opacity: 0.18,
		duration: 800,
		easing: 'cubic-bezier(0.2, 0, 0, 1)',
		centered: false,
		grain: false,
		grainOpacity: 0.35,
		grainScale: 100,
		grainBlendMode: 'overlay',
		...opts
	};

	const originalPosition = getComputedStyle(node).position;
	const needsPositionFix = originalPosition === 'static';
	if (needsPositionFix) node.style.position = 'relative';

	const originalOverflow = node.style.overflow;
	if (originalOverflow !== 'hidden') node.style.overflow = 'hidden';

	function createRipple(x: number, y: number) {
		if (options.disabled) return;
		if ((node as HTMLButtonElement).disabled) return;

		const rect = node.getBoundingClientRect();
		const localX = options.centered ? rect.width / 2 : x - rect.left;
		const localY = options.centered ? rect.height / 2 : y - rect.top;

		const maxX = Math.max(localX, rect.width - localX);
		const maxY = Math.max(localY, rect.height - localY);
		const defaultRadius = Math.sqrt(maxX * maxX + maxY * maxY);
		const radius = options.radius ?? defaultRadius;

		const rippleElement = document.createElement('span');
		rippleElement.style.position = 'absolute';
		rippleElement.style.left = `${localX - radius}px`;
		rippleElement.style.top = `${localY - radius}px`;
		rippleElement.style.width = `${radius * 2}px`;
		rippleElement.style.height = `${radius * 2}px`;
		rippleElement.style.borderRadius = '50%';
		rippleElement.style.pointerEvents = 'none';
		rippleElement.style.background = options.color ?? 'currentColor';
		rippleElement.style.opacity = String(options.opacity ?? 0.18);
		rippleElement.style.transform = 'scale(0)';
		rippleElement.style.willChange = 'transform, opacity';
		rippleElement.style.zIndex = '0';
		node.appendChild(rippleElement);

		if (options.grain) {
			const noiseElement = document.createElement('span');
			noiseElement.style.position = 'absolute';
			noiseElement.style.inset = '0';
			noiseElement.style.pointerEvents = 'none';
			noiseElement.style.backgroundImage = `url(${getNoiseDataURL()})`;
			noiseElement.style.backgroundRepeat = 'repeat';
			noiseElement.style.backgroundSize = `${options.grainScale}% ${options.grainScale}%`;
			noiseElement.style.opacity = String(options.grainOpacity);
			noiseElement.style.mixBlendMode = options.grainBlendMode || 'overlay';
			rippleElement.appendChild(noiseElement);
		}

		const animation = rippleElement.animate(
			[
				{ transform: 'scale(0)', opacity: options.opacity ?? 0.18 },
				{ transform: 'scale(1)', opacity: 0 }
			],
			{
				duration: options.duration ?? 800,
				easing: options.easing ?? 'cubic-bezier(0.2, 0, 0, 1)',
				fill: 'forwards'
			}
		);

		animation.onfinish = () => rippleElement.remove();
		animation.oncancel = () => rippleElement.remove();
	}

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		createRipple(event.clientX, event.clientY);
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		const rect = node.getBoundingClientRect();
		createRipple(rect.left + rect.width / 2, rect.top + rect.height / 2);
	}

	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('keydown', onKeyDown);

	return {
		update(newOpts: RippleOptions = {}) {
			options = { ...options, ...newOpts };
		},
		destroy() {
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('keydown', onKeyDown);
			if (needsPositionFix) node.style.position = '';
			if (originalOverflow !== 'hidden') node.style.overflow = originalOverflow;
		}
	};
}
