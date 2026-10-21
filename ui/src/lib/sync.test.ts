import { describe, expect, it } from "vitest";
import { nothingSeen, syncErrorText, syncNotices } from "@/lib/sync";
import type { SyncStatus } from "@/lib/types";

const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  folder: "/sync",
  lastSync: null,
  lastDevice: null,
  error: null,
  pending: [],
  conflicts: [],
  ...over,
});
const peer = (file: string, deletions = 7) => ({ file, device: `Pergament (${file})`, deletions });

describe("syncNotices", () => {
  it("tells about a new pending peer once", () => {
    const first = syncNotices(nothingSeen, status({ pending: [peer("a")] }));
    expect(first.notices).toEqual(["Pergament (a) wants to delete 7 items. Open Settings to decide."]);
    const again = syncNotices(first.seen, status({ pending: [peer("a", 8)] }));
    expect(again.notices).toEqual([]);
    const second = syncNotices(again.seen, status({ pending: [peer("a"), peer("b", 9)] }));
    expect(second.notices).toEqual(["Pergament (b) wants to delete 9 items. Open Settings to decide."]);
  });

  it("tells again once a resolved peer waits anew", () => {
    const first = syncNotices(nothingSeen, status({ pending: [peer("a")] }));
    const resolved = syncNotices(first.seen, status());
    expect(resolved.notices).toEqual([]);
    expect(syncNotices(resolved.seen, status({ pending: [peer("a")] })).notices).toHaveLength(1);
  });

  it("tells about a folder error once, and about a different one", () => {
    const first = syncNotices(nothingSeen, status({ error: "cannot read the sync folder: gone" }));
    expect(first.notices).toEqual(["Sync: cannot read the sync folder: gone"]);
    const same = syncNotices(first.seen, status({ error: "cannot read the sync folder: gone" }));
    expect(same.notices).toEqual([]);
    const other = syncNotices(same.seen, status({ error: "cannot write to the sync folder: full" }));
    expect(other.notices).toEqual(["Sync: cannot write to the sync folder: full"]);
    const cleared = syncNotices(other.seen, status());
    expect(syncNotices(cleared.seen, status({ error: "cannot write to the sync folder: full" })).notices).toHaveLength(1);
  });

  it("says nothing while sync is off", () => {
    const off = syncNotices(nothingSeen, status({ folder: null, error: "x", pending: [peer("a")] }));
    expect(off.notices).toEqual([]);
  });
});

describe("syncErrorText", () => {
  it("translates the library folder refusal and passes the rest", () => {
    expect(syncErrorText("The library folder and its backups folder cannot be the sync folder.")).toBe(
      "The library folder and its backups folder cannot be the sync folder.",
    );
    expect(syncErrorText("not a folder")).toBe("not a folder");
  });
});
