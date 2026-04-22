import { json, type RequestHandler } from '@sveltejs/kit';
import { assertAcceptedForSensitiveAction } from '$lib/server/legalGate';
import {
	assignTalentLabel,
	removeTalentLabel,
	TalentLabelServiceError
} from '$lib/server/talentLabels';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const parsePayload = (value: unknown) => {
	if (!isRecord(value)) {
		return { ok: false as const, message: 'Invalid payload.' };
	}

	const talentId = typeof value.talentId === 'string' ? value.talentId.trim() : '';
	const labelDefinitionId =
		typeof value.labelDefinitionId === 'string' ? value.labelDefinitionId.trim() : '';
	const action = value.action === 'assign' || value.action === 'remove' ? value.action : null;

	if (!talentId) return { ok: false as const, message: 'Invalid talent id.' };
	if (!labelDefinitionId) return { ok: false as const, message: 'Invalid label id.' };
	if (!action) return { ok: false as const, message: 'Invalid label action.' };

	return {
		ok: true as const,
		payload: {
			talentId,
			labelDefinitionId,
			action
		}
	};
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!adminClient || !actor.userId) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Invalid JSON payload.' }, { status: 400 });
	}

	const parsed = parsePayload(body);
	if (!parsed.ok) {
		return json({ message: parsed.message }, { status: 400 });
	}

	try {
		await assertAcceptedForSensitiveAction({
			adminClient,
			userId: actor.userId,
			homeOrganisationId: actor.homeOrganisationId
		});
	} catch (legalError) {
		const status =
			typeof legalError === 'object' &&
			legalError !== null &&
			'status' in legalError &&
			typeof (legalError as { status?: unknown }).status === 'number'
				? ((legalError as { status: number }).status ?? 403)
				: 403;
		return json(
			{
				message:
					legalError instanceof Error
						? legalError.message
						: 'You must accept the latest legal documents before continuing.'
			},
			{ status }
		);
	}

	try {
		const labels =
			parsed.payload.action === 'assign'
				? await assignTalentLabel({
						adminClient,
						actor,
						talentId: parsed.payload.talentId,
						labelDefinitionId: parsed.payload.labelDefinitionId
					})
				: await removeTalentLabel({
						adminClient,
						actor,
						talentId: parsed.payload.talentId,
						labelDefinitionId: parsed.payload.labelDefinitionId
					});

		return json({
			ok: true,
			talentId: parsed.payload.talentId,
			labels
		});
	} catch (actionError) {
		const status = actionError instanceof TalentLabelServiceError ? actionError.status : 500;
		return json(
			{
				message:
					actionError instanceof Error
						? actionError.message
						: 'Could not update talent labels.'
			},
			{ status }
		);
	}
};
