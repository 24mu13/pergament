// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Media, MediaDownload } from "@/lib/api";

const toast = vi.fn();
vi.mock("@/app", () => ({ useApp: () => ({ toast, lang: "X" }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
const mediaDownloads = vi.fn<() => Promise<MediaDownload[]>>();
const downloadMedia = vi.fn<() => Promise<void>>();
vi.mock("@/lib/api", () => ({ api: { mediaDownloads: () => mediaDownloads(), downloadMedia: () => downloadMedia() } }));

import { useMediaDownloads } from "@/components/media-card";

afterEach(cleanup);

const media = { key: "pub-a_X_1_VIDEO", title: "A", files: [{ label: "480p", size: 4 }] } as unknown as Media;
const saved = { id: 1, key: media.key, langCode: "X", title: "A" } as MediaDownload;

describe("useMediaDownloads", () => {
  it("shows a download finished after the view that started it was left", async () => {
    mediaDownloads.mockResolvedValue([]);
    let finish!: () => void;
    downloadMedia.mockReturnValueOnce(new Promise((r) => (finish = r)));
    const first = renderHook(() => useMediaDownloads());
    let started!: Promise<void>;
    act(() => {
      started = first.result.current.download(media, "480p", { category: "c", detailed: false });
    });
    first.unmount();
    const second = renderHook(() => useMediaDownloads());
    await waitFor(() => expect(mediaDownloads).toHaveBeenCalledTimes(2));
    expect(second.result.current.downloaded.has(media.key)).toBe(false);
    mediaDownloads.mockResolvedValue([saved]);
    await act(async () => {
      finish();
      await started;
    });
    await waitFor(() => expect(second.result.current.downloaded.get(media.key)).toEqual(saved));
  });
});
