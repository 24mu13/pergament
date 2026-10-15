// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined), emitTo: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", onCloseRequested: async () => () => undefined }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { NoteCard } from "./notes";
import type { Note } from "@/lib/api";

const note: Note = {
  guid: "a",
  title: "Long one",
  content: "Line **one**\n\nSee [map](https://example.org/)",
  blockType: 0,
  blockIdentifier: null,
  markGuid: null,
  color: 1,
  tags: [],
  lastModified: "2026-10-03T00:00:00Z",
  location: null,
};

const layout = ["scrollHeight", "clientHeight"].map((key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)] as const);

afterEach(() => {
  cleanup();
  for (const [key, original] of layout) {
    if (original) Object.defineProperty(HTMLElement.prototype, key, original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  }
});

/** jsdom does no layout; make the clamped text report that it is cut off. */
function clip(cut: boolean) {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => (cut ? 200 : 50) });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 50 });
}

describe("NoteCard", () => {
  it("offers to show the whole note only when it is cut off", () => {
    clip(false);
    render(<NoteCard note={note} onClick={() => undefined} onToggle={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Show whole note" })).toBeNull();
    cleanup();
    clip(true);
    render(<NoteCard note={note} onClick={() => undefined} onToggle={() => undefined} />);
    expect(screen.getByRole("button", { name: "Show whole note" })).toBeTruthy();
  });

  it("toggles without editing, and opens links of the whole note in the browser", () => {
    clip(true);
    const onClick = vi.fn();
    const onToggle = vi.fn();
    const { rerender } = render(<NoteCard note={note} onClick={onClick} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Show whole note" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    rerender(<NoteCard note={note} expanded onClick={onClick} onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
    fireEvent.click(screen.getByText("map"));
    expect(onClick).not.toHaveBeenCalled();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("open_external", { url: "https://example.org/" });
    fireEvent.click(screen.getByText("one"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not edit the note when text in the whole note is selected", () => {
    const onClick = vi.fn();
    render(<NoteCard note={note} expanded onClick={onClick} onToggle={() => undefined} />);
    const selection = vi.spyOn(window, "getSelection").mockReturnValue({ isCollapsed: false } as Selection);
    fireEvent.click(screen.getByText("one"));
    expect(onClick).not.toHaveBeenCalled();
    selection.mockRestore();
  });

  it("names the title button of an untitled whole note so it can be edited from the keyboard", () => {
    const onClick = vi.fn();
    render(<NoteCard note={{ ...note, title: "" }} expanded onClick={onClick} onToggle={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
