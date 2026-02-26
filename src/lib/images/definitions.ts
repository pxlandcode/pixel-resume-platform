export type ImageDefinition<TId extends string = string> = {
	id: TId;
	alt: string;
	supabasePath: string;
};

// Individual buckets
export const cultureImages = [
	{
		id: 'asset',
		alt: 'Pixel&Code Headquarters',
		supabasePath: 'culture/asset.jpg'
	},
	{
		id: 'ecommerce',
		alt: 'E-commerce project case',
		supabasePath: 'cases/ecommerce.png'
	},
	{
		id: 'forrestOliverDisc',
		alt: 'Forrest and Oliver throwing discs outdoors',
		supabasePath: 'culture/forrestoliverdisc.jpg'
	},
	{
		id: 'friends',
		alt: 'Friends from the team hanging out together',
		supabasePath: 'culture/friends.jpg'
	},
	{
		id: 'gang',
		alt: 'Pixel&Code team group photo',
		supabasePath: 'culture/gang.jpg'
	},
	{
		id: 'group243Copy',
		alt: 'Group 243 team photo from the rooftop',
		supabasePath: 'culture/Group 243 copy.jpg'
	},
	{
		id: 'ivoBowling',
		alt: 'Ivo bowling during a team social',
		supabasePath: 'culture/ivo-bowling.jpg'
	},
	{
		id: 'ivoGladShuffle',
		alt: 'Ivo smiling while playing shuffleboard',
		supabasePath: 'culture/Ivo-glad-shuffle.jpg'
	},
	{
		id: 'ivoRooftop',
		alt: 'Ivo enjoying the view from the rooftop',
		supabasePath: 'culture/ivo rooftop.jpg'
	},
	{
		id: 'ivoWin',
		alt: 'Ivo celebrating a shuffleboard win',
		supabasePath: 'culture/ivo win.jpg'
	},
	{
		id: 'karaoke',
		alt: 'Team karaoke night',
		supabasePath: 'culture/karaoke.jpg'
	},
	{
		id: 'karaokeNight',
		alt: 'Friends singing together on karaoke night',
		supabasePath: 'culture/karaoke-night.jpg'
	},
	{
		id: 'linusFrisbee',
		alt: 'Linus throwing a frisbee in the park',
		supabasePath: 'culture/linus frisbee.jpg'
	},
	{
		id: 'linusIvoShuffleboard',
		alt: 'Linus and Ivo taking turns at shuffleboard',
		supabasePath: 'culture/linus ivo shuffleboard.jpg'
	},
	{
		id: 'lookingFuture',
		alt: 'The team looking out towards the future',
		supabasePath: 'culture/lookingfuture.jpg'
	},
	{
		id: 'meetingRoom',
		alt: 'Team collaborating in a meeting room',
		supabasePath: 'culture/meeting-room.jpg'
	},
	{
		id: 'nicklasShuffle',
		alt: 'Nicklas celebrating a shuffleboard shot',
		supabasePath: 'culture/Nicklas-shuffle.jpg'
	},
	{
		id: 'nicklasShuffleboard',
		alt: 'Nicklas lined up for a shuffleboard play',
		supabasePath: 'culture/nicklas shuffleboard.jpg'
	},
	{
		id: 'nicklasShuffleboardAlt',
		alt: 'Nicklas focusing before sliding the puck',
		supabasePath: 'culture/nicklas-shuffleboard.jpg'
	},
	{
		id: 'oliverAzraDiscussion',
		alt: 'Oliver and Azra in a thoughtful discussion',
		supabasePath: 'culture/oliver-azra-diskussion.jpg'
	},
	{
		id: 'oliverBowling',
		alt: 'Oliver bowling during a team night out',
		supabasePath: 'culture/oliver-bowling.jpg'
	},
	{
		id: 'oliverIvoRooftop',
		alt: 'Oliver and Ivo at the rooftop hangout',
		supabasePath: 'culture/oliver ivo rooftop.jpg'
	},
	{
		id: 'oliverShuffle',
		alt: 'Oliver studying the shuffleboard lane',
		supabasePath: 'culture/oliver shuffle.jpg'
	},
	{
		id: 'onboardDanny',
		alt: 'Welcoming Danny on his first day',
		supabasePath: 'culture/onboard danny.jpg'
	},
	{
		id: 'pierreDiscs',
		alt: 'Pierre throwing discs outside',
		supabasePath: 'culture/pierre discs.jpg'
	},
	{
		id: 'pixelChristmas',
		alt: 'Pixel&Code Christmas celebration',
		supabasePath: 'culture/pixelchristmas.jpg'
	},
	{
		id: 'pixelEating',
		alt: 'Pixel&Code crew sharing a meal',
		supabasePath: 'culture/pixeleating.jpg'
	},
	{
		id: 'rooftopPierre',
		alt: 'Pierre enjoying the rooftop view',
		supabasePath: 'culture/rooftop-pierre.jpg'
	},
	{
		id: 'shuffleboard1',
		alt: 'Shuffleboard match underway',
		supabasePath: 'culture/shuffleboard-1.jpg'
	},
	{
		id: 'shuffleboard2',
		alt: 'Another shuffleboard round in progress',
		supabasePath: 'culture/shuffleboard-2.jpg'
	},
	{
		id: 'shuffleboardNicklasPhilip',
		alt: 'Nicklas and Philip focused on shuffleboard',
		supabasePath: 'culture/shuffleboard-nicklas-philip.jpg'
	},
	{
		id: 'shuffleboardPhilip',
		alt: 'Philip lining up a shuffleboard shot',
		supabasePath: 'culture/shuffleboard-philip.jpg'
	},
	{
		id: 'workHard',
		alt: 'Focused work session in progress',
		supabasePath: 'culture/work-hard.JPG'
	},
	{
		id: 'workLife',
		alt: 'Work life balance moment',
		supabasePath: 'culture/work-life.jpg'
	},
	{
		id: 'winnerPierre',
		alt: 'Pierre celebrating a win',
		supabasePath: 'culture/winner-pierre.jpg'
	},
	{
		id: 'weArePixel',
		alt: 'We Are Pixel&Code',
		supabasePath: 'culture/we-are-pixel.jpg'
	},
	{
		id: 'feelingsShuffle',
		alt: 'Feelings running high',
		supabasePath: 'culture/feelings-shuffle.jpg'
	},
	{
		id: 'christmasGifts',
		alt: 'Christmas gifts exchange',
		supabasePath: 'culture/christmas-gifts.jpg'
	},
	{
		id: 'forrestPixel',
		alt: 'Hanging out in the forrest',
		supabasePath: 'culture/forrest-pixel.jpg'
	}
] as const satisfies ReadonlyArray<ImageDefinition>;

