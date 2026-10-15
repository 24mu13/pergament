import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

const md = (text: string) => renderMarkdown(text, { links: true });

describe("renderMarkdown", () => {
  it("wraps plain lines in paragraphs, joining single breaks", () => {
    expect(md("One\ntwo\n\nThree")).toBe("<p>One<br>two</p><p>Three</p>");
  });

  it("renders headings", () => {
    expect(md("# Big\n## Middle\n### Small")).toBe("<h1>Big</h1><h2>Middle</h2><h3>Small</h3>");
    expect(md("#No space")).toBe("<p>#No space</p>");
  });

  it("renders bold, italic and code", () => {
    expect(md("**bold** and *it* and _also_ and `x*y*z`")).toBe(
      "<p><strong>bold</strong> and <em>it</em> and <em>also</em> and <code>x*y*z</code></p>",
    );
  });

  it("leaves underscores inside words alone", () => {
    expect(md("snake_case_name")).toBe("<p>snake_case_name</p>");
  });

  it("renders bullet and numbered lists", () => {
    expect(md("- a\n* b\n\n1. one\n2. two")).toBe("<ul><li>a</li><li>b</li></ul><ol><li>one</li><li>two</li></ol>");
    expect(md("Intro\n- a\nAfter")).toBe("<p>Intro</p><ul><li>a</li></ul><p>After</p>");
  });

  it("renders http(s) links, leaving their URL untouched by emphasis", () => {
    expect(md("[*site*](https://example.org/a_b_c?x=1&y=2)")).toBe(
      '<p><a href="https://example.org/a_b_c?x=1&amp;y=2"><em>site</em></a></p>',
    );
  });

  it("renders code inside a link label", () => {
    expect(md("[`code` label](https://example.com)")).toBe('<p><a href="https://example.com"><code>code</code> label</a></p>');
  });

  it("keeps balanced parentheses in a link URL", () => {
    expect(md("[x](https://en.wikipedia.org/wiki/Foo_(bar))")).toBe('<p><a href="https://en.wikipedia.org/wiki/Foo_(bar)">x</a></p>');
  });

  it("never leaves placeholder characters in the output", () => {
    expect(md("[a](https://x.com/`y`)")).not.toMatch(/\u0000/);
    expect(md("[`a` **b**](https://x.com) and `c`")).not.toMatch(/\u0000/);
  });

  it("shows links as underlined text when they cannot be clicked", () => {
    expect(renderMarkdown("[site](https://example.org)", { links: false })).toBe('<p><span class="md-link">site</span></p>');
  });

  it("keeps other link schemes as text", () => {
    expect(md("[x](javascript:alert(1))")).toBe("<p>[x](javascript:alert(1))</p>");
  });

  it("renders links into the app", () => {
    expect(md("[Mt 24:14](pergament://bible/40:24:14-40:24:14)")).toBe(
      '<p><a href="pergament://bible/40:24:14-40:24:14">Mt 24:14</a></p>',
    );
    expect(md("[a](pergament://verse/X:1001070143/8:38-8:40)")).toBe('<p><a href="pergament://verse/X:1001070143/8:38-8:40">a</a></p>');
    expect(md("[a](pergament://pub/X:1102016001/3-4)")).toBe('<p><a href="pergament://pub/X:1102016001/3-4">a</a></p>');
    expect(renderMarkdown("[a](pergament://bible/19:23)", { links: false })).toBe('<p><span class="md-link">a</span></p>');
  });

  it("keeps app links of other kinds or shapes as text", () => {
    expect(md('[a](pergament://bible/1:1"onmouseover=alert(1))')).not.toContain("<a");
    expect(md("[a](pergament://media/x)")).toBe("<p>[a](pergament://media/x)</p>");
    expect(md("[a](pergament://bible/x/../y)")).not.toContain("<a");
    expect(md("[a](pergament://bible/)")).not.toContain("<a");
  });

  it("escapes HTML instead of rendering it", () => {
    expect(md('<img src=x onerror="alert(1)"> & <b>')).toBe("<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;b&gt;</p>");
    expect(md('[a](https://x.org/"onmouseover="alert(1))')).not.toContain('"onmouseover');
  });

  it("returns nothing for empty text", () => {
    expect(md("")).toBe("");
    expect(md("  \n\n ")).toBe("");
  });
});
