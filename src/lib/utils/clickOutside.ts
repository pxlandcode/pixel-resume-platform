export function clickOutside(node: HTMLElement, callback: (event?: MouseEvent) => void) {
	const handleClick = (event: MouseEvent) => {
		// If click is inside the element, do nothing
		if (node.contains(event.target as Node)) return;

		// If click is outside, run the callback
		callback(event);
	};

	// ✅ Attach event listener immediately
	document.addEventListener('click', handleClick, true); // Capture phase

	return {
		destroy() {
			document.removeEventListener('click', handleClick, true);
		}
	};
}
