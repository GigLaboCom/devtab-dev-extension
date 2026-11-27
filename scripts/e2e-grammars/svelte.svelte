<script lang="ts">
  // The list of jobs, and how many are waiting.
  export let jobs: string[] = [];
  let limit = 10;
  $: waiting = jobs.length;

  function push(job: string) {
    if (waiting >= limit) return;
    jobs = [...jobs, job];
  }
</script>

<h1>{waiting} jobs waiting</h1>
{#each jobs as job, index (job)}
  <p class="job" data-index={index}>{job}</p>
{:else}
  <p>Nothing to do.</p>
{/each}
<button on:click={() => push("build")}>Add a build</button>

<style>
  .job { color: #3366ff; }
</style>
