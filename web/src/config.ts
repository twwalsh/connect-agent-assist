/** Public, non-secret settings for the twwalsh.com demo pages. Filled from the infra outputs. */
export interface DeskConfig { region: string; ccpUrl: string; assistUrl: string; startUrl: string; phone: string | null }
export function readConfig(): DeskConfig {
  const el = document.getElementById("desk-config");
  if (!el) throw new Error("desk-config missing");
  return JSON.parse(el.textContent || "{}") as DeskConfig;
}
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
/** Tiny markdown: bold, bullets, links. The assistant is instructed to emit only these. */
export function renderMd(md: string): string {
  const lines = esc(md).split("\n"); let html = ""; let inList = false;
  for (const line of lines) {
    const inline = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener" target="_blank">$1</a>');
    const m = /^\s*[-*]\s+(.*)$/.exec(inline);
    if (m) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${m[1]}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (inline.trim()) html += `<p>${inline}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}
