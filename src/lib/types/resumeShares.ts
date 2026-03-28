export type ResumeShareStatus = 'active' | 'expiring_soon' | 'expired' | 'revoked';

export type ResumeShareAccessMode = 'link' | 'password';

export type ResumeShareLanguageMode = 'sv' | 'en' | 'both';

export type ResumeShareEventOutcome =
	| 'success'
	| 'invalid_token'
	| 'wrong_password'
	| 'expired'
	| 'revoked'
	| 'rate_limited';

export type ResumeShareLink = {
	id: string;
	organisationId: string;
	talentId: string;
	resumeId: string;
	createdByUserId: string;
	label: string | null;
	isAnonymized: boolean;
	accessMode: ResumeShareAccessMode;
	languageMode: ResumeShareLanguageMode;
	expiresAt: string | null;
	allowDownload: boolean;
	contactName: string | null;
	contactEmail: string | null;
	contactPhone: string | null;
	contactNote: string | null;
	status: ResumeShareStatus;
	totalRequestCount: number;
	successfulViewCount: number;
	downloadCount: number;
	firstViewedAt: string | null;
	lastViewedAt: string | null;
	createdAt: string;
	updatedAt: string;
	revokedAt: string | null;
	shareUrl: string;
	tokenHint: string;
	talentName: string;
	resumeTitle: string;
	createdByName: string;
	passwordProtected: boolean;
};

export type ResumeShareEvent = {
	id: number;
	shareLinkId: string | null;
	occurredAt: string;
	outcome: ResumeShareEventOutcome;
	userAgent: string | null;
	referrerUrlSanitized: string | null;
	downloadTriggered: boolean;
};

export type ManagedResumeShareLink = ResumeShareLink & {
	events: ResumeShareEvent[];
};
