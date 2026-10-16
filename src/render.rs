//! Turn decoded publication HTML into clean, sanitized HTML.
//!
//! Decoded content is untrusted. It is first rewritten (links, images,
//! footnote and cross-reference markers) and then passed through an
//! allow-list sanitizer, as is everything else that ends up in the output.
//! A publication's own `<style>` elements are cleaned separately and scoped to
//! the page they came with (`scope_stylesheet`).
//!
//! Links are rewritten to the `pergament:` scheme so a viewer can route them:
//! - `pergament://bible/{book}:{ch}:{v}-{book}:{ch}:{v}` for Bible references,
//! - `pergament://pub/{lang}:{meps_document_id}/…` for publication links.

use std::cell::RefCell;
use std::collections::HashSet;
use std::fmt::Write as _;
use std::path::Path;

use lol_html::html_content::{Element, TextChunk};
use lol_html::{RewriteStrSettings, element, rewrite_str, text};

use crate::links::{MediaKind, MediaRef};
use crate::reader::{Chapter, OutlineEntry, Publication, VerseRef};
use crate::{Error, Result};

#[derive(Debug, Clone, Default)]
pub struct RenderOptions {
    /// URL prefix for images, ending in `/`, e.g. `file:///…/publications/nwtsty_2/`.
    /// Images are dropped when `None`.
    pub media_base: Option<String>,
    /// Wrap the result in a complete HTML page with styles.
    pub standalone: bool,
}

pub struct Renderer<'a> {
    publication: &'a Publication,
    options: RenderOptions,
    sanitizer: ammonia::Builder<'static>,
    abbreviations: std::cell::OnceCell<std::collections::HashMap<i64, String>>,
}

/// The overview of a Bible book, shown with its chapters.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookOverview {
    /// The document with the overview, to be rendered as a page.
    pub document: Option<i64>,
    /// The book's introduction video, if it has one yet.
    pub video: Option<MediaRef>,
}

