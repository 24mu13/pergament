mod common;

use common::{ExtractFixture, Fixture};
use pergament::{Library, Publication, RenderOptions, Renderer};

/// Imports a fixture with the given extracts and returns the publication
/// plus the tempdir keeping the library alive.
fn publication_with(
    extracts: Vec<ExtractFixture>,
    with_tables: bool,
) -> (Publication, tempfile::TempDir) {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("in.jwpub");
    Fixture {
        extracts,
        with_extract_tables: with_tables,
        ..Fixture::default()
    }
    .write_to(&file);
    let mut lib = Library::open(tmp.path().join("lib")).unwrap();
    let entry = lib.import(&file).unwrap();
    let publication = Publication::open(&lib, &entry).unwrap();
    (publication, tmp)
}

fn extract(id: i64, link: &str, html: &str) -> ExtractFixture {
    ExtractFixture {
        extract_id: id,
        document_id: 1,
        link: link.into(),
        caption: String::new(),
        html: html.into(),
        ref_publication: None,
    }
}

fn caption(location: &str, title: &str) -> String {
    format!(r#"<span class="eloc">{location}</span> <span class="etitle">{title}</span>"#)
}

#[test]
fn exact_link_finds_the_excerpt() {
    let (p, _tmp) = publication_with(
        vec![ExtractFixture {
            extract_id: 1,
            document_id: 1,
            link: "p/X:502016128/3-5".into(),
            caption: caption("w16 15/3 S. 12-13", "Ein Land, das Gute lernt"),
            html: r#"<p id="p3">Der Text des Auszugs</p>"#.into(),
            ref_publication: Some((
                7,
                "Der Wachtturm (Studienausgabe)".into(),
                "Der Wachtturm".into(),
            )),
        }],
        true,
    );
    let x = p.citation_extract("p/X:502016128/3-5").unwrap().unwrap();
    assert_eq!(x.publication, "Der Wachtturm");
    assert_eq!(x.subject, "Ein Land, das Gute lernt");
    assert_eq!(x.location, "w16 15/3 S. 12-13");
    assert_eq!(x.html, r#"<p id="p3">Der Text des Auszugs</p>"#);
}

#[test]
fn trailing_slashes_match_either_way() {
    let (p, _tmp) = publication_with(vec![extract(1, "p/X:1/", "<p>ein</p>")], true);
    assert!(p.citation_extract("p/X:1").unwrap().is_some());
    let (p, _tmp) = publication_with(vec![extract(1, "p/X:1", "<p>ein</p>")], true);
    assert!(p.citation_extract("p/X:1/").unwrap().is_some());
}

#[test]
fn head_match_when_the_range_differs() {
    let (p, _tmp) = publication_with(vec![extract(1, "p/X:1", "<p>ein</p>")], true);
    let x = p.citation_extract("p/X:1/4-6").unwrap().unwrap();
    assert_eq!(x.html, "<p>ein</p>");
}

#[test]
fn ambiguous_head_returns_none() {
    let (p, _tmp) = publication_with(
        vec![
            extract(1, "p/X:1/2-3", "<p>a</p>"),
            extract(2, "p/X:1/5-6", "<p>b</p>"),
        ],
        true,
    );
    // Both extracts share the head `p/X:1`, so the range cannot decide.
    assert!(p.citation_extract("p/X:1/4-6").unwrap().is_none());
    // A range-less query must not fall back to the head `p` — it would match everything.
    assert!(p.citation_extract("p/X:1").unwrap().is_none());
}

#[test]
fn same_excerpt_cited_twice_is_not_ambiguous() {
    let (p, _tmp) = publication_with(
        vec![
            ExtractFixture {
                document_id: 1,
                ..extract(1, "p/X:1/2-3", "<p>a</p>")
            },
            ExtractFixture {
                document_id: 2,
                ..extract(1, "p/X:1/2-3", "<p>a</p>")
            },
        ],
        true,
    );
    let x = p.citation_extract("p/X:1/2-3").unwrap().unwrap();
    assert_eq!(x.html, "<p>a</p>");
}

#[test]
fn without_extract_tables_returns_none() {
    let (p, _tmp) = publication_with(vec![extract(1, "p/X:1", "<p>a</p>")], false);
    assert!(p.citation_extract("p/X:1").unwrap().is_none());
}

#[test]
fn no_match_returns_none() {
    let (p, _tmp) = publication_with(vec![extract(1, "p/X:1/1", "<p>a</p>")], true);
    assert!(p.citation_extract("p/X:999/1").unwrap().is_none());
}

#[test]
fn caption_without_etitle_leaves_subject_empty() {
    let (p, _tmp) = publication_with(
        vec![ExtractFixture {
            caption: r#"<span class="eloc">w16 15/3 S. 12</span>"#.into(),
            ..extract(1, "p/X:1", "<p>a</p>")
        }],
        true,
    );
    let x = p.citation_extract("p/X:1").unwrap().unwrap();
    assert_eq!(x.subject, "");
    assert_eq!(x.location, "w16 15/3 S. 12");
}

#[test]
fn excerpt_is_sanitized_when_rendered() {
    let (p, _tmp) = publication_with(
        vec![extract(
            1,
            "p/X:1",
            r#"<script>alert(1)</script><p id="p1">ok</p>"#,
        )],
        true,
    );
    let x = p.citation_extract("p/X:1").unwrap().unwrap();
    let out = Renderer::new(&p, RenderOptions::default())
        .fragment(&x.html)
        .unwrap();
    assert!(out.contains("ok"), "{out}");
    assert!(!out.contains("<script"), "{out}");
}
