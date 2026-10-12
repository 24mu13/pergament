import { describe, expect, it } from "vitest";
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