/// Study pane content of a Bible chapter.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterStudy {
    /// e.g. "1. Mose: Übersicht".
    pub outline_title: Option<String>,
    pub outline: Vec<OutlineEntry>,
    /// Verses that have footnotes, cross references or study notes, in order.
    pub verses: Vec<VerseStudy>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VerseStudy {
    pub chapter: i64,
    pub verse: i64,
    pub footnotes: Vec<StudyFootnote>,
    pub xrefs: Vec<StudyXref>,
    /// Sanitized study note HTML.
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StudyFootnote {
    /// Marker text in the verse, e.g. "a"; links to `#footnotesource{index}`.
    pub marker: String,
    pub index: i64,
    pub html: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StudyXref {
    /// Marker letter in the verse; links to `#xrefsource{block}`.
    pub marker: String,
    pub block: i64,
    pub refs: Vec<StudyRef>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StudyRef {
    pub href: String,
    pub label: String,
    /// A parallel account, such as Mark 1:12 for Matthew 4:1.
    pub parallel: bool,
}

/// Markers found while rewriting: `(number, marker text)`.
#[derive(Debug, Default)]
struct Markers {
    footnotes: Vec<(i64, String)>,
    citations: Vec<(i64, String)>,
    /// The text of each `<style>` element, which the sanitizer would drop.
    styles: Vec<String>,
}

impl<'a> Renderer<'a> {
    pub fn new(publication: &'a Publication, options: RenderOptions) -> Self {
        Self {
            publication,
            options,
            sanitizer: sanitizer(),
            abbreviations: std::cell::OnceCell::new(),
        }
    }

    /// Render a document by `DocumentId`.
    pub fn document(&self, id: i64) -> Result<String> {
        let (info, html) = self.publication.document(id)?;
        let Some(html) = html else {
            return Err(Error::NotFound(format!(
                "document {id} has no content{}",
                if self.publication.is_bible() {
                    " (Bible books are rendered per chapter, e.g. `1:1`)"
                } else {
                    ""
                }
            )));
        };
        let (mut body, markers) = self.rewrite(&html)?;
        // Most documents carry their footnotes inline; add any that are missing.
        let missing: Vec<_> = markers
            .footnotes
            .iter()
            .filter(|(n, _)| !body.contains(&format!("id=\"footnote{n}\"")))
            .cloned()
            .collect();
        body.push_str(&self.footnotes_section(id, &missing)?);
        Ok(self.finish_styled(&info.title, &body, &markers.styles))
    }

    /// Render the `DatedText` entry covering `date` (`YYYYMMDD`), e.g. one day
    /// of the daily text.
    pub fn dated_text(&self, date: i64) -> Result<String> {
        let dated = self
            .publication
            .dated_text(date)?
            .ok_or_else(|| Error::NotFound(format!("no dated text for {date}")))?;
        let (body, markers) = self.rewrite(&dated.content)?;
        Ok(self.finish_styled("", &body, &markers.styles))
    }

    /// Render one Bible chapter with footnotes, cross references and study notes.
    pub fn chapter(&self, book: i64, chapter: i64) -> Result<String> {
        let ch = self.publication.chapter(book, chapter)?;
        let title = format!("{} {}", ch.book.chapter_title, ch.number);
        let mut body = String::from("<article class=\"bible-chapter\">");
        if let Some(pre) = &ch.pre_content {
            body.push_str(&self.rewrite(pre)?.0);
        }
        let _ = write!(body, "<h2 class=\"chapter-title\">{}</h2>", escape(&title));
        let (content, markers) = self.rewrite(&ch.content)?;
        body.push_str(&content);
        if let Some(post) = &ch.post_content {
            body.push_str(&self.rewrite(post)?.0);
        }
        body.push_str("</article>");

        if let Some(doc) = ch.book.book_document_id {
            body.push_str(&self.footnotes_section(doc, &markers.footnotes)?);
            body.push_str(&self.citations_section(doc, &markers.citations)?);
        }
        body.push_str(&self.study_notes_section(&ch)?);
        Ok(self.finish(&title, &body))
    }

    fn finish(&self, title: &str, body: &str) -> String {
        self.finish_styled(title, body, &[])
    }

    /// Like `finish`, with the publication's own stylesheets applied to this page only.
    fn finish_styled(&self, title: &str, body: &str, styles: &[String]) -> String {
        let mut clean = self.sanitizer.clean(body).to_string();
        let sheet = scope_stylesheet(&styles.join("\n"), self.options.media_base.as_deref());
        if let Some((scope, css)) = sheet {
            // The outer box keeps whatever the stylesheet positions or enlarges inside the page; the
            // stylesheet cannot select it, since its rules reach only the inner box and what is in it.
            clean = format!(
                "<div class=\"pub-sheet\" style=\"contain:layout paint;overflow:clip\"><style>{css}</style><div class=\"{scope}\">{clean}</div></div>"
            );
        }
        if self.options.standalone {
            page(title, &clean)
        } else {
            clean
        }
    }

    fn footnotes_section(&self, document_id: i64, markers: &[(i64, String)]) -> Result<String> {
        let mut out = String::new();
        let mut seen = HashSet::new();
        for (n, letter) in markers {
            if !seen.insert(*n) {
                continue;
            }
            let Some(html) = self.publication.footnote(document_id, *n)? else {
                continue;
            };
            let _ = write!(
                out,
                "<div class=\"footnote\"><a class=\"fn-back\" href=\"#footnotesource{n}\">{}</a>{}</div>",
                escape(letter.trim()),
                self.rewrite(&html)?.0
            );
        }
        Ok(section("footnotes", "Footnotes", &out))
    }

    fn citations_section(&self, document_id: i64, markers: &[(i64, String)]) -> Result<String> {
        let mut out = String::new();
        let mut seen = HashSet::new();
        for (n, letter) in markers {
            if !seen.insert(*n) {
                continue;
            }
            let mut refs = Vec::new();
            for (first, last) in self.publication.citations(document_id, *n)? {
                refs.push(self.reference_link(first, last)?);
            }
            if refs.is_empty() {
                continue;
            }
            let _ = write!(
                out,
                "<p class=\"xref\" id=\"xref{n}\"><a class=\"xr-back\" href=\"#xrefsource{n}\">{}</a> {}</p>",
                escape(letter.trim()),
                refs.join("; ")
            );
        }
        Ok(section("xrefs", "Cross references", &out))
    }

    fn study_notes_section(&self, ch: &Chapter) -> Result<String> {
        let mut out = String::new();
        for note in self
            .publication
            .study_notes(ch.first_verse_id, ch.last_verse_id)?
        {
            let _ = write!(
                out,
                "<div class=\"study-note\" id=\"note{}\">{}{}</div>",
                note.verse_id,
                self.rewrite(&note.label)?.0,
                self.rewrite(&note.content)?.0
            );
        }
        Ok(section("study-notes", "Study notes", &out))
    }

    /// `<a href="pergament://bible/…">Ps 23:1-3</a>` for a verse id range.
    fn reference_link(&self, first: i64, last: i64) -> Result<String> {
        let (href, label) = self.reference(first, last)?;
        Ok(format!(
            "<a class=\"b\" href=\"{href}\">{}</a>",
            escape(&label)
        ))
    }

    /// Link target and label for a verse id range, using the publication's
    /// own book abbreviations ("Jos 24:3", "Apg 7:3, 4", "Ps 23:1-6").
    fn reference(&self, first: i64, last: i64) -> Result<(String, String)> {
        let a = self.publication.verse_ref(first)?;
        let b = self.publication.verse_ref(last)?;
        let name = |book: i64| -> Result<String> {
            Ok(match self.abbreviations()?.get(&book) {
                Some(abbr) => abbr.clone(),
                None => self.publication.bible_book(book)?.chapter_title,
            })
        };
        let label = reference_label(&name(a.book)?, &name(b.book)?, a, b);
        Ok((bible_url(a, b), label))
    }

    fn abbreviations(&self) -> Result<&std::collections::HashMap<i64, String>> {
        if let Some(map) = self.abbreviations.get() {
            return Ok(map);
        }
        let map = self.publication.book_abbreviations()?;
        Ok(self.abbreviations.get_or_init(|| map))
    }

    /// Footnotes, cross references and study notes of a chapter grouped by
    /// verse, plus the outline lines for the chapter (the study pane).
    pub fn chapter_study(&self, book: i64, chapter: i64) -> Result<ChapterStudy> {
        use std::collections::BTreeMap;
        let ch = self.publication.chapter(book, chapter)?;
        // Marker letters as they appear in the text.
        let markers = self.rewrite(&ch.content)?.1;
        let fn_letter: std::collections::HashMap<i64, String> = markers
            .footnotes
            .iter()
            .map(|(n, l)| (*n, l.trim().to_owned()))
            .collect();
        let xr_letter: std::collections::HashMap<i64, String> = markers
            .citations
            .iter()
            .map(|(n, l)| (*n, l.trim().to_owned()))
            .collect();

        let mut verses: BTreeMap<i64, VerseStudy> = BTreeMap::new();

        if let Some(doc) = ch.book.book_document_id {
            for (verse, index, html) in
                self.publication
                    .footnotes_for_verses(doc, ch.first_verse_id, ch.last_verse_id)?
            {
                let html = self.clean(&self.rewrite(&html)?.0);
                verse_entry(&mut verses, self.publication, verse)?
                    .footnotes
                    .push(StudyFootnote {
                        marker: fn_letter.get(&index).cloned().unwrap_or_default(),
                        index,
                        html,
                    });
            }
            let mut last_block = None;
            for c in
                self.publication
                    .citations_for_verses(doc, ch.first_verse_id, ch.last_verse_id)?
            {
                let (verse, block) = (c.verse, c.block);
                let (href, label) = self.reference(c.first, c.last)?;
                let v = verse_entry(&mut verses, self.publication, verse)?;
                if last_block != Some(block) || v.xrefs.is_empty() {
                    v.xrefs.push(StudyXref {
                        marker: xr_letter.get(&block).cloned().unwrap_or_default(),
                        block,
                        refs: Vec::new(),
                    });
                }
                last_block = Some(block);
                v.xrefs
                    .last_mut()
                    .expect("pushed above")
                    .refs
                    .push(StudyRef {
                        href,
                        label,
                        parallel: c.parallel,
                    });
            }
        }
        for note in self
            .publication
            .study_notes(ch.first_verse_id, ch.last_verse_id)?
        {
            let html = self.clean(&self.rewrite(&note.content)?.0);
            verse_entry(&mut verses, self.publication, note.verse_id)?
                .notes
                .push(html);
        }

        Ok(ChapterStudy {
            outline_title: self.publication.overview_title(book)?,
            outline: self.publication.outline(book, chapter)?,
            verses: verses.into_values().collect(),
        })
    }

    /// What the chapter list of a Bible book shows besides the chapters: its overview and introduction video.
    pub fn book_overview(&self, book: i64, lang_code: Option<&str>) -> Result<BookOverview> {
        let video = match (self.publication.book_video(book)?, lang_code) {
            (Some((pub_symbol, track)), Some(lang)) => Some(MediaRef {
                pub_symbol,
                issue: None,
                track,
                kind: MediaKind::Video,
                lang_code: lang.to_owned(),
            }),
            _ => None,
        };
        Ok(BookOverview {
            video,
            document: self.publication.overview_document(book)?,
        })
    }

    /// Rewrite and sanitize one HTML fragment, e.g. an excerpt of the Research Guide.
    pub fn fragment(&self, html: &str) -> Result<String> {
        Ok(self.clean(&self.rewrite(html)?.0))
    }

    fn clean(&self, html: &str) -> String {
        self.sanitizer.clean(html).to_string()
    }

    /// Rewrite links, images and markers in one HTML fragment.
    fn rewrite(&self, html: &str) -> Result<(String, Markers)> {
        let markers = RefCell::new(Markers::default());
        let media_base = self.options.media_base.as_deref();
        let out = rewrite_str(
            html,
            RewriteStrSettings::new()
                // Answer fields are dropped by the sanitizer; each one's id (`TextTag` in
                // user data) stays on an empty marker that says which kind it was.
                .append_element_content_handler(element!("textarea[id]", |el| {
                    to_field_marker(el, "gen-tag")
                }))
                .append_element_content_handler(element!("input[id]", |el| {
                    match el.get_attribute("type").as_deref() {
                        Some("checkbox") => to_field_marker(el, "gen-tag gen-check"),
                        Some("text") | None => to_field_marker(el, "gen-tag gen-line"),
                        _ => {
                            el.remove();
                            Ok(())
                        }
                    }
                }))
                // Empty tooltip anchors and print page markers.
                .append_element_content_handler(element!("span.tt, span.pageNum", |el| {
                    el.remove();
                    Ok(())
                }))
                .append_element_content_handler(element!("span[data-fnid]", |el| {
                    let n = int_attr(el, "data-fnid");
                    markers.borrow_mut().footnotes.push((n, String::new()));
                    to_marker_link(
                        el,
                        "fn",
                        &format!("footnote{n}"),
                        &format!("footnotesource{n}"),
                    )
                }))
                .append_element_content_handler(text!("span[data-fnid]", |t: &mut TextChunk| {
                    if let Some(last) = markers.borrow_mut().footnotes.last_mut() {
                        last.1.push_str(t.as_str());
                    }
                    Ok(())
                }))
                .append_element_content_handler(element!("span[data-mid]", |el| {
                    let n = int_attr(el, "data-mid");
                    markers.borrow_mut().citations.push((n, String::new()));
                    to_marker_link(el, "xr", &format!("xref{n}"), &format!("xrefsource{n}"))
                }))
                .append_element_content_handler(text!("span[data-mid]", |t: &mut TextChunk| {
                    if let Some(last) = markers.borrow_mut().citations.last_mut() {
                        last.1.push_str(t.as_str());
                    }
                    Ok(())
                }))
                .append_element_content_handler(element!("a[href]", |el| {
                    match el.get_attribute("href").as_deref().and_then(rewrite_href) {
                        Some(href) => el.set_attribute("href", &href)?,
                        None => el.remove_attribute("href"),
                    }
                    Ok(())
                }))
                // A picture in a style, such as a lesson's background, is found like an
                // `img`; any other `url()` would load from outside, so it goes.
                .append_element_content_handler(element!("[style]", |el| {
                    let style = el.get_attribute("style").unwrap_or_default();
                    el.set_attribute("style", &rewrite_style(&style, media_base))?;
                    Ok(())
                }))
                // A publication's own stylesheet, applied to its page by `finish_styled`.
                .append_element_content_handler(element!("style", |el| {
                    markers.borrow_mut().styles.push(String::new());
                    el.remove();
                    Ok(())
                }))
                .append_element_content_handler(text!("style", |t: &mut TextChunk| {
                    if let Some(last) = markers.borrow_mut().styles.last_mut() {
                        last.push_str(t.as_str());
                    }
                    Ok(())
                }))
                .append_element_content_handler(element!("img", |el| {
                    let src = el.get_attribute("src");
                    match (media_base, src.as_deref().and_then(media_name)) {
                        (Some(base), Some(name)) => {
                            el.set_attribute("src", &format!("{base}{name}"))?
                        }
                        _ => el.remove(),
                    }
                    Ok(())
                })),
        )
        .map_err(|e| Error::Decode(format!("HTML rewrite: {e}")))?;
        Ok((out, markers.into_inner()))
    }
}

fn to_field_marker(el: &mut Element<'_, '_>, class: &str) -> lol_html::HandlerResult {
    let id = el.get_attribute("id").unwrap_or_default();
    el.replace(
        &format!("<span class=\"{class}\" id=\"{}\"></span>", escape(&id)),
        lol_html::html_content::ContentType::Html,
    );
    Ok(())
}

/// Keep the declarations of an inline style, with each `url(jwpub-media://NAME)`
/// pointing at the publication's pictures; a declaration with any other `url()`
/// is dropped. The sanitizer then keeps only the allowed properties.
fn rewrite_style(style: &str, media_base: Option<&str>) -> String {
    let mut out = Vec::new();
    for decl in style.split(';').map(str::trim).filter(|d| !d.is_empty()) {
        let Some(start) = decl.find("url(") else {
            out.push(decl.to_owned());
            continue;
        };
        let Some(len) = decl[start..].find(')') else {
            continue;
        };
        let inner = decl[start + 4..start + len]
            .trim()
            .trim_matches(['\'', '"']);
        let (Some(base), Some(name)) = (media_base, media_name(inner)) else {
            continue;
        };
        if decl[start + len + 1..].contains("url(") {
            continue;
        }
        out.push(format!(
            "{}url(\"{base}{name}\"){}",
            &decl[..start],
            &decl[start + len + 1..]
        ));
    }
    out.join("; ")
}

/// A publication's stylesheet, made safe to put into the app's page: comments, `@import`,
/// `@charset`, `@namespace` and `@font-face` are dropped, each `url()` points at the
/// publication's pictures or is dropped, and `<` is escaped so it cannot end the `<style>`
/// element. The rules are wrapped in `@scope`, so they reach only the page's own box; a
/// stylesheet whose braces do not balance could close that scope, so it is refused.
/// Returns the scope's class and the CSS.
fn scope_stylesheet(css: &str, media_base: Option<&str>) -> Option<(String, String)> {
    let chars: Vec<char> = css.chars().collect();
    let mut out = String::with_capacity(css.len());
    let mut depth = 0usize;
    let mut i = 0;
    // Skips a string starting at `i`, returning the index after it.
    let string_end = |i: usize| -> usize {
        let quote = chars[i];
        let mut j = i + 1;
        while j < chars.len() && chars[j] != quote && chars[j] != '\n' {
            j += if chars[j] == '\\' { 2 } else { 1 };
        }
        (j + 1).min(chars.len())
    };
    let starts = |i: usize, word: &str| -> bool {
        let w: Vec<char> = word.chars().collect();
        chars.len() >= i + w.len()
            && chars[i..i + w.len()]
                .iter()
                .zip(&w)
                .all(|(a, b)| a.eq_ignore_ascii_case(b))
    };
    while i < chars.len() {
        let c = chars[i];
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            let end = (i + 2..chars.len().saturating_sub(1))
                .find(|&j| chars[j] == '*' && chars[j + 1] == '/');
            i = end.map_or(chars.len(), |j| j + 2);
            out.push(' ');
        } else if c == '"' || c == '\'' {
            let end = string_end(i);
            out.extend(
                chars[i..end]
                    .iter()
                    .map(|&c| if c == '<' { '\u{fffd}' } else { c }),
            );
            i = end;
        } else if c == '\\' {
            out.extend(&chars[i..(i + 2).min(chars.len())]);
            i += 2;
        } else if c == '{' {
            depth += 1;
            out.push(c);
            i += 1;
        } else if c == '}' {
            depth = depth.checked_sub(1)?;
            out.push(c);
            i += 1;
        } else if c == '<' {
            out.push_str("\\3c ");
            i += 1;
        } else if c == '@'
            && ["@import", "@charset", "@namespace"]
                .iter()
                .any(|w| starts(i, w))
        {
            // A statement up to its semicolon.
            while i < chars.len() && chars[i] != ';' && chars[i] != '{' && chars[i] != '}' {
                i = if chars[i] == '"' || chars[i] == '\'' {
                    string_end(i)
                } else {
                    i + 1
                };
            }
            if chars.get(i) == Some(&';') {
                i += 1;
            }
        } else if c == '@' && starts(i, "@font-face") {
            // A block, with any braces inside it.
            let mut d = 0usize;
            while i < chars.len() {
                match chars[i] {
                    '"' | '\'' => i = string_end(i),
                    '{' => {
                        d += 1;
                        i += 1;
                    }
                    '}' => {
                        i += 1;
                        d = d.checked_sub(1)?;
                        if d == 0 {
                            break;
                        }
                    }
                    _ => i += 1,
                }
            }
        } else if starts(i, "url(") {
            let mut j = i + 4;
            let mut inner = String::new();
            while j < chars.len() && chars[j] != ')' {
                if chars[j] == '"' || chars[j] == '\'' {
                    let end = string_end(j);
                    inner.extend(&chars[j + 1..end.saturating_sub(1).max(j + 1)]);
                    j = end;
                } else {
                    inner.push(chars[j]);
                    j += 1;
                }
            }
            i = (j + 1).min(chars.len());
            match (media_base, media_name(inner.trim())) {
                (Some(base), Some(name)) => {
                    let _ = write!(out, "url(\"{base}{name}\")");
                }
                _ => out.push_str("none"),
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    if depth != 0 || out.trim().is_empty() {
        return None;
    }
    let mut hasher = std::hash::DefaultHasher::new();
    std::hash::Hash::hash(&out, &mut hasher);
    let scope = format!("pub-sheet-{:x}", std::hash::Hasher::finish(&hasher));
    Some((scope.clone(), format!("@scope (.{scope}) {{\n{out}\n}}")))
}

fn to_marker_link(
    el: &mut Element<'_, '_>,
    class: &str,
    target: &str,
    id: &str,
) -> lol_html::HandlerResult {
    el.set_tag_name("a")?;
    let mut attrs: Vec<String> = el.attributes().iter().map(|a| a.name()).collect();
    attrs.retain(|a| a != "href");
    for a in attrs {
        el.remove_attribute(&a);
    }
    el.set_attribute("class", class)?;
    el.set_attribute("href", &format!("#{target}"))?;
    el.set_attribute("id", id)?;
    Ok(())
}

fn int_attr(el: &Element<'_, '_>, name: &str) -> i64 {
    el.get_attribute(name)
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(0)
}

/// Map a link from publication content to a safe target, or `None` to drop it.
pub fn rewrite_href(href: &str) -> Option<String> {
    let href = href.trim();
    if let Some(frag) = href.strip_prefix('#') {
        return frag
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            .then(|| href.to_owned());
    }
    if let Some(rest) = href.strip_prefix("jwpub://b/") {
        // `NWTR/40:1:1-40:1:1`
        let (_version, range) = rest.split_once('/')?;
        return (!range.is_empty()
            && range
                .chars()
                .all(|c| c.is_ascii_digit() || c == ':' || c == '-'))
        .then(|| format!("pergament://bible/{range}"));
    }
    if let Some(rest) = href.strip_prefix("jwpub://p/") {
        // `X:1001070005/` or `X:1001070144/1-1`
        return (!rest.is_empty()
            && rest
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '/' | '-')))
        .then(|| format!("pergament://pub/{rest}"));
    }
    if let Some(rest) = href.strip_prefix("jwpub://c/") {
        // `X:1001070105/1:1-1:31` is a verse range in a Bible book document.
        // With `$p/X:1001070636/47-47:752` alternatives it points at the study
        // note on that verse (the alternatives name the note's paragraphs).
        let (head, alternatives) = match rest.split_once('$') {
            Some((h, _)) => (h, true),
            None => (rest, false),
        };
        let kind = if alternatives { "note" } else { "verse" };
        return (!head.is_empty()
            && head
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '/' | '-')))
        .then(|| format!("pergament://{kind}/{head}"));
    }
    if href.starts_with("https://") || href.starts_with("http://") {
        return Some(href.to_owned());
    }
    None
}

/// File name from `jwpub-media://NAME`, restricted to a safe plain name.
pub fn media_name(src: &str) -> Option<&str> {
    let name = src.trim().strip_prefix("jwpub-media://")?;
    (!name.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')))
    .then_some(name)
}

/// "Jos 24:3", "Apg 7:3, 4" (two verses), "Ps 23:1-6", "1Mo 1:1–2:3",
/// "Rut 4:22–1Sa 1:1".
pub fn reference_label(name: &str, end_name: &str, a: VerseRef, b: VerseRef) -> String {
    if a == b {
        format!("{name} {}:{}", a.chapter, a.verse)
    } else if a.book == b.book && a.chapter == b.chapter && b.verse == a.verse + 1 {
        format!("{name} {}:{}, {}", a.chapter, a.verse, b.verse)
    } else if a.book == b.book && a.chapter == b.chapter {
        format!("{name} {}:{}-{}", a.chapter, a.verse, b.verse)
    } else if a.book == b.book {
        format!("{name} {}:{}–{}:{}", a.chapter, a.verse, b.chapter, b.verse)
    } else {
        format!(
            "{name} {}:{}–{end_name} {}:{}",
            a.chapter, a.verse, b.chapter, b.verse
        )
    }
}

fn bible_url(a: VerseRef, b: VerseRef) -> String {
    format!(
        "pergament://bible/{}:{}:{}-{}:{}:{}",
        a.book, a.chapter, a.verse, b.book, b.chapter, b.verse
    )
}

/// `file://` URL (with trailing slash) for a directory, percent-encoded.
pub fn file_url_for_dir(dir: &Path) -> String {
    let mut out = String::from("file://");
    for b in dir.to_string_lossy().bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    if !out.ends_with('/') {
        out.push('/');
    }
    out
}

/// The study entry of a verse, created on first use.
fn verse_entry<'m>(
    verses: &'m mut std::collections::BTreeMap<i64, VerseStudy>,
    publication: &Publication,
    verse_id: i64,
) -> Result<&'m mut VerseStudy> {
    use std::collections::btree_map::Entry;
    Ok(match verses.entry(verse_id) {
        Entry::Occupied(e) => e.into_mut(),
        Entry::Vacant(e) => {
            let r = publication.verse_ref(verse_id)?;
            e.insert(VerseStudy {
                chapter: r.chapter,
                verse: r.verse,
                footnotes: Vec::new(),
                xrefs: Vec::new(),
                notes: Vec::new(),
            })
        }
    })
}

