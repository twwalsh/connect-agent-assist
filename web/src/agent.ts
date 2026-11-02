/**
 * Agent desktop for the support desk demo (twwalsh.com/connect-agent/).
 * Embeds the Amazon Connect Contact Control Panel with amazon-connect-streams, and beside it an
 * assist panel: the visitor's stated question and the pre-fetched suggestion (contact attributes
 * written by the flow's Lambda), then a fresh suggestion for every customer message during a chat,
 * fetched from the assist Lambda's URL. One click pastes a suggestion into the reply.
 * The agent decides what is sent; the assistant only ever suggests, and only from retrieved passages.
 */
import "amazon-connect-streams";
import "amazon-connect-chatjs";
import { readConfig, esc, renderMd } from "./config";

declare const connect: any;

const cfg = readConfig();
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const ccpEl = $("ccp"), stateEl = $("state"), contextEl = $("context"), suggestionsEl = $("suggestions");
const replyForm = $("reply") as HTMLFormElement, replyEl = $("reply-text") as HTMLTextAreaElement;
let chatSession: any = null;

connect.core.initCCP(ccpEl, {
  ccpUrl: cfg.ccpUrl,
  region: cfg.region,
  loginPopup: true,
  loginPopupAutoClose: true,
  softphone: { allowFramedSoftphone: true },
  pageOptions: { enableAudioDeviceSettings: true, enablePhoneTypeSettings: true },
});

connect.agent((agent: any) => {
  const show = () => { stateEl.textContent = `${agent.getName?.() ?? "Agent"} · ${agent.getStatus().name}`; };
  show(); agent.onRefresh(show);
});

async function suggest(question: string, label: string) {
  const card = document.createElement("div"); card.className = "card"; card.innerHTML = `<p class="fine">${esc(label)}</p><p class="fine">Looking up: “${esc(question)}”…</p>`;
  suggestionsEl.prepend(card);
  try {
    const res = await fetch(cfg.assistUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
    const body = await res.json();
    if (!res.ok) { card.innerHTML = `<p class="fine">${esc(label)}</p><p>No suggestion: ${esc(body.error || res.status)}</p>`; return; }
    const srcs: { title: string; url: string }[] = body.sources || [];
    card.innerHTML = `<p class="fine">${esc(label)} · ${body.known ? "from the manual" : "the assistant did not know; answer yourself"}</p>` +
      `<div class="prose">${renderMd(body.answer || "")}</div>` +
      (srcs.length ? `<p class="fine">Sources: ${srcs.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(" · ")}</p>` : "") +
      (body.known ? `<p><button type="button" class="use">Use this reply</button></p>` : "");
    card.querySelector(".use")?.addEventListener("click", () => { replyEl.value = body.answer || ""; replyEl.focus(); });
  } catch (err) { card.innerHTML = `<p class="fine">${esc(label)}</p><p>Assist unavailable: ${esc(String(err).slice(0, 120))}</p>`; }
}

function showContext(contact: any) {
  const a = contact.getAttributes?.() ?? {};
  const v = (k: string) => a[k]?.value ?? "";
  contextEl.innerHTML =
    `<p><b>Channel</b> ${esc(contact.getType())} · <b>From</b> ${esc(v("channel") || "phone")}</p>` +
    (v("question") ? `<p><b>Visitor asked</b> ${esc(v("question"))}</p>` : "<p>No question stated before the contact.</p>") +
    (v("botAnswer") ? `<details><summary>What the self-service assistant told them</summary><div class="prose">${renderMd(v("botAnswer"))}</div></details>` : "") +
    (v("assistAnswer") ? `<div class="card"><p class="fine">Pre-fetched by the flow (status: ${esc(v("assistStatus"))})</p><div class="prose">${renderMd(v("assistAnswer"))}</div>${v("assistSources") ? `<p class="fine">${esc(v("assistSources"))}</p>` : ""}<p><button type="button" id="use-prefetch">Use this reply</button></p></div>` : `<p class="fine">No pre-fetched suggestion (status: ${esc(v("assistStatus") || "none")}).</p>`);
  document.getElementById("use-prefetch")?.addEventListener("click", () => { replyEl.value = v("assistAnswer"); replyEl.focus(); });
}

connect.contact((contact: any) => {
  contact.onConnecting(() => { showContext(contact); suggestionsEl.innerHTML = ""; stateEl.textContent = `Incoming ${contact.getType()}…`; });
  contact.onAccepted?.(() => showContext(contact));
  contact.onConnected(() => {
    showContext(contact);
    if (contact.getType() !== connect.ContactType.CHAT) { replyForm.hidden = true; return; }
    replyForm.hidden = false;
    const conn = contact.getAgentConnection();
    conn.getMediaController().then((session: any) => {
      chatSession = session;
      session.onMessage((ev: any) => {
        const d = ev.data; if (!d || d.Type !== "MESSAGE" || d.ParticipantRole !== "CUSTOMER") return;
        const text = String(d.Content || "").trim(); if (!text) return;
        const el = document.createElement("p"); el.className = "line"; el.innerHTML = `<b>Customer</b> ${esc(text)}`; contextEl.appendChild(el);
        if (!/^earlier i asked:/i.test(text)) suggest(text, "Suggested for the latest message");
      });
    }).catch((err: unknown) => { stateEl.textContent = "Chat media unavailable: " + String(err).slice(0, 80); });
  });
  contact.onEnded(() => { chatSession = null; replyForm.hidden = true; stateEl.textContent = "Contact ended"; });
});

replyForm.addEventListener("submit", async (e) => {
  e.preventDefault(); const text = replyEl.value.trim(); if (!text || !chatSession) return;
  try { await chatSession.sendMessage({ contentType: "text/plain", message: text }); replyEl.value = ""; } catch (err) { stateEl.textContent = "Send failed: " + String(err).slice(0, 80); }
});
