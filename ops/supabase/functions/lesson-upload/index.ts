// lesson-upload: retired 28 Oct 2026. It copied the 20 lesson videos into the private R2 bucket myrobotisa-lessons
// once (all 20 sizes checked against the originals). Kept as a stub so the address answers plainly.
Deno.serve(() => new Response(JSON.stringify({ error: "retired: the lesson videos are already in place" }),
  { status: 410, headers: { "Content-Type": "application/json" } }));