fn section(class: &str, heading: &str, inner: &str) -> String {
    if inner.is_empty() {
        String::new()
    } else {
        format!("<section class=\"{class}\"><h2>{heading}</h2>{inner}</section>")
    }
}

pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// What an inline style may set: text, color, spacing, borders and size. Nothing
/// that could move it out of the page, such as `position` or `z-index`.
const STYLE_PROPERTIES: &[&str] = &[
    "background-color",
    "background-image",
    "background-position",
    "background-repeat",
    "background-size",
    "border",
    "border-bottom",
    "border-color",
    "border-left",
    "border-radius",
    "border-right",
    "border-style",
    "border-top",
    "border-width",
    "clear",
    "color",
    "display",
    "float",
    "font-family",
    "font-size",
    "font-style",
    "font-variant",
    "font-weight",
    "height",
    "letter-spacing",
    "line-height",
    "list-style-type",
    "margin",
    "margin-bottom",
    "margin-left",
    "margin-right",
    "margin-top",
    "max-width",
    "padding",
    "padding-bottom",
    "padding-left",
    "padding-right",
    "padding-top",
    "text-align",
    "text-decoration",
    "text-indent",
    "text-transform",
    "vertical-align",
    "white-space",
    "width",
];

fn sanitizer() -> ammonia::Builder<'static> {
    let mut b = ammonia::Builder::default();
    b.add_tags([
        "article",
        "aside",
        "figcaption",
        "figure",
        "footer",
        "header",
        "main",
        "nav",
        "section",
    ])
    .add_tags(["fieldset", "label", "legend"])
    .add_tag_attributes("label", ["for"])
    .add_generic_attributes(["id", "class", "style"])
    .filter_style_properties(STYLE_PROPERTIES.iter().copied().collect())
    // `jwmedia` is the app's image scheme (MEDIA_SCHEME in src-tauri).
    .add_url_schemes(["pergament", "file", "jwmedia"]);
    b
}

