# Member MCP

Connect a remote MCP client to **https://halalfood.world/api/mcp/member** using Streamable HTTP.
The server is `halalfood-world`. Public reads need no account or key. Member tools require a member API key
with write scope. This endpoint is separate from the authenticated Scout admin MCP at `/api/mcp`.

## Tools and data

- `search_places`: `{ "q": "biryani", "city": "mumbai", "limit": 5 }`. Query length is 1–64 characters;
  city is an optional slug that prioritizes that city, and limit is 1–10 (default 10). Larger limits are rejected.
- `get_place`: `{ "id": "<place id returned by search_places>" }`. Unknown or unlisted ids return a clean tool error.

Tools return JSON in a text content item. Places include only `id`, `name`, `city` (slug), `area`, `cuisine`,
`status`, `facts` (`owned`, `certified`, `pork`, `alcohol`) and `url` (the canonical place page).
Facts are `yes`, `no` or `null` (unknown). Status has a `kind` of `verified`, `checking` (with `progress`), or
`unchecked`. Halal status comes from community checks and reviewed documents; individual facts can also carry
web or map listing context. Confirmed (status `verified`) means all four facts are settled, including potentially unfavourable answers.
See the [halal model](spec/halal-model.md). No personal data or Google snapshot blobs are returned.

Use targeted searches, link to place pages, and do not scrape data in bulk. There is no pagination or bulk export.
Requests are limited to 64 KB; responses use `Cache-Control: no-store`. The stateless transport uses JSON-RPC
over POST; opening the URL in a browser (GET), or sending DELETE, returns 405. Each client IP gets 60 requests a
minute (`MEMBER_MCP_READ_LIMITER`); over that the endpoint answers 429 with `Retry-After: 60`.


## Member tools

Create a key at `/me/keys` (account at least 7 days old, up to 3 active keys). Use the key returned there,
currently `hfw_…`, in `Authorization: Bearer <member key>`. Only a valid, unrevoked key with `write` scope
exposes these tools in `tools/list`. Missing, malformed, revoked and read-only keys see only public tools;
direct member-tool calls return `unauthorized` with setup instructions. Website sessions and admin tokens
never authorize member tools. Revocation takes effect on the next request.

| Tool | Input | Result |
| --- | --- | --- |
| `whoami` | `{}` | Your member id, trust tier, weight and daily user limits remaining |
| `my_contributions` | `{}` | Your ten most recent contributions, newest first, including review status |
| `verify_place` | `{ "place_id": "…", "ate_at": "2026-09", "rating": "liked", "note": "Great food" }` | The ordinary web vouch service's status, points and place trust |
| `rate_place` | `{ "place_id": "…", "rating": "loved" }` | Changes only your existing vouch's rating; no points or trust changes |

For `verify_place`, only `place_id` is required. `ate_at` is a month from 2000 through the current UTC month
(default: current month), `rating` is `disliked`, `liked` or `loved`, and `note` is at most 280 characters.
Unknown fields are rejected. Four-fact checks (`facts`) are not supported by this branch's vouch service.
`rate_place` requires an existing vouch; it preserves the note, month and vouch timestamps and never creates a vouch.

Vouches call `vouchForPlace`, exactly as the web route does: one voice per member and place, shared durable
user/IP budgets (20/60 per 24 hours, with the same cooldowns), trust recomputation, accepted or pending review,
and 3 points once per place within the shared 100-point daily cap. Ratings use `rateVouch`, a separate rating-only
service, and a durable 30-per-member / 90-per-IP daily budget. Ratings pay zero points. Both log contributions
with `channel='mcp'` and `api_key_id`. Each successful member tool includes `limits_remaining: {vouches, ratings}`;
these are user budgets, excluding IP budgets, burst limits and cooldowns. Private reads do not spend write budgets.

`MEMBER_MCP_WRITE_LIMITER` adds 60 writes per 60 seconds per key (production namespace 81004, preview 81104).
It is independent of the read limiter (81005 / 81105). A missing or failing write limiter fails closed.
Tool errors include `rate_limited`, `invalid_input`, `invalid_id`, `not_found` and `unavailable`;
internal database/provider details are never returned.

`submit_place` is omitted: the web service here is `addPlaceFromGoogle`, which fetches Google details and
is not a coordinate-based member contribution service. `submit_video` is omitted because this branch has no
member video-submission service. MCP never calls Google or an LLM. Other enrichment tools remain unavailable.
Only submit data the member saw or from the restaurant's own or open public pages. Never scrape Zomato,
Swiggy or Google Maps. Contributions are reviewed.

For a client supporting custom headers, add the following to its remote server configuration:

```json
"headers": { "Authorization": "Bearer <member key>" }
```

Keep the real key private. Clients using the unauthenticated setup below expose only public tools.
OAuth is not available yet.

## Claude

In Claude's Connectors area, add a custom remote connector named `halalfood.world`, enter the endpoint URL above,
and select **No sign in**. Finish adding it and enable it for the conversation. Organization-managed accounts
may need an owner to add the connector. See [Claude's remote connector instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## ChatGPT

Where custom MCP connections are available, open ChatGPT's Plugins area, select **+ → Add custom MCP server**,
name it `halalfood.world`, and enter the endpoint URL under Connection. Choose **No authentication**, create the
plugin, and install it before using it in a conversation. Availability depends on your account and workspace
permissions. See [OpenAI's custom MCP setup instructions](https://developers.openai.com/api/docs/guides/custom-mcp-server).
Use the custom MCP flow for these tools; they are named `search_places` and `get_place`.

## Cursor

Merge this entry into your project's `.cursor/mcp.json` (or your global `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "halalfood-world": {
      "url": "https://halalfood.world/api/mcp/member"
    }
  }
}
```

Enable the server in Cursor's MCP settings and check that the public tools appear.
See [Cursor's MCP configuration reference](https://cursor.com/docs/mcp).

## Try it

Ask your client: “Use halalfood.world to find biryani places in Mumbai, then get the first place's details.
Show its four facts and link to its place page.” Client connection steps above follow the linked vendor docs;
live connections must be tested after deployment.
