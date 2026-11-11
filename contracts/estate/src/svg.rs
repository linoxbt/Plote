//! The allocation NFT's image, drawn from the unit's state at view time (SPEC 5.11).
//! An isometric house whose parts fill in brand orange as milestones are approved; windows turn gold when all are.

use crate::UnitStatus;
use near_sdk::base64::{engine::general_purpose::STANDARD, Engine};

pub struct SvgInput<'a> {
    pub estate: &'a str,
    pub label: &'a str,
    pub unit_id: &'a str,
    pub approved: u32,
    pub total: u32,
    pub status: &'a str,
    pub paid: u128,
    pub price: u128,
}

pub fn status_text(s: UnitStatus) -> &'static str {
    match s {
        UnitStatus::Available => "AVAILABLE",
        UnitStatus::Reserved => "RESERVED",
        UnitStatus::Allocated => "ALLOCATED",
        UnitStatus::InDefault => "IN DEFAULT",
        UnitStatus::HandedOver => "HANDED OVER",
    }
}

fn esc(s: &str) -> String {
    s.chars()
        .take(40)
        .map(|c| match c {
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '&' => "&amp;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&#39;".to_string(),
            c => c.to_string(),
        })
        .collect()
}

/// USDC base units → "$12,345".
pub fn dollars(base_units: u128) -> String {
    let d = (base_units / 1_000_000).to_string();
    let mut out = String::new();
    for (i, ch) in d.chars().enumerate() {
        if i > 0 && (d.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(ch);
    }
    format!("${}", out)
}

// Brand tokens (web/app/globals.css). web/lib/svg-house.ts is a byte-for-byte port of `unit_svg`, checked against
// fixtures this crate writes (`tests::svg_fixtures_for_web`); change both together.
const BG: &str = "#090909";
const LINE: &str = "#2a2a2e";
const TEXT: &str = "#ffffff";
const MUTED: &str = "#a3a3a8";
const ORANGE: &str = "#FF9211";
const DIM: &str = "#4A2A0C";
const GOLD: &str = "#FFD27A";
const RED: &str = "#f26b5b";
const SANS: &str = "Lexend,sans-serif";

fn part(filled: bool) -> String {
    if filled {
        format!("fill='{DIM}' stroke='{ORANGE}'")
    } else {
        format!("fill='none' stroke='{LINE}' stroke-dasharray='4 3'")
    }
}

/// Map progress onto the four parts of the drawing, whatever the milestone count.
pub fn stage(approved: u32, total: u32) -> u32 {
    if total == 0 {
        return 0;
    }
    (approved.saturating_mul(4)).div_ceil(total).min(4)
}

fn status_color(status: &str) -> &'static str {
    match status {
        "IN DEFAULT" => RED,
        "HANDED OVER" => GOLD,
        "AVAILABLE" => MUTED,
        _ => ORANGE,
    }
}