const CSS: &str = r#"
:root { color-scheme: light dark; --fg: #1d1d1f; --bg: #fdfdfb; --muted: #6b6b6b; --accent: #2b5d8c; --rule: #ddd; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6e6e6; --bg: #1c1c1e; --muted: #9a9a9a; --accent: #8ab4e0; --rule: #3a3a3c; }
}
body { margin: 0; background: var(--bg); color: var(--fg); font: 1.1rem/1.6 "Noto Serif", Georgia, serif; }
main { max-width: 42rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
h1, h2, h3 { font-family: "Noto Sans", system-ui, sans-serif; line-height: 1.25; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; height: auto; }
figure { margin: 1.5rem 0; }
.imgCredit { font-size: .8rem; color: var(--muted); }
.cl { float: left; font-size: 2.6em; line-height: 1; margin-right: .3rem; font-family: "Noto Sans", sans-serif; }
.vl { font-size: .7em; vertical-align: super; color: var(--muted); margin-right: .15rem; }
a.fn, a.xr { font-size: .7em; vertical-align: super; font-family: sans-serif; }
a.xr { color: var(--muted); }
section { border-top: 1px solid var(--rule); margin-top: 2rem; font-size: .95rem; }
section h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.footnote p, .study-note p { margin: .3rem 0; }
.fn-back, .xr-back { font-weight: bold; margin-right: .3rem; float: left; }
.study-note { margin-bottom: 1rem; }
aside, .boxContent { border-left: 3px solid var(--rule); padding-left: 1rem; }
"#;

fn page(title: &str, body: &str) -> String {
    format!(
        "<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src file: data:; style-src 'unsafe-inline'\">\
<title>{}</title><style>{CSS}</style></head>\n<body><main>\n{body}\n</main></body></html>\n",
        escape(title)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hrefs() {
        assert_eq!(
            rewrite_href("jwpub://b/NWTR/40:1:1-40:1:2").as_deref(),
            Some("pergament://bible/40:1:1-40:1:2")
        );
        assert_eq!(
            rewrite_href("jwpub://p/X:1001070144/1-1").as_deref(),
            Some("pergament://pub/X:1001070144/1-1")
        );
        assert_eq!(
            rewrite_href("jwpub://c/X:1001070145/8:38$p/X:1001070636/47-47:752").as_deref(),
            Some("pergament://note/X:1001070145/8:38")
        );
        assert_eq!(
            rewrite_href("jwpub://c/X:1001070105/1:1-1:31").as_deref(),
            Some("pergament://verse/X:1001070105/1:1-1:31")
        );
        assert_eq!(
            rewrite_href("#footnotesource1").as_deref(),
            Some("#footnotesource1")
        );
        assert!(rewrite_href("https://www.jw.org/finder?x=1").is_some());
        for bad in [
            "javascript:alert(1)",
            "jwpub://b/NWTR/1:1\"><script>",
            "file:///etc/passwd",
            "#a\"b",
            "data:text/html,x",
            "jwpub://p/../../x?y",
            "jwpub://c/X:1/8:38\"x",
        ] {
            assert_eq!(rewrite_href(bad), None, "{bad}");
        }
    }

    #[test]
    fn reference_labels() {
        let v = |book, chapter, verse| VerseRef {
            book,
            chapter,
            verse,
        };
        assert_eq!(
            reference_label("Jos", "Jos", v(6, 24, 3), v(6, 24, 3)),
            "Jos 24:3"
        );
        assert_eq!(
            reference_label("Apg", "Apg", v(44, 7, 3), v(44, 7, 4)),
            "Apg 7:3, 4"
        );
        assert_eq!(
            reference_label("Ps", "Ps", v(19, 23, 1), v(19, 23, 6)),
            "Ps 23:1-6"
        );
        assert_eq!(
            reference_label("1Mo", "1Mo", v(1, 1, 1), v(1, 2, 3)),
            "1Mo 1:1–2:3"
        );
    }

    #[test]
    fn media_names() {
        assert_eq!(media_name("jwpub-media://a_b-1.jpg"), Some("a_b-1.jpg"));
        for bad in [
            "jwpub-media://../x.jpg",
            "jwpub-media://a/b.jpg",
            "jwpub-media://.hidden",
            "http://x/a.jpg",
            "jwpub-media://",
        ] {
            assert_eq!(media_name(bad), None, "{bad}");
        }
    }

    #[test]
    fn file_urls() {
        assert_eq!(
            file_url_for_dir(Path::new("/a b/ü")),
            "file:///a%20b/%C3%BC/"
        );
    }

    #[test]
    fn styles_keep_the_publications_pictures_only() {
        let base = Some("jwmedia://localhost/d/");
        assert_eq!(
            rewrite_style("background-image: url('jwpub-media://a_b.jpg')", base),
            r#"background-image: url("jwmedia://localhost/d/a_b.jpg")"#
        );
        assert_eq!(
            rewrite_style(
                "color: red; background: url(https://x.org/t.png); margin: 0",
                base
            ),
            "color: red; margin: 0"
        );
        assert_eq!(
            rewrite_style("background-image: url(jwpub-media://../x.jpg)", base),
            ""
        );
        assert_eq!(
            rewrite_style("background-image: url(jwpub-media://a.jpg)", None),
            ""
        );
    }

    #[test]
    fn stylesheets_reach_only_their_page() {
        let (scope, css) = scope_stylesheet(
            ".note { color: teal; background: url('jwpub-media://a.jpg') }",
            Some("jwmedia://localhost/d/"),
        )
        .unwrap();
        assert!(scope.starts_with("pub-sheet-"));
        assert!(css.starts_with(&format!("@scope (.{scope}) {{")), "{css}");
        assert!(
            css.contains(r#"background: url("jwmedia://localhost/d/a.jpg")"#),
            "{css}"
        );
        assert!(css.trim_end().ends_with('}'));
    }

    #[test]
    fn stylesheets_lose_what_could_load_or_escape() {
        let css = scope_stylesheet(
            r#"@import url("https://x.org/a.css"); @charset "utf-8"; /* } */ @font-face { font-family: F; src: url(https://x.org/f.woff) } p { background: url(https://x.org/t.png); content: "</style><b>" } a:after { content: "}" }"#,
            None,
        )
        .unwrap()
        .1;
        for bad in ["@import", "@charset", "@font-face", "x.org", "</style"] {
            assert!(!css.contains(bad), "{bad} in {css}");
        }
        assert!(css.contains("background: none"), "{css}");
        // A brace in a string or a comment is not a brace of the stylesheet.
        assert!(css.contains(r#"content: "}""#), "{css}");
        assert!(
            scope_stylesheet("p { color: red } </style><script>x</script>", None)
                .unwrap()
                .1
                .contains("\\3c /style")
        );
    }

    #[test]
    fn stylesheets_that_could_close_the_scope_are_refused() {
        for css in [
            "p { color: red } } body { display: none }",
            "p { color: red",
            "} p {",
            "",
            "/* only */",
        ] {
            assert_eq!(scope_stylesheet(css, None), None, "{css}");
        }
    }

    #[test]
    fn sanitizer_keeps_safe_styles_and_form_labels() {
        let out = sanitizer()
            .clean(r#"<fieldset><legend>Goal</legend><label for="tt1" class="dc-screenReaderText">x</label><p style="color: red; position: fixed; z-index: 9; margin-top: 1em">a</p></fieldset>"#)
            .to_string();
        assert!(out.contains("<fieldset><legend>Goal</legend>"), "{out}");
        assert!(
            out.contains(r#"<label for="tt1" class="dc-screenReaderText">x</label>"#),
            "{out}"
        );
        assert!(out.contains("color:red"), "{out}");
        assert!(out.contains("margin-top:1em"), "{out}");
        assert!(
            !out.contains("position") && !out.contains("z-index"),
            "{out}"
        );
    }

    #[test]
    fn sanitizer_strips_active_content() {
        let s = sanitizer();
        let out = s
            .clean(r#"<p onclick="x()">a<script>alert(1)</script><a href="javascript:x">l</a><img src="file:///a.jpg" onerror="x"><img src="jwmedia://localhost/d/b.jpg"><iframe src="https://x"></iframe><style>p{}</style></p>"#)
            .to_string();
        for bad in [
            "onclick",
            "<script",
            "javascript:",
            "onerror",
            "<iframe",
            "<style",
        ] {
            assert!(!out.contains(bad), "{bad} in {out}");
        }
        assert!(out.contains(r#"src="file:///a.jpg""#));
        assert!(out.contains(r#"src="jwmedia://localhost/d/b.jpg""#));
    }
}
