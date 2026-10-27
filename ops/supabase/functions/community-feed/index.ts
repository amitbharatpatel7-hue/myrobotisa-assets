// community-feed: retired 27 Oct 2026. The members' space is the on-site Ideas & questions board now, and the members
// area no longer calls this. It used to read the private GitHub discussions with COMMUNITY_READ_TOKEN and accepted any
// valid project key (verify_jwt only checks the signature), so it could return members-only posts to a non-member.
// That secret can now be deleted in Supabase and the token revoked on GitHub.
Deno.serve(() => new Response(JSON.stringify({ error: "retired: the members' space is the Ideas & questions board" }),
  { status: 410, headers: { "Content-Type": "application/json" } }));
