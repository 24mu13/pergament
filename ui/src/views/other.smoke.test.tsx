// @vitest-environment jsdom
// Renders the search, meetings, updates and publication views in StrictMode with a mocked backend.
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { card, entry } from "@/lib/fixtures";

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
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => undefined), emitTo: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: "main" }) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.0.0" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(), message: vi.fn(), open: vi.fn(), save: vi.fn() }));

import { AppProvider, useApp } from "@/app";
import { MeetingsView } from "@/views/meetings";
import { OnlineView } from "@/views/online";
import { PublicationView } from "@/views/publication";
import { UpdatesTab } from "@/views/updates";
import { SettingsView } from "@/views/settings";
import { PersonalView } from "@/views/personal";
import { GoTo } from "@/components/go-to";
import { ask, message, open } from "@tauri-apps/plugin-dialog";

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  localStorage.setItem("lang", "X");
  backend = {
    list_publications: () => [card({ dir: "lff_2", symbol: "lff", title: "Glücklich" })],
    languages: () => [],
    catalog_cached: () => true,
    check_updates: () => null,
    dated_page: () => null,
    catalog_search: () => [entry("ll", "Brochures and Booklets", null, "Höre auf Gott"), entry("lff", "Books", "lff_2", "Glücklich")],
    meetings: () => ({ workbook: null, study: null, other: [entry("sjj", "Songbooks", null, "Singt voller Freude")] }),
    publication: () => ({ card: card({ dir: "lff_2", symbol: "lff", title: "Glücklich" }), toc: [{ title: "Root", document_id: null, bible_book: null, children: [] }], books: [] }),
  };
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});
afterEach(cleanup);

const renderIn = (ui: React.ReactNode) =>
  render(
    <StrictMode>
      <AppProvider>{ui}</AppProvider>
    </StrictMode>,
  );
const tile = async (title: string) => (await screen.findByText(title)).closest(".group") as HTMLElement;
const openMenu = (t: HTMLElement) => fireEvent.click(within(t).getByLabelText("More"));

describe("Search", () => {
  it("gives result cards a menu, and Remove only for downloaded ones", async () => {
    renderIn(<OnlineView />);
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    openMenu(await tile("Höre auf Gott"));
    expect(screen.queryByText("Remove")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    openMenu(await tile("Glücklich"));
    expect(screen.getByText("Remove")).toBeTruthy();
  });
});

describe("Meetings", () => {
  it("gives the other meeting publications a menu", async () => {
    renderIn(<MeetingsView />);
    openMenu(await tile("Singt voller Freude"));
    expect(screen.getByText("Share Link")).toBeTruthy();
  });
});

describe("Updates", () => {
  it("lists an update with a menu that can remove the installed version", async () => {
    backend.check_updates = () => [
      { dir: "lff_2", langCode: "X", installedSize: 1, entry: entry("lff", "Books", "lff_2", "Glücklich") },
    ];
    renderIn(<UpdatesTab />);
    expect(within((await screen.findByText("Check now")).closest("div")!).getByText("Needs network")).toBeTruthy();
    fireEvent.click(await screen.findByText("Check now"));
    openMenu(await tile("Glücklich"));
    expect(screen.getByText("Remove")).toBeTruthy();
  });
});

describe("Publication", () => {
  it("toggles the favorite star and keeps it in sync with the stored list", async () => {
    renderIn(<PublicationView dir="lff_2" />);
    fireEvent.click(await screen.findByLabelText("Add to favorites"));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("favorites")!)).toEqual(["lff_2"]));
    fireEvent.click(await screen.findByLabelText("Remove from favorites"));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("favorites")!)).toEqual([]));
  });

  it("shows a favorite that was added elsewhere as set", async () => {
    localStorage.setItem("favorites", JSON.stringify(["lff_2"]));
    renderIn(<PublicationView dir="lff_2" />);
    expect(await screen.findByLabelText("Remove from favorites")).toBeTruthy();
  });
});

