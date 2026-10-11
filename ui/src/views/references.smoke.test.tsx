// @vitest-environment jsdom
// The "download referenced publications" button of a publication page, with a mocked backend.
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
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: "main" }) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.0.0" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn(), save: vi.fn() }));

import { AppProvider } from "@/app";
import { PublicationView } from "@/views/publication";

let referenced: unknown;
const english = { code: "E", entry: entry("ll", null, null, "Listen to God") };
const german = { code: "X", entry: entry("lff", null, null, "Glücklich") };

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  localStorage.setItem("lang", "X");
  referenced = [english, german];
  backend = {
    list_publications: () => [],
    languages: () => [
      { code: "X", name: "German", vernacular: "Deutsch", rtl: false, signLanguage: false },
      { code: "E", name: "English", vernacular: "English", rtl: false, signLanguage: false },
    ],
    catalog_cached: () => true,
    check_updates: () => null,
    publication: () => ({ card: card({ dir: "w26_2" }), toc: [{ title: "", document_id: null, bible_book: null, children: [] }], books: [] }),
    referenced_publications: () => referenced,
    download_publication: () => new Promise((resolve) => setTimeout(() => resolve("dir"), 5)),
  };
});
afterEach(cleanup);

const renderView = () =>
  render(
    <AppProvider>
      <PublicationView dir="w26_2" />
    </AppProvider>,
  );
const button = () => screen.findByLabelText("Download referenced publications");
const downloads = () => calls.filter((c) => c.cmd === "download_publication");

describe("Download referenced publications", () => {
  it("downloads each publication in its own language, once, with a single summary toast", async () => {
    renderView();
    const b = await button();
    fireEvent.click(b);
    fireEvent.click(b); // a second click while running is ignored
    await screen.findByText("Imported 2 publications");
    expect(downloads().map((c) => c.args.lang)).toEqual(["E", "X"]);
    expect(screen.queryByText("Imported Listen to God")).toBeNull();
  });

  it("tells the user to load the catalog when there is none", async () => {
    referenced = null;
    renderView();
    fireEvent.click(await button());
    expect(await screen.findByText("Load the catalog first to download referenced publications.")).toBeTruthy();
    expect(downloads()).toHaveLength(0);
  });

  it("is hidden when nothing is missing", async () => {
    referenced = [];
    renderView();
    await waitFor(() => expect(calls.some((c) => c.cmd === "referenced_publications")).toBe(true));
    expect(screen.queryByLabelText("Download referenced publications")).toBeNull();
  });
});
