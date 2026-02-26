import OpenAI from 'openai';
const apiKey = process.env.OPENAI_API_KEY?.trim();

if (!apiKey) {
	throw new Error('OPENAI_API_KEY is required.');
}

const resolvedModel = (process.env.LLM_MODEL?.trim() || 'gpt-4o-mini') as string;
const resolvedPdfImportModel = (process.env.LLM_MODEL_PDF_IMPORT?.trim() ||
	resolvedModel) as string;
const debugLoggingEnabled =
	process.env.OPENAI_DEBUG === 'true' || process.env.NODE_ENV !== 'production';

const maskApiKey = (value: string): string => {
	if (value.length <= 16) return value;
	return `${value.slice(0, 10)}...${value.slice(-6)}`;
};

export const openai = new OpenAI({
	apiKey
});

export const getModel = (): string => resolvedModel;
export const getPdfImportModel = (): string => resolvedPdfImportModel;

if (debugLoggingEnabled) {
	console.info('[openai] initialized', {
		model: resolvedModel,
		pdfImportModel: resolvedPdfImportModel,
		apiKey: maskApiKey(apiKey)
	});
}
