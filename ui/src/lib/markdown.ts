// A small Markdown subset for notes: headings, bold, italic, code, lists,
// links and paragraphs. Everything is escaped first, so the only markup in the
// result is what this file writes; a note can never inject HTML.

export interface MarkdownOptions {
  /** Render http(s) and app links as anchors; otherwise their text is only underlined. */
  links: boolean;
}

/** The app's own links a note may hold: `pergament://bible/40:24:14-40:24:14`, `…/verse/X:1001070143/8:38` or `…/pub/X:1102016001/3`. */
const APP_LINK = /\[([^\]]+)\]\((pergament:\/\/(?:bible\/[\d:-]+|(?:verse|pub)\/[A-Za-z0-9:-]+\/[\d:-]+))\)/g;

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Bold and italic in escaped text. Underscores only count at word edges, so snake_case stays. */
const emphasis = (s: string) =>
  s
    .replace(/\*\*(?=\S)(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(?=[^\s*])([^*]+?)\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_(?=\S)([^_]+?)_(?!\w)/g, "$1<em>$2</em>");

/** One line of text as escaped HTML. Code spans and links are set aside so emphasis cannot reach into them. */
function inline(text: string, { links }: MarkdownOptions): string {
  const held: string[] = [];
  const hold = (html: string) => `\u0000${held.push(html) - 1}\u0000`;
  const restore = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
  const link = (_: string, label: string, url: string) => {
    // The label can contain code spans; put them back before it is held itself.
    const html = restore(emphasis(label));
    return hold(links ? `<a href="${url}">${html}</a>` : `<span class="md-link">${html}</span>`);
  };
  let s = escape(text)
    .replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`))
    // A URL may hold one level of balanced parentheses (Wikipedia), but no code span.
    .replace(/\[([^\]]+)\]\((https?:\/\/(?:[^\s()\u0000]|\([^\s()\u0000]*\))+)\)/g, link)
    .replace(APP_LINK, link);
  s = emphasis(s);
  return restore(s);
}

/** A note's text as HTML. */
export function renderMarkdown(text: string, options: MarkdownOptions): string {
  const out: string[] = [];
  let para: string[] = [];
  // Typed with `as` so TypeScript does not narrow it to null; flush() resets it.
  let list = null as { tag: "ul" | "ol"; items: string[] } | null;
  const flush = () => {
    if (para.length > 0) out.push(`<p>${para.join("<br>")}</p>`);
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`);
    para = [];
    list = null;
  };
  for (const line of text.replace(/\u0000/g, "").split(/\r?\n/)) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const item = /^\s*(?:([-*])|\d+[.)])\s+(.+)$/.exec(line);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2], options)}</h${level}>`);
    } else if (item) {
      const tag = item[1] ? "ul" : "ol";
      if (para.length > 0 || list?.tag !== tag) flush();
      list ??= { tag, items: [] };
      list.items.push(inline(item[2], options));
    } else {
      if (list) flush();
      para.push(inline(line, options));
    }
  }
  flush();
  return out.join("");
}
