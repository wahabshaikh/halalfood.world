# Member MCP

Connect a remote MCP client to **https://halalfood.world/api/mcp/member** using Streamable HTTP.
The server is `halalfood-world`, public and read-only for now. No account, API key, OAuth or admin bearer token
is required. This endpoint is separate from the authenticated Scout admin MCP at `/api/mcp`.

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

Enable the server in Cursor's MCP settings and check that both tools appear.
See [Cursor's MCP configuration reference](https://cursor.com/docs/mcp).

## Try it

Ask your client: “Use halalfood.world to find biryani places in Mumbai, then get the first place's details.
Show its four facts and link to its place page.” Client connection steps above follow the linked vendor docs;
live connections must be tested after deployment.
