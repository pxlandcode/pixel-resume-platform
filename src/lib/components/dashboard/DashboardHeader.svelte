<script lang="ts">
	let { userName }: { userName: string } = $props();
</script>

<header>
	<h1 class="text-foreground text-3xl font-bold leading-tight">
		Hello, {userName}
	</h1>
	<p class="text-muted-fg mt-1">Find and manage talents and resumes.</p>
</header>
