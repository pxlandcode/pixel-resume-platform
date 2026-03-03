import type { Handle } from '@sveltejs/kit';
import { createRequestContext } from '$lib/server/requestContext';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestContext = createRequestContext(event.cookies);
	return resolve(event);
};
