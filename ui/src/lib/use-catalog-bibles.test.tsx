// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CatalogEntry } from "./api";

const category = vi.fn<(lang: string, id: number) => Promise<CatalogEntry[] | null>>();
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), api: { category: (l: string, i: number) => category(l, i) } }));

import { resetCatalogBibles, useCatalogBibles } from "./use-catalog-bibles";

const entry = (symbol: string) => ({ item: { symbol } }) as unknown as CatalogEntry;

beforeEach(() => {
  resetCatalogBibles();
  category.mockReset();
});
afterEach(cleanup);

describe("useCatalogBibles", () => {
  it("reads nothing while disabled", () => {
    renderHook(() => useCatalogBibles(["X"], false, 0));
    expect(category).not.toHaveBeenCalled();
  });

  it("asks once per language even from two hooks at the same time", async () => {
    category.mockResolvedValue([entry("nwt")]);
    const a = renderHook(() => useCatalogBibles(["X", "X"], true, 0));
    renderHook(() => useCatalogBibles(["X"], true, 0));
    await waitFor(() => expect(a.result.current.X).toHaveLength(1));
    expect(category).toHaveBeenCalledTimes(1);
    expect(category).toHaveBeenCalledWith("X", 1);
  });

  it("tells every hook when a list arrives, also one mounted while it was read", async () => {
    let resolve!: (e: CatalogEntry[]) => void;
    category.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const first = renderHook(() => useCatalogBibles(["X"], true, 0));
    first.unmount();
    const second = renderHook(() => useCatalogBibles(["X"], true, 0));
    const third = renderHook(() => useCatalogBibles(["X"], true, 0));
    resolve([entry("nwt")]);
    await waitFor(() => expect(second.result.current.X).toHaveLength(1));
    expect(third.result.current.X).toHaveLength(1);
    expect(category).toHaveBeenCalledTimes(1);
  });

  it("keeps the last list while a new catalog version is read", async () => {
    category.mockResolvedValueOnce([entry("nwt")]);
    const { result, rerender } = renderHook(({ v }) => useCatalogBibles(["X"], true, v), { initialProps: { v: 0 } });
    await waitFor(() => expect(result.current.X).toHaveLength(1));
    let resolve!: (e: CatalogEntry[]) => void;
    category.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    rerender({ v: 1 });
    expect(result.current.X).toHaveLength(1);
    resolve([entry("nwt"), entry("nwtsty")]);
    await waitFor(() => expect(result.current.X).toHaveLength(2));
  });

  it("does not remember a failed read as empty", async () => {
    category.mockRejectedValueOnce(new Error("offline"));
    const { result, rerender } = renderHook(({ on }) => useCatalogBibles(["X"], on, 0), { initialProps: { on: true } });
    await waitFor(() => expect(category).toHaveBeenCalledTimes(1));
    category.mockResolvedValueOnce([entry("nwt")]);
    rerender({ on: false });
    rerender({ on: true });
    await waitFor(() => expect(result.current.X).toHaveLength(1));
    expect(category).toHaveBeenCalledTimes(2);
  });
});
