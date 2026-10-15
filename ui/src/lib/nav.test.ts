import { describe, expect, it } from "vitest";
import { chapterTarget } from "./api";
import { currentView, initialNav, navReducer, type NavState } from "./nav";

const run = (state: NavState, ...actions: Parameters<typeof navReducer>[1][]) => actions.reduce(navReducer, state);

describe("rail sections", () => {
  it("brings a section back as it was left", () => {
    const s = run(
      initialNav,
      { type: "switch", to: "meetings", view: { name: "meetings" } },
      { type: "push", view: { name: "online" } },
      { type: "switch", to: "library", view: { name: "library" }, scroll: 120 },
      { type: "switch", to: "meetings", view: { name: "meetings" } },
    );
    expect(s.stack.map((v) => v.name)).toEqual(["meetings", "online"]);
    expect(s.section).toBe("meetings");
  });

  it("keeps the scroll position of the view that was left", () => {
    const s = run(
      initialNav,
      { type: "switch", to: "meetings", view: { name: "meetings" } },
      { type: "switch", to: "library", view: { name: "library" }, scroll: 300 },
      { type: "switch", to: "meetings", view: { name: "meetings" } },
    );
    expect(currentView(s)).toEqual({ name: "meetings", scroll: 300 });
  });

  it("starts a section over when its own button is pressed", () => {
    const s = run(
      initialNav,
      { type: "switch", to: "meetings", view: { name: "meetings" } },
      { type: "push", view: { name: "online" } },
      { type: "switch", to: "meetings", view: { name: "meetings" } },
    );
    expect(s.stack).toEqual([{ name: "meetings" }]);
  });
});

describe("switch with an explicit stack", () => {
  it("replaces the stack of the section it is already in", () => {
    const s = run(
      initialNav,
      { type: "switch", to: "bible", view: { name: "bible" } },
      {
        type: "switch", to: "bible", view: { name: "publication", dir: "nwt_E" },
        stack: [
          { name: "publication", dir: "nwt_E" },
          { name: "chapters", dir: "nwt_E", book: 43 },
          { name: "reader", target: chapterTarget("nwt_E", 43, 3) },
        ],
      },
    );
    expect(s.stack.map((v) => v.name)).toEqual(["publication", "chapters", "reader"]);
    expect(s.section).toBe("bible");
  });

  it("wins over the saved stack of the target section", () => {
    const s = run(
      initialNav,
      { type: "switch", to: "bible", view: { name: "bible" } },
      { type: "push", view: { name: "publication", dir: "nwt_X" } },
      { type: "switch", to: "home", view: { name: "home" } },
      {
        type: "switch", to: "bible", view: { name: "publication", dir: "nwt_E" },
        stack: [{ name: "reader", target: chapterTarget("nwt_E", 43, 3) }],
      },
    );
    expect(s.stack).toEqual([{ name: "reader", target: chapterTarget("nwt_E", 43, 3) }]);
    expect(s.saved.bible).toBeUndefined();
  });
});
