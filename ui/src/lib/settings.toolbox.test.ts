// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadToolboxLang, saveToolboxLang } from "@/lib/settings";

describe("toolboxLang", () => {
  it("round-trips an override and clears it", () => {
    saveToolboxLang("T");
    expect(loadToolboxLang()).toBe("T");
    saveToolboxLang(null);
    expect(loadToolboxLang()).toBeNull();
    expect(localStorage.getItem("toolboxLang")).toBeNull();
  });

  it("ignores a stored value that is not a language code", () => {
    localStorage.setItem("toolboxLang", "english");
    expect(loadToolboxLang()).toBeNull();
  });
});
