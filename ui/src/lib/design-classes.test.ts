// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { addDesignRules, designRule, resetDesignRules } from "@/lib/design-classes";

afterEach(resetDesignRules);

describe("designRule", () => {
  it("turns spacing steps into quarters of the text size, on the sides the name gives", () => {
    expect(designRule("du-margin-top--8")).toBe(".du-margin-top--8.du-margin-top--8{margin-top:2em}");
    expect(designRule("du-padding-vertical--2")).toContain("padding-top:0.5em;padding-bottom:0.5em");
    expect(designRule("du-margin-horizontal--negative-4")).toContain("margin-inline-start:-1em");
    expect(designRule("du-margin-inlineEnd-desktopOnly--oneHalf")).toContain("margin-inline-end:50%");
  });

  it("applies children rules to the children and breakpoints by the reader's width", () => {
    expect(designRule("du-margin-children-inlineStart--6")).toBe(
      ".du-margin-children-inlineStart--6.du-margin-children-inlineStart--6 > *{margin-inline-start:1.5em}",
    );
    expect(designRule("du-margin-top-desktopOnly--0")).toMatch(/^@container reader \(min-width: [^)]+\)\{.*margin-top:0\}\}$/);
    expect(designRule("du-display-mobileOnly--none")).toMatch(/^@container reader \(max-width: [^)]+\)\{.*display:none\}\}$/);
  });

  it("gives colors a lighter shade for text and a dark tint for backgrounds in the dark theme", () => {
    const text = designRule("du-color--coolGray-700")!;
    expect(text).toContain("{color:hsl(218 12% 37%)}");
    expect(text).toContain(".dark .du-color--coolGray-700.du-color--coolGray-700{color:hsl(218 12% 75%)}");
    const fill = designRule("du-bgColor--warmGray-50")!;
    expect(fill).toContain("background-color:hsl(30 8% 97%)");
    expect(fill).toContain(".dark ");
    expect(designRule("du-bgColor--orange-600")).not.toContain(".dark ");
  });

  it("lays out columns by their share of the width", () => {
    expect(designRule("dc-columns")).toContain("display:flex");
    expect(designRule("dc-column-width--oneThird")).toContain("{flex:333 1 0}");
    expect(designRule("dc-columns-desktopOnly")).toMatch(/^@container reader \(min-width/);
  });

  it("leaves classes alone it does not know or that styles.css styles", () => {
    for (const cls of ["du-margin-top-12", "du-color--gray--800", "du-fontFamily--serif", "du-color--teal-600", "dc-icon--gem", "sb", "du-margin-diagonal--4"])
      expect(designRule(cls), cls).toBeNull();
  });
});

describe("addDesignRules", () => {
  it("adds one rule per class of a page, once", () => {
    const page = document.createElement("div");
    page.innerHTML = `<p class="du-margin-top--4 sb">a</p><p class="du-margin-top--4 du-textAlign--center">b</p>`;
    addDesignRules(page);
    addDesignRules(page);
    const css = document.querySelector("style[data-design-classes]")!.textContent!;
    expect(css.match(/du-margin-top--4\.du-margin-top--4\{/g)).toHaveLength(1);
    expect(css).toContain("text-align:center");
  });
});
