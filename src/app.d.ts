// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { RequestContext } from '$lib/server/requestContext';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			requestContext: RequestContext;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};

declare module 'https://cdn.skypack.dev/quill@1.3.7?min' {
	const Quill: unknown;
	export default Quill;
}
