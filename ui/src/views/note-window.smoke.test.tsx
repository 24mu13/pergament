// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const calls: { cmd: string; args: unknown }[] = [];
const handlers: Record<string, (e: { payload: unknown }) => void> = {};
const emitted: { to: string; event: string; payload?: unknown }[] = [];
let closeRequested: ((e: { preventDefault: () => void }) => Promise<void>) | null = null;
const destroy = vi.fn(async () => undefined);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    calls.push({ cmd, args });
    if (cmd === "save_note") return "n1";
    return undefined;
  }),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, h: (e: { payload: unknown }) => void) => {
    handlers[event] = h;
    return () => void (handlers[event] === h && delete handlers[event]);
  }),
  emitTo: vi.fn(async (to: string, event: string, payload?: unknown) => void emitted.push({ to, event, payload })),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "note",
    destroy,
    onCloseRequested: async (h: typeof closeRequested) => {
      closeRequested = h;
      return () => undefined;
    },
    onResized: async () => () => undefined,
    scaleFactor: async () => 1,
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

import { ask } from "@tauri-apps/plugin-dialog";
import { NoteWindowView } from "@/views/note-window";

const verse = { publication: "nwtsty_E", kind: { chapter: { book: 43, chapter: 3, verse: 16 } } };
const open = (id: number, fields?: object) =>
  act(async () =>
    handlers["note-open"]({
      payload: { id, draft: { note: { title: "Loved the world" }, target: verse, markGuid: "m1", blockType: 2, blockIdentifier: 16 }, fields },
    }),
  );

beforeEach(() => {
  calls.length = 0;
  emitted.length = 0;
  destroy.mockClear();
  vi.mocked(ask).mockReset();
  render(
    <StrictMode>
      <NoteWindowView />
    </StrictMode>,
  );
});
afterEach(cleanup);

describe("Note window", () => {
  it("says it is ready, then shows the note it is sent once", async () => {
    await waitFor(() => expect(emitted.some((e) => e.to === "main" && e.event === "note-ready")).toBe(true));
    await open(1);
    await open(1);
    expect((screen.getByPlaceholderText("Title") as HTMLInputElement).value).toBe("Loved the world");
    expect(ask).not.toHaveBeenCalled();
  });

  it("starts with text moved from the study pane and counts it as unsaved", async () => {
    await waitFor(() => expect(handlers["note-open"]).toBeTruthy());
    await open(1, { title: "Loved the world", content: "moved", tags: "" });
    expect((screen.getByPlaceholderText("Note") as HTMLTextAreaElement).value).toBe("moved");
    await waitFor(() => expect(emitted.some((e) => e.event === "note-dirty" && e.payload === true)).toBe(true));
  });

  it("saves to the page the note was started on, tells the app and closes", async () => {
    await waitFor(() => expect(handlers["note-open"]).toBeTruthy());
    await open(1);
    fireEvent.change(screen.getByPlaceholderText("Note"), { target: { value: "God gave his Son" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(destroy).toHaveBeenCalled());
    expect(calls.find((c) => c.cmd === "save_note")!.args).toEqual({
      target: verse,
      note: { title: "Loved the world", content: "God gave his Son", tags: [], guid: undefined, blockType: 2, blockIdentifier: 16, markGuid: "m1" },
    });
    expect(emitted.some((e) => e.to === "main" && e.event === "notes-changed")).toBe(true);
  });

  it("asks before the close button drops unsaved text, and not without changes", async () => {
    await waitFor(() => expect(handlers["note-open"]).toBeTruthy());
    await open(1);
    const clean = { preventDefault: vi.fn() };
    await act(() => closeRequested!(clean));
    expect(ask).not.toHaveBeenCalled();
    expect(clean.preventDefault).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("Note"), { target: { value: "draft" } });
    vi.mocked(ask).mockResolvedValue(false);
    const dirty = { preventDefault: vi.fn() };
    await act(() => closeRequested!(dirty));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(dirty.preventDefault).toHaveBeenCalled();
  });

  it("asks before another note replaces unsaved text", async () => {
    await waitFor(() => expect(handlers["note-open"]).toBeTruthy());
    await open(1);
    fireEvent.change(screen.getByPlaceholderText("Note"), { target: { value: "draft" } });
    vi.mocked(ask).mockResolvedValue(false);
    await open(2);
    expect((screen.getByPlaceholderText("Note") as HTMLTextAreaElement).value).toBe("draft");
    vi.mocked(ask).mockResolvedValue(true);
    await open(3);
    expect((screen.getByPlaceholderText("Note") as HTMLTextAreaElement).value).toBe("");
  });

  it("closes on Escape, asking first when there are changes", async () => {
    await waitFor(() => expect(handlers["note-open"]).toBeTruthy());
    await open(1);
    fireEvent.change(screen.getByPlaceholderText("Note"), { target: { value: "draft" } });
    vi.mocked(ask).mockResolvedValue(true);
    fireEvent.keyDown(screen.getByPlaceholderText("Note"), { key: "Escape" });
    await waitFor(() => expect(destroy).toHaveBeenCalled());
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