describe("Settings", () => {
  it("switches the content width and remembers it", async () => {
    renderIn(<SettingsView />);
    expect(document.documentElement.style.getPropertyValue("--page-max")).toBe("880px");
    // The selected tab outlives the view, so pick it explicitly.
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Interface" }));
    fireEvent.click(await screen.findByRole("button", { name: "Full width" }));
    expect(localStorage.getItem("layout")).toBe("wide");
    expect(document.documentElement.style.getPropertyValue("--page-max")).toBe("100000px");
    expect(screen.getByRole("button", { name: "Full width" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("switches to the easy-to-read font and remembers it", async () => {
    renderIn(<SettingsView />);
    expect(document.documentElement.dataset.font).toBe("standard");
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Reading" }));
    fireEvent.click(await screen.findByRole("button", { name: "Easy to read" }));
    expect(localStorage.getItem("readingFont")).toBe("legible");
    expect(document.documentElement.dataset.font).toBe("legible");
  });

  it("groups the settings into four tabs", async () => {
    renderIn(<SettingsView />);
    for (const name of ["Interface", "Reading", "Library & data", "About"]) {
      expect(await screen.findByRole("tab", { name })).toBeTruthy();
    }
    expect(screen.getByRole("tablist", { name: "Settings" })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Library & data" }));
    expect(await screen.findByRole("heading", { name: "Backup" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Library & data" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Interface" }).getAttribute("aria-selected")).toBe("false");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "About" }));
    expect(await screen.findByText(/unofficial reader/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "About" }).getAttribute("aria-selected")).toBe("true");
  });

  it("remembers the selected tab when the view comes back", async () => {
    const first = renderIn(<SettingsView />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Library & data" }));
    expect(await screen.findByRole("heading", { name: "Backup" })).toBeTruthy();
    first.unmount();
    renderIn(<SettingsView />);
    const tab = await screen.findByRole("tab", { name: "Library & data" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("heading", { name: "Backup" })).toBeTruthy();
  });
});

describe("Settings cache", () => {
  const usage = { catalog: 58_000_000, covers: 2_000_000, partial: 0, other: 400_000, total: 60_400_000 };
  const open = async () => {
    backend.cache_usage = () => usage;
    backend.clear_cache = () => null;
    renderIn(<SettingsView />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Library & data" }));
    expect(await screen.findByText("60 MB")).toBeTruthy();
  };
  const count = (cmd: string) => calls.filter((c) => c.cmd === cmd).length;

  it("keeps the cache when the confirmation is declined", async () => {
    vi.mocked(ask).mockResolvedValue(false);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Clear cache" }));
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(count("clear_cache")).toBe(0);
  });

  it("clears the cache once confirmed and measures it again", async () => {
    vi.mocked(ask).mockResolvedValue(true);
    await open();
    const before = count("cache_usage");
    fireEvent.click(screen.getByRole("button", { name: "Clear cache" }));
    await waitFor(() => expect(count("clear_cache")).toBe(1));
    await waitFor(() => expect(count("cache_usage")).toBeGreaterThan(before));
  });

  it("says so and keeps Clear disabled when the cache cannot be measured", async () => {
    backend.cache_usage = () => {
      throw new Error("permission denied");
    };
    renderIn(<SettingsView />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Library & data" }));
    expect(await screen.findByText("Cannot measure the cache")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Clear cache" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("waits for running downloads before clearing", async () => {
    backend.cache_usage = () => usage;
    backend.download_publication = () => new Promise(() => undefined);
    const Start = () => {
      const { download } = useApp();
      return <button onClick={() => void download(entry("lff", "Books", null, "Glücklich"))}>start</button>;
    };
    renderIn(
      <>
        <Start />
        <SettingsView />
      </>,
    );
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Library & data" }));
    expect(await screen.findByText("60 MB")).toBeTruthy();
    const clear = screen.getByRole("button", { name: "Clear cache" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    fireEvent.click(screen.getByText("start"));
    expect(await screen.findByText("Wait for the running downloads to finish.")).toBeTruthy();
    expect(clear.disabled).toBe(true);
  });
});

describe("Personal Study", () => {
  const note = (guid: string, title: string, color: number | null, lastModified: string) => ({
    guid, title, content: "", blockType: 0, blockIdentifier: null, markGuid: null, color, tags: [], lastModified, location: null,
  });

  it("narrows the notes by text and highlight color and changes their order", async () => {
    backend.user_data_summary = () => ({ marks: 0, notes: 2, tags: 0, bookmarks: 0, device: null });
    backend.tags = () => [];
    backend.bookmarks = () => [];
    backend.all_notes = () => [note("a", "Dusk visits", 1, "2026-10-03T00:00:00Z"), note("b", "Patient listening", 3, "2026-10-05T00:00:00Z")];
    renderIn(<PersonalView />);
    const titles = () => screen.getAllByText(/Dusk visits|Patient listening/).map((e) => e.textContent);
    await screen.findByText("Dusk visits");
    expect(titles()).toEqual(["Patient listening", "Dusk visits"]);
    fireEvent.change(screen.getByLabelText("Sort notes"), { target: { value: "oldest" } });
    expect(titles()).toEqual(["Dusk visits", "Patient listening"]);
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "patient" } });
    expect(titles()).toEqual(["Patient listening"]);
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Yellow" }));
    expect(titles()).toEqual(["Dusk visits"]);
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "zzz" } });
    expect(screen.getByText("No notes match.")).toBeTruthy();
  });
});

describe("Merging backups", () => {
  beforeEach(() => {
    vi.mocked(message).mockReset();
    vi.mocked(ask).mockReset();
    vi.mocked(open).mockReset();
  });
  const restoreSummary = { marks: 0, notes: 0, tags: 0, bookmarks: 0, device: null };
  const emptyUser = () => {
    backend.user_data_summary = () => ({ marks: 0, notes: 0, tags: 0, bookmarks: 0, device: null });
    backend.tags = () => [];
    backend.bookmarks = () => [];
    backend.all_notes = () => [];
  };
  const dataTab = async () => {
    renderIn(<SettingsView />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Library & data" }));
  };
  const report = (conflicts: { table: string; guid: string; summary: string }[]) => ({
    added: 2, updated: 1, unchanged: 0, conflicts, device: null,
  });

  it("is off by default and the checkbox is remembered", async () => {
    await dataTab();
    const box = (await screen.findByLabelText("Merge backups instead of replacing")) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(screen.getByRole("button", { name: "Restore backup…" })).toBeTruthy();
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(localStorage.getItem("mergeBackups")).toBe("true");
    expect(screen.getByRole("button", { name: "Merge backup…" })).toBeTruthy();
  });

  it("switches the button label in Personal Study too", async () => {
    emptyUser();
    renderIn(<PersonalView />);
    expect(await screen.findByRole("button", { name: "Restore backup…" })).toBeTruthy();
    cleanup();
    localStorage.setItem("mergeBackups", "true");
    renderIn(<PersonalView />);
    expect(await screen.findByRole("button", { name: "Merge backup…" })).toBeTruthy();
  });

  it("merges instead of restoring when it is on, and does nothing when declined", async () => {
    localStorage.setItem("mergeBackups", "true");
    backend.merge_backup = () => report([]);
    backend.restore_backup = () => restoreSummary;
    vi.mocked(open).mockResolvedValue("/tmp/b.jwlibrary");
    vi.mocked(ask).mockResolvedValue(false);
    await dataTab();
    fireEvent.click(await screen.findByRole("button", { name: "Merge backup…" }));
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(vi.mocked(ask).mock.calls[0][1]).toEqual({ title: "Merge backup?", kind: "info", okLabel: "Merge" });
    // Let the handler finish with the declined answer.
    await act(async () => {
      await vi.mocked(ask).mock.results[0].value;
    });
    expect(calls.some((c) => c.cmd === "merge_backup" || c.cmd === "restore_backup")).toBe(false);

    vi.mocked(ask).mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Merge backup…" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "merge_backup")).toBe(true));
    expect(calls.find((c) => c.cmd === "merge_backup")!.args).toEqual({ path: "/tmp/b.jwlibrary" });
    expect(calls.some((c) => c.cmd === "restore_backup")).toBe(false);
    expect(await screen.findByText("Merged 3 changes")).toBeTruthy();
    expect(message).not.toHaveBeenCalled();
  });

  it("shows the conflicts in a dialog", async () => {
    localStorage.setItem("mergeBackups", "true");
    backend.merge_backup = () => report([{ table: "Note", guid: "g1", summary: "Dusk visits" }]);
    vi.mocked(open).mockResolvedValue("/tmp/b.jwlibrary");
    vi.mocked(ask).mockResolvedValue(true);
    await dataTab();
    fireEvent.click(await screen.findByRole("button", { name: "Merge backup…" }));
    await waitFor(() => expect(message).toHaveBeenCalled());
    expect(vi.mocked(message).mock.calls[0]).toEqual([
      "1 conflict, your version was kept:\nNote: Dusk visits",
      { title: "Conflicts", kind: "warning" },
    ]);
  });

  it("restores instead of merging when it is off", async () => {
    backend.merge_backup = () => report([]);
    backend.restore_backup = () => restoreSummary;
    vi.mocked(open).mockResolvedValue("/tmp/b.jwlibrary");
    vi.mocked(ask).mockResolvedValue(true);
    await dataTab();
    fireEvent.click(await screen.findByRole("button", { name: "Restore backup…" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "restore_backup")).toBe(true));
    expect(calls.find((c) => c.cmd === "restore_backup")!.args).toEqual({ path: "/tmp/b.jwlibrary" });
    expect(calls.some((c) => c.cmd === "merge_backup")).toBe(false);
    expect(vi.mocked(ask).mock.calls[0][1]).toEqual({ title: "Restore backup?", kind: "warning", okLabel: "Restore" });
  });
});

describe("Go to", () => {
  it("opens with Ctrl+G and goes to the typed reference", async () => {
    backend.list_publications = () => [card({ dir: "nwtsty_2", symbol: "nwtsty", title: "Bible", isBible: true, langCode: "X" })];
    backend.publication = () => ({
      card: card({ dir: "nwtsty_2", symbol: "nwtsty", isBible: true }),
      toc: [],
      books: [{ number: 58, title: "Hebräer", chapter_title: "", book_document_id: null, chapters: 13 }],
    });
    renderIn(<GoTo />);
    await waitFor(() => expect(calls.some((c) => c.cmd === "list_publications")).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    const box = await screen.findByLabelText("Reference, for example Heb 10:24");
    await waitFor(() => expect((screen.getByRole("button", { name: "Go" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: "Zzz 1" } });
    fireEvent.submit(box.closest("form")!);
    expect(await screen.findByText("No such place in this Bible.")).toBeTruthy();
    // Asking again keeps the first place to return to, Tab stays in the box and Escape closes it.
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    const go = screen.getByRole("button", { name: "Go" });
    go.focus();
    fireEvent.keyDown(go, { key: "Tab" });
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    const again = await screen.findByLabelText("Reference, for example Heb 10:24");
    await waitFor(() => expect((screen.getByRole("button", { name: "Go" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(again, { target: { value: "Heb 10:24" } });
    fireEvent.submit(again.closest("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