pub fn unit_svg(i: &SvgInput) -> String {
    let st = stage(i.approved, i.total);
    let slab = part(st >= 1);
    let body = part(st >= 2);
    let roof = part(st >= 2);
    let win = if st >= 4 {
        format!("fill='{GOLD}' stroke='{GOLD}'")
    } else if st >= 3 {
        format!("fill='{ORANGE}' stroke='{ORANGE}'")
    } else {
        format!("fill='none' stroke='{LINE}'")
    };
    let mut bar = String::new();
    let w = 280 / i.total.clamp(1, 8);
    for k in 0..i.total.min(8) {
        let fill = if k < i.approved { ORANGE } else { LINE };
        bar.push_str(&format!(
            "<rect x='{}' y='338' width='{}' height='6' rx='3' fill='{}'/>",
            60 + k * w,
            w - 4,
            fill
        ));
    }
    let status = esc(i.status);
    let sc = status_color(i.status);
    let bw = i.status.chars().take(40).count() as u32 * 7 + 16;
    format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='{BG}'/>\
<rect x='12' y='12' width='376' height='376' rx='16' fill='none' stroke='{LINE}'/>\
<path d='M12 28V12h16M372 12h16v16M388 372v16h-16M28 388H12v-16' fill='none' stroke='{ORANGE}' stroke-width='1.5'/>\
<text x='28' y='46' fill='{TEXT}' font-family='{SANS}' font-size='16'>{estate}</text>\
<rect x='{bx}' y='30' width='{bw}' height='22' rx='11' fill='none' stroke='{sc}'/>\
<text x='{tx}' y='45' fill='{sc}' font-family='monospace' font-size='11' text-anchor='middle'>{status}</text>\
<g stroke-width='1.5'><path d='M80 250l120 60 120-60-120-60z' {slab}/>\
<path d='M110 245l90 45v-90l-90-45z' {body}/><path d='M200 290l90-45v-90l-90 45z' {body}/>\
<path d='M105 158l95 47v-95z' {roof}/><path d='M200 205l95-47-95-48z' {roof}/>\
<path d='M128 222l22 11v-22l-22-11zM162 239l22 11v-22l-22-11zM220 252l22-11v-22l-22 11zM254 235l22-11v-22l-22 11z' {win}/></g>\
<text x='60' y='326' fill='{TEXT}' font-family='monospace' font-size='18'>{id}</text>\
<text x='340' y='326' fill='{MUTED}' font-family='monospace' font-size='12' text-anchor='end'>{approved}/{total}</text>{bar}\
<text x='60' y='366' fill='{MUTED}' font-family='{SANS}' font-size='11'>{label}</text>\
<text x='340' y='366' fill='{TEXT}' font-family='monospace' font-size='11' text-anchor='end'>{paid} / {price}</text></svg>",
        estate = esc(i.estate),
        bx = 372u32.saturating_sub(bw),
        tx = 372u32.saturating_sub(bw / 2),
        id = esc(&i.unit_id.to_uppercase()),
        approved = i.approved,
        total = i.total,
        label = esc(i.label),
        paid = dollars(i.paid),
        price = dollars(i.price),
    )
}

