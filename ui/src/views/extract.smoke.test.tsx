// @vitest-environment jsdom
// The embedded excerpt a citation link shows in the study pane, with a mocked backend.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { card, entry } from "@/lib/fixtures";

const calls: { cmd: string; args: any }[] = [];
let backend: Record<string, (args: any) => unknown> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    calls.push({ cmd, args });
    const handler = backend[cmd];
    if (!handler) throw new Error(`unmocked command ${cmd}`);
    return handler(args);
  }),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined), emitTo: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: "main", onCloseRequested: async () => () => undefined }) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.0.0" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn(), save: vi.fn() }));

import { AppProvider } from "@/app";
import { ReaderView } from "@/views/reader";

const cite = "pergament://pub/E:502016128/2-3";
const nested = "pergament://pub/E:502016130/1";
const lesson = `<p id="p1">Teach with a story. <a class="xt" href="${cite}">see the article</a></p>`;
const article = `<p id="p2">The cited page's first paragraph.</p><p id="p3">The cited page's second paragraph.</p>`;
const missing = () => entry("w", "Magazines", null, "Der Wachtturm", 2016300);
let excerptHtml: string;
let action: any;

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  localStorage.setItem("lang", "X");
  // jsdom does not scroll.
  Element.prototype.scrollTo ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
  excerptHtml = '<p id="p2">The quoted text of the citation.</p>';
  action = {
    kind: "extract",
    url: "https://www.jw.org/finder?wtlocale=E&docid=502016128",
    publication: "Der Wachtturm",
    subject: "Ein Land, das Gute lernt",
    location: "w16 15/3 S. 12-13",
    html: excerptHtml,
  };
  backend = {
    list_publications: () => [card({ dir: "lff_2", symbol: "lff", title: "Glücklich" })],
    languages: () => [],
    catalog_cached: () => true,
    check_updates: () => null,
    publication: () => ({ card: card({ dir: "lff_2", symbol: "lff", title: "Glücklich" }), toc: [], books: [] }),
    render_page: ({ target }: any) => ({
      title: target.publication === "lff_2" ? "Lesson" : "Cited article",
      html: target.publication === "lff_2" ? lesson : article,
      fragment: null,
      name: "doc",
    }),
    page_user_data: () => ({ marks: [], notes: [], answers: {} }),
    // Re-inject excerptHtml: action is a beforeEach snapshot, but tests reassign excerptHtml afterwards.
    link_action: () => (action.kind === "extract" ? { ...action, html: excerptHtml } : action),
    missing_entry: () => missing(),
    download_publication: () => new Promise((resolve) => setTimeout(() => resolve("w_2016_3"), 5)),
  };
});
afterEach(cleanup);

const renderReader = () =>
  render(
    <AppProvider>
      <ReaderView target={{ publication: "lff_2", kind: { document: 1 } }} />
    </AppProvider>,
  );

/** Renders the page and clicks the citation link in it. */
const openPane = async () => {
  renderReader();
  await screen.findByText("see the article");
  // The reader redraws the article once the page's user data arrived; click that copy.
  await waitFor(() => expect(calls.some((c) => c.cmd === "page_user_data")).toBe(true));
  fireEvent.click(screen.getByText("see the article"));
  await screen.findByText("Publication Reference");
};

const downloads = () => calls.filter((c) => c.cmd === "download_publication");
const actions = (href: string) => calls.filter((c) => c.cmd === "link_action" && c.args.href === href);

describe("The embedded excerpt of a citation", () => {
  it("shows the embedded excerpt instead of the download offer", async () => {
    await openPane();
    expect(screen.getByText("Ein Land, das Gute lernt")).toBeTruthy();
    expect(screen.getByText("Der Wachtturm · w16 15/3 S. 12-13")).toBeTruthy();
    expect(screen.getByText("The quoted text of the citation.")).toBeTruthy();
    expect(screen.queryByText("This publication is not in your library.")).toBeNull();
  });

  it("offers the download only when the title bar is clicked", async () => {
    await openPane();
    fireEvent.click(screen.getByLabelText("Open the publication"));
    expect(await screen.findByText("This publication is not in your library.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Download (1 MB)" }));
    await waitFor(() => expect(downloads()).toHaveLength(1));
    expect(downloads()[0].args.lang).toBe("X");
    // The retry after the download follows the link again, back to the excerpt.
    expect(await screen.findByText("The quoted text of the citation.")).toBeTruthy();
  });

  it("follows a link inside the excerpt", async () => {
    excerptHtml = `The quoted text <a href="${nested}">nested</a> of the citation.`;
    await openPane();
    fireEvent.click(screen.getByText("nested"));
    await waitFor(() => expect(actions(nested)).toHaveLength(1));
    expect(actions(nested)[0].args.current).toBe("lff_2");
  });

  it("shows the cited page when the publication is in the library", async () => {
    action = { kind: "open", target: { publication: "w16_3", kind: { document: 5 } }, studyNote: false };
    await openPane();
    expect(await screen.findByText("The cited page's first paragraph.")).toBeTruthy();
    expect(screen.getByText("The cited page's second paragraph.")).toBeTruthy();
    expect(screen.queryByText("The quoted text of the citation.")).toBeNull();
  });
});
