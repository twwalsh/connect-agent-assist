/**
 * Customer side of the support desk demo (twwalsh.com/connect/).
 * Step 1: ask the self-service assistant (the existing /api/ask-dotnet door, Turnstile-protected).
 * Step 2: "Talk to a person" starts an Amazon Connect chat through the site Worker, carrying the question
 * and the assistant's answer as contact attributes, and runs the conversation with amazon-connect-chatjs.
 */
import "amazon-connect-chatjs";
import { readConfig, esc, renderMd } from "./config";

declare const connect: any;      // amazon-connect-chatjs attaches to window.connect
declare const turnstile: any;    // Cloudflare Turnstile

const cfg = readConfig();
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const qEl = $("q") as HTMLTextAreaElement;
const answerEl = $("answer"), sourcesEl = $("sources"), statusEl = $("status");
const escalate = $("escalate") as HTMLButtonElement;
const chatEl = $("chat"), logEl = $("log"), composer = $("composer") as HTMLFormElement, msgEl = $("msg") as HTMLInputElement;
let lastQuestion = "", lastAnswer = "";
let session: any = null;

function say(s: string) { statusEl.hidden = !s; statusEl.textContent = s; }
function turnstileToken(): string { const t = (document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value ?? ""; return t; }

($("ask-form") as HTMLFormElement).addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = qEl.value.trim(); if (!question) return;
  const token = turnstileToken(); if (!token) { say("Please complete the human check first."); return; }
  say("Asking the assistant…"); answerEl.hidden = true; sourcesEl.hidden = true; escalate.hidden = true;
  try {
    const res = await fetch("/api/ask-dotnet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, token }) });
    const body = await res.json();
    if (!res.ok) { say(body.error || "The assistant could not answer."); return; }
    lastQuestion = question; lastAnswer = body.answer || "";
    answerEl.innerHTML = renderMd(lastAnswer); answerEl.hidden = false;
    const srcs: { title: string; url: string }[] = body.sources || [];
    if (srcs.length) { sourcesEl.innerHTML = "Sources: " + srcs.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(" · "); sourcesEl.hidden = false; }
    say(""); escalate.hidden = false;
  } catch { say("The assistant could not answer just now."); }
  finally { try { turnstile.reset(); } catch { /* ignore */ } }
});

function addLine(who: string, text: string, cls = "") {
  const p = document.createElement("p"); p.className = `line ${cls}`; p.innerHTML = `<b>${esc(who)}</b> ${renderMd(text)}`; logEl.appendChild(p); logEl.scrollTop = logEl.scrollHeight;
}

escalate.addEventListener("click", async () => {
  const token = turnstileToken(); if (!token) { say("Please complete the human check again before starting a chat."); return; }
  escalate.disabled = true; say("Starting a chat with the desk…");
  try {
    const res = await fetch("/api/connect-start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, question: lastQuestion, botAnswer: lastAnswer, displayName: "Visitor" }) });
    const body = await res.json();
    if (!res.ok) { say(body.error || "Could not start a chat."); escalate.disabled = false; return; }
    connect.ChatSession.setGlobalConfig({ region: cfg.region });
    session = connect.ChatSession.create({ chatDetails: { contactId: body.contactId, participantId: body.participantId, participantToken: body.participantToken }, type: connect.ChatSession.SessionTypes.CUSTOMER, options: { region: cfg.region } });
    session.onMessage((ev: any) => {
      const d = ev.data; if (!d || d.Type !== "MESSAGE") return;
      if (d.ParticipantRole === "CUSTOMER") return;                      // we echo our own on send
      addLine(d.ParticipantRole === "AGENT" ? (d.DisplayName || "Agent") : "Desk", d.Content || "", d.ParticipantRole === "AGENT" ? "agent" : "system");
    });
    session.onEnded(() => { addLine("Desk", "The chat has ended.", "system"); composer.hidden = true; });
    await session.connect();
    chatEl.hidden = false; composer.hidden = false; say("");
    addLine("You", lastQuestion ? `Earlier I asked: "${lastQuestion}"` : "Hello", "me");
  } catch (err) { say("Could not start a chat: " + String(err).slice(0, 120)); escalate.disabled = false; }
  finally { try { turnstile.reset(); } catch { /* ignore */ } }
});

composer.addEventListener("submit", async (e) => {
  e.preventDefault(); const text = msgEl.value.trim(); if (!text || !session) return;
  msgEl.value = ""; addLine("You", text, "me");
  try { await session.sendMessage({ contentType: "text/plain", message: text }); } catch { addLine("Desk", "Message failed to send.", "system"); }
});
