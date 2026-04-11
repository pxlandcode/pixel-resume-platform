import type { ResumeData, TechCategory } from '$lib/types/resume';

const cloneSerializable = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const cloneResumeDataValue = (value: ResumeData): ResumeData => cloneSerializable(value);

export const cloneTechCategoriesValue = (
	value: TechCategory[] | null | undefined
): TechCategory[] => cloneSerializable(value ?? []);
