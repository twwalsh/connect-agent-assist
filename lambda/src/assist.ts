/**
 * Agent-assist Lambda. Two entry points, one function:
 *  1. Invoked by the Amazon Connect contact flow ("Invoke AWS Lambda function") when a chat or call
 *     arrives: pre-fetches a suggested answer for the customer's stated question and hands it back as
 *     flat contact attributes, so the agent sees a suggestion before accepting the contact.
 *  2. Invoked over its function URL by the agent desktop for live suggestions as the conversation goes on.
 * The suggestion engine is the retrieval-augmented support service (github.com/twwalsh/dotnet-rag);
 * this function never generates text itself and never holds a model key.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, ConnectContactFlowEvent, ConnectContactFlowResult } from "aws-lambda";
import { askRag, cleanQuestion } from "./rag.js";

const RAG_URL = process.env.RAG_URL ?? "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "";
const FLOW_TIMEOUT_MS = 7000;   // Connect caps a flow Lambda at 8 s
const HTTP_TIMEOUT_MS = 20000;

// Best-effort per-IP limiter for the public URL (per warm container; a POC guard, not a product one).
const buckets = new Map<string, number[]>();
function allow(ip: string, limit = 12, windowMs = 60_000): boolean {
  const now = Date.now();
  const hits = (buckets.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) { buckets.set(ip, hits); return false; }
  hits.push(now); buckets.set(ip, hits); return true;
}

function isConnectEvent(e: unknown): e is ConnectContactFlowEvent {
  return !!e && typeof e === "object" && "Details" in (e as Record<string, unknown>);
}

async function fromFlow(event: ConnectContactFlowEvent): Promise<ConnectContactFlowResult> {
  const attrs = event.Details.ContactData.Attributes ?? {};
  const params = event.Details.Parameters ?? {};
  const q = cleanQuestion(params["question"] ?? attrs["question"]);
  if (!q || !RAG_URL) return { assistStatus: "no-question" };
  try {
    const r = await askRag(RAG_URL, q, FLOW_TIMEOUT_MS);
    return {
      assistStatus: r.sources.length ? "ok" : "unknown",
      assistAnswer: r.answer.slice(0, 1500),
      assistSources: r.sources.map((s) => s.url || s.title).join(" | ").slice(0, 1000),
    };
  } catch (err) {
    return { assistStatus: "error", assistError: String(err).slice(0, 200) };
  }
}

function cors(origin: string | undefined): Record<string, string> {
  const ok = ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN;
  return {
    "content-type": "application/json",
    ...(ok ? { "access-control-allow-origin": origin!, "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" } : {}),
  };
}

async function fromHttp(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const origin = event.headers?.origin;
  const headers = cors(origin);
  if (event.requestContext.http.method === "OPTIONS") return { statusCode: 204, headers };
  if (event.requestContext.http.method !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };
  if (!ALLOWED_ORIGIN || origin !== ALLOWED_ORIGIN) return { statusCode: 403, headers, body: JSON.stringify({ error: "origin not allowed" }) };
  if (!allow(event.requestContext.http.sourceIp)) return { statusCode: 429, headers, body: JSON.stringify({ error: "slow down" }) };
  let q: string | null = null;
  try { q = cleanQuestion(JSON.parse(event.body ?? "{}").question); } catch { /* fall through */ }
  if (!q) return { statusCode: 400, headers, body: JSON.stringify({ error: "question required (≤500 chars)" }) };
  if (!RAG_URL) return { statusCode: 503, headers, body: JSON.stringify({ error: "assist not configured" }) };
  try {
    const r = await askRag(RAG_URL, q, HTTP_TIMEOUT_MS);
    return { statusCode: 200, headers, body: JSON.stringify({ answer: r.answer, sources: r.sources, known: r.sources.length > 0 }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "assist unavailable", detail: String(err).slice(0, 200) }) };
  }
}

export const handler = async (event: unknown) => {
  if (isConnectEvent(event)) return fromFlow(event);
  return fromHttp(event as APIGatewayProxyEventV2);
};
