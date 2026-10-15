// @vitest-environment jsdom
// Renders the reader in StrictMode with a mocked backend: the study pane's note editor and the page changes that move it.
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { card } from "@/lib/fixtures";
import type { Note, Target } from "@/lib/api";

const calls: { cmd: string; args: unknown }[] = [];
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
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined), emitTo: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", onCloseRequested: async () => () => undefined }),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.0.0" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(), message: vi.fn(), open: vi.fn(), save: vi.fn() }));

import { AppProvider, useApp } from "@/app";
import { ReaderView } from "@/views/reader";
import { chapterTarget } from "@/lib/api";
import { emitTo } from "@tauri-apps/api/event";

const note: Note = {
  guid: "n1",
  title: "Loved the world",
  content: "God gave his Son",
  blockType: 2,
  blockIdentifier: 16,
  markGuid: null,
  color: 1,
  tags: [],
  lastModified: "2026-10-03T00:00:00Z",
  location: null,
};

beforeEach(() => {
  // jsdom does no layout or scrolling.
  Element.prototype.scrollTo = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
  calls.length = 0;
  localStorage.clear();
  localStorage.setItem("lang", "X");
  backend = {
    list_publications: () => [card({ dir: "nwtsty_E", symbol: "nwtsty", title: "Study Bible" })],
    languages: () => [],
    catalog_cached: () => true,
    check_updates: () => null,
    dated_page: () => null,
    publication: () => ({
      card: card({ dir: "nwtsty_E", symbol: "nwtsty", title: "Study Bible" }),
      toc: [],
      books: [{ number: 43, name: "John", chapters: 21 }],
    }),
    render_page: ({ target }: { target: Target }) => {
      const c = "chapter" in target.kind ? target.kind.chapter.chapter : 0;
      return { title: `John ${c}`, html: `<p><span class="v" id="v43-${c}-16-1">For God loved the world</span></p>`, fragment: null, name: "" };
    },
    chapter_study: () => ({ outlineTitle: null, outline: [], verses: [] }),
    research_verses: () => [],
    page_user_data: ({ target }: { target: Target }) => ({
      marks: [],
      notes: "chapter" in target.kind && target.kind.chapter.chapter === 3 ? [note] : [],
      answers: {},
    }),
    open_note_window: () => undefined,
  };
});
afterEach(cleanup);

/** Shows where the app went, which the reader's page keys change. */
function Where() {
  const { view } = useApp();
  return <span data-testid="where">{JSON.stringify(view)}</span>;
}

const reader = (target: Target) => (
  <StrictMode>
    <AppProvider>
      <ReaderView target={target} />
      <Where />
    </AppProvider>
  </StrictMode>
);

describe("Reader", () => {
  it("edits a note in the study pane and moves its unsaved text to the note window when the chapter changes", async () => {
    const view = render(reader(chapterTarget("nwtsty_E", 43, 3)));
    fireEvent.click(await screen.findByText("Loved the world"));
    const editor = await screen.findByRole("form", { name: "Edit note" });
    const text = within(editor).getByPlaceholderText("Note");
    fireEvent.change(text, { target: { value: "God gave his only-begotten Son" } });

    // Keys typed in the note stay there and do not turn the page.
    const where = screen.getByTestId("where").textContent;
    fireEvent.keyDown(text, { key: "ArrowRight" });
    expect(screen.getByTestId("where").textContent).toBe(where);
    // The same key outside the note does turn the page.
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toContain('"chapter":4'));

    view.rerender(reader(chapterTarget("nwtsty_E", 43, 4)));
    await waitFor(() => expect(calls.some((c) => c.cmd === "open_note_window")).toBe(true));
    await waitFor(() =>
      expect(vi.mocked(emitTo)).toHaveBeenCalledWith(
        "note",
        "note-open",
        expect.objectContaining({
          draft: expect.objectContaining({ note: expect.objectContaining({ guid: "n1" }) }),
          fields: { title: "Loved the world", content: "God gave his only-begotten Son", tags: "" },
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
  });
});
