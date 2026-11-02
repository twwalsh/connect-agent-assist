# connect-agent-assist

A support desk proof of concept on **Amazon Connect**, with the same retrieval-augmented assistant on both
sides of the conversation. The visitor asks it first. If they escalate to a person, the conversation becomes
a chat in a Connect queue, their question and the assistant's answer travel with it as contact attributes,
and the agent sees a suggested reply drawn from the same manual before typing a word.

Built in a day. Infrastructure in OpenTofu, two Lambdas in TypeScript, two small browser bundles for the
customer page and the agent desktop. The suggestion engine is the support service from
[dotnet-rag](https://github.com/twwalsh/dotnet-rag); nothing in this repo calls a model or holds a model key.

**Try it:** [twwalsh.com/connect](https://twwalsh.com/connect/) (customer side) ·
[twwalsh.com/connect-agent](https://twwalsh.com/connect-agent/) (agent side, needs an agent login) ·
voice line +1 (775) 437-5647, recorded and transcribed by Contact Lens. The desk is staffed by one person
when he happens to be logged in; when nobody is available the flow says so and ends the contact.

## What is in it

```
infra/        OpenTofu: instance, hours, queue, routing profile, agent, S3 + KMS for recordings and
              transcripts, two Lambdas with function URLs, the Lambda↔instance association, the chat and
              voice flows (flows/*.json.tftpl, Connect flow language), a claimed US number
lambda/       assist.ts      flow pre-fetch (STRING_MAP response → contact attributes) and live HTTP suggestions
              start-chat.ts  StartChatContact for the web page, behind a shared key the site Worker holds
web/          customer.ts    ask the assistant, then escalate; amazon-connect-chatjs for the live chat
              agent.ts       the CCP embedded with amazon-connect-streams, plus the assist panel
```

The twwalsh.com side (two Astro pages and a Worker route that verifies Turnstile before calling
`start-chat`) lives in the site repo; the built bundles from `web/dist` are copied into its `public/connect/`.

## How a chat goes

1. The visitor asks a question on the page. The site's existing `/api/ask-dotnet` door answers it from the
   manual (Postgres + pgvector, Claude writing only from retrieved passages, an evaluation set behind it).
2. "Talk to a person" calls `/api/connect-start` → the `start-chat` Lambda → `StartChatContact` with
   attributes `question`, `botAnswer`, `channel`. The page connects with ChatJS using the returned token.
3. The **chat flow** turns logging on, sets the Support queue, invokes `assist` (8 s cap) with the
   question, writes `assistStatus` / `assistAnswer` / `assistSources` back onto the contact, checks
   `NumberOfAgentsAvailable` on the queue, and either transfers to the queue or explains that nobody is
   there and disconnects.
4. The agent desktop shows the attributes the moment the contact is offered. For each customer message after
   that it asks `assist` over its function URL (CORS-limited to twwalsh.com, per-IP limited) and shows the
   suggestion with sources and a "Use this reply" button. The agent decides what is sent.

The **voice flow** records agent and customer, enables Contact Lens post-call analytics with PII redaction
and sentiment, and routes through the same staffing check to the same queue.

## Running it

```sh
cd lambda && npm install && npm run build          # lambda/dist/*.mjs
cd ../web && npm install && npm run build          # web/dist/*.js → copy to the site's public/connect/
cd ../infra && tofu init && tofu plan -out=plan.tfplan && tofu apply plan.tfplan
tofu output                                        # ccp_url, assist_url, start_chat_url, phone_number
tofu output -raw agent_password                    # the agent's Connect password (local state only)
tofu output -raw start_key | npx wrangler secret put CONNECT_START_KEY   # in the site repo
```

Then allow the site origin for Streams (`aws connect associate-approved-origin --origin https://twwalsh.com`)
and put `ccp_url`, `assist_url` and the phone number into the site's `src/data/connect.ts`.

## Things learned

- The "Check staffing" block is `CheckMetricData` with `MetricType: NumberOfAgentsAvailable` and a
  `NumberGreaterThan 0` condition in the flow language; there is no `CheckStaffing` action, and the API's
  `InvalidContactFlowException` comes back with an empty message. Probing one block at a time with
  `CreateContactFlow` found it in two passes.
- A synchronous Lambda in a flow is capped at 8 seconds, so the suggestion service has to be warm. The Azure
  service it calls scales to zero by default; it now keeps one replica while the demo is up.
- `UpdateContactRecordingBehavior` with analytics requires both participants recorded; chat analytics is
  configured differently and is left out here.

## Honest limits

A one-person desk built in a day. No workforce management, no supervisor views, no Customer Profiles or
Cases, no Amazon Q in Connect (the point was to bring our own retrieval), no real-time Contact Lens on
voice, no tests beyond type-checking and the live walk-through. The per-IP limiter on the assist URL is
per warm container. Cost while it is up: the phone number, a KMS key and pennies per contact.

MIT.