pub fn data_uri(svg: &str) -> String {
    format!(
        "data:image/svg+xml;base64,{}",
        STANDARD.encode(svg.as_bytes())
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(approved: u32) -> SvgInput<'static> {
        SvgInput {
            estate: "Harmattan Court",
            label: "Block A · Unit 4B · 3-bed",
            unit_id: "a-4b",
            approved,
            total: 4,
            status: "ALLOCATED",
            paid: 8_500_000_000,
            price: 85_000_000_000,
        }
    }

    #[test]
    fn small_and_counts_segments() {
        for a in 0..=4 {
            let s = unit_svg(&input(a));
            assert!(s.len() < 2600, "svg is {} bytes", s.len());
            assert_eq!(
                s.matches(&format!(
                    "y='338' width='66' height='6' rx='3' fill='{ORANGE}'"
                ))
                .count(),
                a as usize
            );
        }
    }

    #[test]
    fn gold_windows_at_handover() {
        assert!(unit_svg(&input(4)).contains(GOLD));
        assert!(!unit_svg(&input(3)).contains(GOLD));
    }

    #[test]
    fn escapes_labels() {
        let mut i = input(1);
        i.label = "<script>";
        assert!(!unit_svg(&i).contains("<script>"));
    }

    /// Writes (or, when it exists, checks) web/tests/unit/fixtures/svg-house.json: `unit_svg` outputs for the inputs
    /// web/lib/svg-house.ts must reproduce byte for byte. Regenerate after a drawing change with
    /// `PLOTE_WRITE_FIXTURES=1 cargo test -p plote-estate svg_fixtures_for_web`.
    #[test]
    fn svg_fixtures_for_web() {
        use near_sdk::serde_json::{json, to_string_pretty, Value};
        let statuses = [
            UnitStatus::Available,
            UnitStatus::Reserved,
            UnitStatus::Allocated,
            UnitStatus::InDefault,
            UnitStatus::HandedOver,
        ];
        type Case<'a> = (&'a str, &'a str, &'a str, u32, u32, UnitStatus, u128, u128);
        let mut cases: Vec<Case> = vec![];
        for a in 0..=4 {
            cases.push((
                "Harmattan Court",
                "Block A · Unit 4B · 3-bed",
                "a-4b",
                a,
                4,
                UnitStatus::Allocated,
                8_500_000_000,
                85_000_000_000,
            ));
        }
        for st in statuses {
            cases.push((
                "Baobab Heights",
                "Unit P-01",
                "p-01",
                2,
                4,
                st,
                1_234_567_890,
                95_000_000_000,
            ));
        }
        cases.extend([
            (
                "Playground",
                "Sandbox unit",
                "s-1",
                3,
                6,
                UnitStatus::Allocated,
                999_999,
                1_000_000,
            ),
            (
                "Playground",
                "One stage",
                "x-9",
                1,
                1,
                UnitStatus::HandedOver,
                0,
                0,
            ),
            (
                "Eight",
                "Eight stages",
                "e-8",
                5,
                8,
                UnitStatus::Allocated,
                1_234_567_000_000,
                2_000_000_000_000,
            ),
            (
                "Over",
                "More approved than total",
                "o-1",
                5,
                4,
                UnitStatus::Allocated,
                1,
                2,
            ),
            (
                "<script>&\"'",
                "<img src=x onerror='a'>",
                "z-0",
                0,
                4,
                UnitStatus::Reserved,
                0,
                1,
            ),
            (
                "A very long estate name that goes past forty characters for sure",
                "Ünïcødé · 公寓 · 🏠 label that is also rather long here",
                "abcdefghijklmnop",
                2,
                3,
                UnitStatus::InDefault,
                340_282_366_920_938_463_463_374_607_431_768_211_455,
                u128::MAX,
            ),
            (
                "Nine milestones",
                "Clamp",
                "n-9",
                9,
                9,
                UnitStatus::Allocated,
                5_000_000,
                10_000_000,
            ),
        ]);
        let fixtures: Vec<Value> = cases
            .iter()
            .map(|(estate, label, id, approved, total, st, paid, price)| {
                let svg = unit_svg(&SvgInput {
                    estate,
                    label,
                    unit_id: id,
                    approved: *approved,
                    total: *total,
                    status: status_text(*st),
                    paid: *paid,
                    price: *price,
                });
                assert!(svg.len() < 2600, "svg is {} bytes", svg.len());
                json!({
                    "input": {
                        "estateName": estate, "unitLabel": label, "unitId": id, "approvedCount": approved,
                        "total": total, "status": st, "paid": paid.to_string(), "price": price.to_string()
                    },
                    "svg": svg,
                    "dataUri": data_uri(&svg),
                })
            })
            .collect();
        let text = to_string_pretty(&fixtures).unwrap() + "\n";
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../web/tests/unit/fixtures/svg-house.json"
        );
        match std::fs::read_to_string(path) {
            Ok(existing) if std::env::var("PLOTE_WRITE_FIXTURES").is_err() => assert_eq!(
                existing, text,
                "web/tests/unit/fixtures/svg-house.json is stale; rerun with PLOTE_WRITE_FIXTURES=1"
            ),
            _ => {
                std::fs::create_dir_all(std::path::Path::new(path).parent().unwrap()).unwrap();
                std::fs::write(path, &text).unwrap();
            }
        }
    }

    #[test]
    fn formats_dollars() {
        assert_eq!(dollars(85_000_000_000), "$85,000");
        assert_eq!(dollars(999_000_000), "$999");
        assert_eq!(dollars(1_234_567_000_000), "$1,234,567");
    }
}
