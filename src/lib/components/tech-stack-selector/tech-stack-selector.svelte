<script lang="ts">
	import ArrowDown from 'lucide-svelte/icons/arrow-down';
	import Check from 'lucide-svelte/icons/check';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import X from 'lucide-svelte/icons/x';
	import { Input } from '@pixelcode_/blocks/components';

	type Technology = {
		name: string;
		category: string;
	};

	const technologies: Technology[] = [
		// Frontend
		{ name: 'React', category: 'Frontend' },
		{ name: 'Vue', category: 'Frontend' },
		{ name: 'Svelte', category: 'Frontend' },
		{ name: 'Angular', category: 'Frontend' },
		{ name: 'TypeScript', category: 'Frontend' },
		{ name: 'JavaScript', category: 'Frontend' },
		{ name: 'HTML', category: 'Frontend' },
		{ name: 'CSS', category: 'Frontend' },
		{ name: 'Tailwind', category: 'Frontend' },
		{ name: 'SASS', category: 'Frontend' },

		// Backend
		{ name: 'Node.js', category: 'Backend' },
		{ name: 'Python', category: 'Backend' },
		{ name: 'Java', category: 'Backend' },
		{ name: 'Go', category: 'Backend' },
		{ name: 'PHP', category: 'Backend' },
		{ name: 'Ruby', category: 'Backend' },
		{ name: 'C#', category: 'Backend' },
		{ name: '.NET', category: 'Backend' },
		{ name: 'Express', category: 'Backend' },
		{ name: 'Django', category: 'Backend' },
		{ name: 'Spring Boot', category: 'Backend' },

		// Database
		{ name: 'PostgreSQL', category: 'Database' },
		{ name: 'MySQL', category: 'Database' },
		{ name: 'MongoDB', category: 'Database' },
		{ name: 'Redis', category: 'Database' },
		{ name: 'SQL', category: 'Database' },
		{ name: 'Neo4j', category: 'Database' },
		{ name: 'Supabase', category: 'Database' },
		{ name: 'Firebase', category: 'Database' },

		// DevOps & Tools
		{ name: 'Docker', category: 'DevOps' },
		{ name: 'Kubernetes', category: 'DevOps' },
		{ name: 'AWS', category: 'DevOps' },
		{ name: 'Azure', category: 'DevOps' },
		{ name: 'GCP', category: 'DevOps' },
		{ name: 'Git', category: 'DevOps' },
		{ name: 'GitHub Actions', category: 'DevOps' },
		{ name: 'CI/CD', category: 'DevOps' },

		// Software & Methods
		{ name: 'Agile', category: 'Methods' },
		{ name: 'Scrum', category: 'Methods' },
		{ name: 'Kanban', category: 'Methods' },
		{ name: 'TDD', category: 'Methods' },
		{ name: 'REST API', category: 'Architecture' },
		{ name: 'GraphQL', category: 'Architecture' },
		{ name: 'Microservices', category: 'Architecture' },
		{ name: 'Serverless', category: 'Architecture' },

		// Design & UX
		{ name: 'Figma', category: 'Design' },
		{ name: 'Adobe Illustrator', category: 'Design' },
		{ name: 'Photoshop', category: 'Design' },
		{ name: 'UI/UX', category: 'Design' },
		{ name: 'Responsive Design', category: 'Design' },

		// Soft Skills
		{ name: 'Leadership', category: 'Soft Skills' },
		{ name: 'Communication', category: 'Soft Skills' },
		{ name: 'Team Collaboration', category: 'Soft Skills' },
		{ name: 'Problem Solving', category: 'Soft Skills' },
		{ name: 'Project Management', category: 'Soft Skills' }
	];

	let {
		value = $bindable([]),
		showSelectedChips = true,
		onchange
	}: {
		value?: string[];
		showSelectedChips?: boolean;
		onchange?: (techs: string[]) => void;
	} = $props();

	let searchTerm = $state('');
	let isOpen = $state(false);
	let activeIndex = $state<number | null>(null);
	let draggingIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);
	let wrapperRef: HTMLElement | null = null;
	let inputRef = $state<HTMLInputElement | undefined>(undefined);

	const filteredTechnologies = $derived.by<Technology[]>(() => {
		const term = searchTerm.trim().toLowerCase();
		return term
			? technologies.filter((tech) => tech.name.toLowerCase().includes(term))
			: technologies;
	});

	const groupedOptions = $derived.by<{ category: string; items: Technology[] }[]>(() => {
		const groups = new Map<string, Technology[]>();
		for (const tech of filteredTechnologies) {
			if (!groups.has(tech.category)) {
				groups.set(tech.category, []);
			}
			groups.get(tech.category)!.push(tech);
		}
		return Array.from(groups.entries()).map(([category, items]) => ({ category, items }));
	});

	const valueIncludes = (name: string) =>
		value.some((tech) => tech.toLowerCase() === name.toLowerCase());

	const updateValue = (next: string[]) => {
		value = next;
		onchange?.(next);
	};

	const moveTechnology = (from: number, to: number) => {
		if (from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) return;
		const next = [...value];
		const [item] = next.splice(from, 1);
		next.splice(to, 0, item);
		updateValue(next);
	};

	const addTechnology = (rawName: string) => {
		const trimmed = rawName.trim();
		if (!trimmed) return;

		const existing = technologies.find((tech) => tech.name.toLowerCase() === trimmed.toLowerCase());
		const normalized = existing?.name ?? trimmed;

		if (valueIncludes(normalized)) {
			searchTerm = '';
			isOpen = false;
			return;
		}

		updateValue([...value, normalized]);
		searchTerm = '';
		isOpen = false;
	};

	const handleSelect = (name: string) => {
		activeIndex = null;
		addTechnology(name);
		inputRef?.focus();
	};

	const commitFromInput = () => {
		const term = searchTerm.replace(/,$/, '').trim();
		if (!term) return;

		if (activeIndex !== null && filteredTechnologies[activeIndex]) {
			addTechnology(filteredTechnologies[activeIndex].name);
			activeIndex = null;
			return;
		}

		const exactMatch = technologies.find((tech) => tech.name.toLowerCase() === term.toLowerCase());

		if (exactMatch) {
			addTechnology(exactMatch.name);
			return;
		}

		addTechnology(term);
	};

	const handleKeydown = (event: KeyboardEvent) => {
		const hasOptions = filteredTechnologies.length > 0;

		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commitFromInput();
			return;
		}

		if (event.key === 'Escape') {
			isOpen = false;
			activeIndex = null;
			return;
		}

		if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
			if (!hasOptions) return;
			event.preventDefault();
			isOpen = true;
			activeIndex =
				activeIndex === null ? 0 : Math.min(activeIndex + 1, filteredTechnologies.length - 1);
			return;
		}

		if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
			if (!hasOptions) return;
			event.preventDefault();
			isOpen = true;
			activeIndex =
				activeIndex === null ? filteredTechnologies.length - 1 : Math.max(activeIndex - 1, 0);
		}
	};

	const removeTechnology = (name: string) => {
		if (!valueIncludes(name)) return;
		updateValue(value.filter((tech) => tech.toLowerCase() !== name.toLowerCase()));
	};

	const handleDragStart = (event: DragEvent, index: number) => {
		draggingIndex = index;
		event.dataTransfer?.setData('text/plain', String(index));
	};

	const handleDragOver = (event: DragEvent, index: number) => {
		if (draggingIndex === null || draggingIndex === index) return;
		event.preventDefault();
		dragOverIndex = index;
	};

	const handleDragEnter = (event: DragEvent, index: number) => {
		if (draggingIndex === null || draggingIndex === index) return;
		event.preventDefault();
		dragOverIndex = index;
	};

	const handleDragLeave = (event: DragEvent, index: number) => {
		if (dragOverIndex === index) {
			dragOverIndex = null;
		}
	};

	const handleDrop = (event: DragEvent, index: number) => {
		event.preventDefault();
		if (draggingIndex === null || draggingIndex === index) return;
		moveTechnology(draggingIndex, index);
		draggingIndex = null;
		dragOverIndex = null;
	};

	const handleDragEnd = () => {
		draggingIndex = null;
		dragOverIndex = null;
	};

	const handleClickOutside = (event: MouseEvent) => {
		if (wrapperRef && !wrapperRef.contains(event.target as Node)) {
			isOpen = false;
			activeIndex = null;
		}
	};

	const toggleDropdown = () => {
		isOpen = !isOpen;
		if (isOpen) {
			inputRef?.focus();
		}
		activeIndex = null;
	};

	$effect(() => {
		if (!inputRef) return;

		const handleKey = (event: KeyboardEvent) => handleKeydown(event);
		const handleInput = () => {
			isOpen = true;
			activeIndex = null;
		};
		const handleFocus = () => {
			isOpen = true;
			activeIndex = null;
		};

		inputRef.addEventListener('keydown', handleKey);
		inputRef.addEventListener('input', handleInput);
		inputRef.addEventListener('focus', handleFocus);

		return () => {
			inputRef?.removeEventListener('keydown', handleKey);
			inputRef?.removeEventListener('input', handleInput);
			inputRef?.removeEventListener('focus', handleFocus);
		};
	});

	$effect(() => {
		// Reset active option whenever the search term or dropdown state changes
		searchTerm;
		isOpen;
		activeIndex = null;
	});
