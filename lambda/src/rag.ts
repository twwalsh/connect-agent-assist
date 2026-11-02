export interface RagSource { title: string; url: string }
export interface RagAnswer { answer: string; sources: RagSource[]; model?: string | null }

const MAX_QUESTION = 500;

export function cleanQuestion(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const s = q.replace(/\s+/g, " ").trim();
  if (!s || s.length > MAX_QUESTION) return null;
  return s;
}

/** Ask the retrieval-augmented support service. Answers only from retrieved passages; empty sources means it did not know. */
export async function askRag(ragUrl: string, question: string, timeoutMs: number): Promise<RagAnswer> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${ragUrl.replace(/\/$/, "")}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`rag ${res.status}`);
    const body = (await res.json()) as {
      answer?: string; model?: string | null;
      sources?: { title?: string; url?: string }[];
      passages?: { title?: string; url?: string }[];
    };
    const seen = new Set<string>();
    const sources: RagSource[] = [];
    for (const s of [...(body.sources ?? []), ...(body.passages ?? [])]) {
      const title = (s.title ?? "").trim(); const url = (s.url ?? "").trim();
      const key = url || title; if (!key || seen.has(key)) continue; seen.add(key);
      sources.push({ title: title || url, url });
      if (sources.length >= 4) break;
    }
    return { answer: (body.answer ?? "").trim(), sources, model: body.model ?? null };
  } finally { clearTimeout(t); }
}