export const peopleImages = [
	{
		id: 'andreasPortrait',
		alt: 'Portrait of Andreas',
		supabasePath: 'other/andreas.png'
	},
	{
		id: 'emiliaPortrait',
		alt: 'Portrait of Emilia',
		supabasePath: 'other/emilia.png'
	},
	{
		id: 'linusPortrait',
		alt: 'Portrait of Linus',
		supabasePath: 'other/linus.png'
	},
	{
		id: 'martinPortrait',
		alt: 'Portrait of Martin',
		supabasePath: 'other/martin.png'
	},
	{
		id: 'nicklasPortrait',
		alt: 'Portrait of Nicklas',
		supabasePath: 'other/nicklas.jpeg'
	},
	{
		id: 'oliverPortrait',
		alt: 'Portrait of Oliver',
		supabasePath: 'other/oliver.jpeg'
	},
	{
		id: 'pierrePortrait',
		alt: 'Portrait of Pierre',
		supabasePath: 'other/pierre.jpeg'
	}
] as const satisfies ReadonlyArray<ImageDefinition>;

export const imageDefinitionBuckets = {
	culture: cultureImages,
	people: peopleImages
} as const;

type BucketMap = typeof imageDefinitionBuckets;
type BucketEntries = BucketMap[keyof BucketMap];

export type ImageDefinitionEntry = BucketEntries[number];
export type ImageId = ImageDefinitionEntry['id'];

export const imageDefinitionList = Object.values(
	imageDefinitionBuckets
).flat() as ImageDefinitionEntry[];

export type PeopleImageDefinition = (typeof peopleImages)[number];
export type PeopleImageId = PeopleImageDefinition['id'];
