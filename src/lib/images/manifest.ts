import { imageDefinitionList, type ImageDefinition, type ImageId } from '$lib/images/definitions';
import {
	SUPABASE_IMAGE_BASE_URL,
	SUPABASE_IMAGE_RENDER_BASE_URL,
	buildSupabaseImageSrc,
	buildSupabaseImageSrcSet,
	supabaseImagePresets,
	supabaseImageSrcsetWidths
} from '$lib/images/supabaseImage';

export {
	SUPABASE_IMAGE_BASE_URL,
	SUPABASE_IMAGE_RENDER_BASE_URL,
	buildSupabaseImageSrc
} from '$lib/images/supabaseImage';

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

const GALLERY_PRESET = supabaseImagePresets.gallery;
const GALLERY_WIDTHS = supabaseImageSrcsetWidths.gallery;

const makeImageResource = <TId extends ImageId>(definition: ImageDefinition<TId>) => {
	const originalSrc = buildSupabaseImageSrc(definition.supabasePath);
	const srcset = buildSupabaseImageSrcSet(definition.supabasePath, GALLERY_WIDTHS, {
		quality: GALLERY_PRESET.quality,
		resize: GALLERY_PRESET.resize
	});
	const src = buildSupabaseImageSrc(definition.supabasePath, GALLERY_PRESET);

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
