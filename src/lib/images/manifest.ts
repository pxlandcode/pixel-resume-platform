import { env } from '$env/dynamic/public';
import { imageDefinitionList, type ImageDefinition, type ImageId } from '$lib/images/definitions';

export const SUPABASE_IMAGE_BASE_URL = env.PUBLIC_SUPABASE_IMAGE_BASE_URL?.replace(/\/$/, '');
export const SUPABASE_IMAGE_RENDER_BASE_URL = SUPABASE_IMAGE_BASE_URL
	? SUPABASE_IMAGE_BASE_URL.replace('storage/v1/object/public', 'storage/v1/render/image/public')
	: undefined;

export type SupabaseTransformOptions = {
	width?: number;
	height?: number;
	quality?: number;
	resize?: 'cover' | 'contain' | 'fill';
};

export const buildSupabaseImageSrc = (supabasePath: string, options?: SupabaseTransformOptions) => {
	const encodedPath = encodeURI(supabasePath);

	if (options && SUPABASE_IMAGE_RENDER_BASE_URL) {
		const params = new URLSearchParams();

		if (options.width) params.set('width', String(options.width));
		if (options.height) params.set('height', String(options.height));
		if (options.quality) params.set('quality', String(options.quality));
		if (options.resize) params.set('resize', options.resize);
		const query = params.toString();

		return `${SUPABASE_IMAGE_RENDER_BASE_URL}/${encodedPath}${query ? `?${query}` : ''}`;
	}

	return SUPABASE_IMAGE_BASE_URL ? `${SUPABASE_IMAGE_BASE_URL}/${encodedPath}` : encodedPath;
};

export const imageDefinitions = Object.fromEntries(
	imageDefinitionList.map((definition) => [definition.id, definition])
) as Record<ImageId, ImageDefinition<ImageId>>;

type ImageResource<TId extends ImageId = ImageId> = {
	id: TId;
	src: string;
	alt: string;
	srcset?: string;
	fallbackSrc?: string;
};

export type GalleryImage = ImageResource & {
	text?: string;
};

const DEFAULT_WIDTH = 1280;
const RESPONSIVE_WIDTHS = [320, 480, 640, 768, 1024, DEFAULT_WIDTH] as const;
const DEFAULT_QUALITY = 80;
const DEFAULT_RESIZE_MODE: SupabaseTransformOptions['resize'] = 'contain';
const makeImageResource = <TId extends ImageId>(definition: ImageDefinition<TId>) => {
	const originalSrc = buildSupabaseImageSrc(definition.supabasePath);
	const srcset = SUPABASE_IMAGE_RENDER_BASE_URL
		? RESPONSIVE_WIDTHS.map(
				(width) =>
					// Keep generated images aligned with the gallery's portrait slots
					`${buildSupabaseImageSrc(definition.supabasePath, {
						width,
						quality: DEFAULT_QUALITY,
						resize: DEFAULT_RESIZE_MODE
					})} ${width}w`
			).join(', ')
		: undefined;
	const src =
		srcset && SUPABASE_IMAGE_RENDER_BASE_URL
			? buildSupabaseImageSrc(definition.supabasePath, {
					width: DEFAULT_WIDTH,
					quality: DEFAULT_QUALITY,
					resize: DEFAULT_RESIZE_MODE
				})
			: originalSrc;

	return {
		id: definition.id,
		alt: definition.alt,
		src,
		srcset,
		fallbackSrc: originalSrc
	};
};
export const soloImages = Object.fromEntries(
	imageDefinitionList.map((definition) => [definition.id, makeImageResource(definition)])
) as Record<ImageId, ImageResource>;

export const imageGroups = {
	aboutGallery: [
		{ ...makeImageResource(imageDefinitions.karaoke), text: 'Karaoke Night' },
		{ ...makeImageResource(imageDefinitions.ivoBowling), text: 'Strrriike!' },
		{ ...makeImageResource(imageDefinitions.oliverShuffle), text: 'Shuffleboard Master' },
		{
			...makeImageResource(imageDefinitions.shuffleboardNicklasPhilip),
			text: 'Excitement bubbling over'
		},
		{ ...makeImageResource(imageDefinitions.linusFrisbee), text: 'Discgolf tournament 2024' },
		{ ...makeImageResource(imageDefinitions.pixelChristmas), text: 'Holiday Celebration' },
		{ ...makeImageResource(imageDefinitions.winnerPierre), text: 'Discgolf champion' },
		{ ...makeImageResource(imageDefinitions.pixelEating), text: 'Good food, good vibes!' },
		{ ...makeImageResource(imageDefinitions.weArePixel), text: 'The gang!' },
		{ ...makeImageResource(imageDefinitions.feelingsShuffle), text: 'Feelings running high!' },
		{ ...makeImageResource(imageDefinitions.onboardDanny), text: 'Onboarding box!' },
		{ ...makeImageResource(imageDefinitions.pierreDiscs), text: 'Mickey Mouse!' },
		{ ...makeImageResource(imageDefinitions.christmasGifts), text: '"Julklappsleken"' },
		{ ...makeImageResource(imageDefinitions.forrestPixel), text: 'Nature calling.' },
		{ ...makeImageResource(imageDefinitions.workHard), text: 'Getting things done' }
	]
} satisfies Record<string, GalleryImage[]>;

export const galleryImages = imageGroups.aboutGallery;