</script>

<svelte:window on:click={handleClickOutside} />

<div class="space-y-2" bind:this={wrapperRef}>
	{#if showSelectedChips && value.length}
		<div class="flex flex-wrap gap-2">
			{#each value as tech, index (tech.toLowerCase())}
				<span
					class={`bg-muted text-foreground rounded-xs inline-flex cursor-move items-center gap-2 px-3 py-1 text-xs ${
						dragOverIndex === index
							? 'bg-primary/10 ring-primary/60 ring-offset-background ring-2 ring-offset-1'
							: ''
					}`}
					role="listitem"
					aria-grabbed={draggingIndex === index}
					tabindex="0"
					draggable="true"
					ondragstart={(event) => handleDragStart(event, index)}
					ondragover={(event) => handleDragOver(event, index)}
					ondragenter={(event) => handleDragEnter(event, index)}
					ondragleave={(event) => handleDragLeave(event, index)}
					ondrop={(event) => handleDrop(event, index)}
					ondragend={handleDragEnd}
				>
					{tech}
					<button
						type="button"
						aria-label={`Remove ${tech}`}
						class="text-muted-fg hover:bg-muted hover:text-foreground rounded-xs p-1 transition"
						onclick={() => removeTechnology(tech)}
					>
						<X class="h-3 w-3" />
					</button>
				</span>
			{/each}
		</div>
	{/if}

	<div class="relative">
		<Input
			bind:node={inputRef}
			bind:value={searchTerm}
			placeholder="Search or add technologies"
			class="border-border bg-input text-foreground pr-10"
			onclick={() => (isOpen = true)}
		/>
		<button
			type="button"
			aria-label="Toggle technologies"
			class="text-border hover:text-foreground absolute inset-y-0 right-0 flex items-center px-3 transition"
			onclick={toggleDropdown}
		>
			<ChevronDown class={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
		</button>

		{#if isOpen}
			<div
				class="bg-card absolute z-40 mt-2 max-h-72 w-full overflow-hidden rounded-md border shadow-md shadow-black/5"
			>
				{#if groupedOptions.length}
					<div class="max-h-72 overflow-y-auto">
						{#each groupedOptions as group, index (group.category)}
							<div
								class={`border-border/80 ${index < groupedOptions.length - 1 ? 'border-b' : ''}`}
							>
								<div
									class="bg-muted text-foreground/70 flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide"
								>
									<ArrowDown class="h-3.5 w-3.5 shrink-0 opacity-60" />
									{group.category}
								</div>
								<div class="flex flex-col">
									{#each group.items as tech}
										{@const optionIndex = filteredTechnologies.findIndex(
											(item) => item.name === tech.name
										)}
										{@const isActive = activeIndex === optionIndex}
										<button
											type="button"
											class={`hover:bg-primary/10 flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
												isActive ? 'bg-primary/10 text-primary' : ''
											}`}
											onclick={() => handleSelect(tech.name)}
										>
											<span class="truncate">{tech.name}</span>
											{#if valueIncludes(tech.name)}
												<Check class="text-primary h-4 w-4" />
											{/if}
										</button>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="text-muted-fg px-3 py-3 text-sm">
						{#if searchTerm.trim()}
							Press Enter to add "{searchTerm.trim()}"
						{:else}
							Start typing to search technologies
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
