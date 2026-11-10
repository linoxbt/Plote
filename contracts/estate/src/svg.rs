//! The allocation NFT's image, drawn from the unit's state at view time (SPEC 5.11).
//! An isometric house whose parts fill in teal as milestones are approved; windows turn gold at handover.

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

const ORANGE: &str = "#FF9211";
const DIM: &str = "#4A2A0C";
const LINE: &str = "#3A414B";
const GOLD: &str = "#FFD27A";

fn part(filled: bool) -> String {
    if filled {
        format!("fill='{DIM}' stroke='{ORANGE}'")
    } else {
        format!("fill='none' stroke='{LINE}' stroke-dasharray='4 3'")
    }
}

/// Map progress onto the four parts of the drawing, whatever the milestone count.
fn stage(approved: u32, total: u32) -> u32 {
    if total == 0 {
        return 0;
    }
    (approved * 4).div_ceil(total).min(4)
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
    for k in 0..i.total.min(8) {
        let w = 280 / i.total.clamp(1, 8);
        let fill = if k < i.approved { ORANGE } else { LINE };
        bar.push_str(&format!(
            "<rect x='{}' y='338' width='{}' height='6' fill='{}'/>",
            60 + k * w,
            w - 4,
            fill
        ));
    }
    format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='#090909'/>\
<path d='M12 28V12h16M372 12h16v16M388 372v16h-16M28 388H12v-16' fill='none' stroke='{ORANGE}' stroke-width='1.5'/>\
<text x='28' y='44' fill='#E9ECEF' font-family='sans-serif' font-size='16'>{estate}</text>\
<text x='372' y='44' fill='{ORANGE}' font-family='monospace' font-size='11' text-anchor='end'>{status}</text>\
<g stroke-width='1.5'><path d='M80 250l120 60 120-60-120-60z' {slab}/>\
<path d='M110 245l90 45v-90l-90-45z' {body}/><path d='M200 290l90-45v-90l-90 45z' {body}/>\
<path d='M105 158l95 47v-95z' {roof}/><path d='M200 205l95-47-95-48z' {roof}/>\
<path d='M128 222l22 11v-22l-22-11zM162 239l22 11v-22l-22-11zM220 252l22-11v-22l-22 11zM254 235l22-11v-22l-22 11z' {win}/></g>\
<text x='60' y='326' fill='#E9ECEF' font-family='monospace' font-size='18'>{id}</text>\
<text x='340' y='326' fill='#8B939D' font-family='monospace' font-size='12' text-anchor='end'>{approved}/{total}</text>{bar}\
<text x='60' y='366' fill='#8B939D' font-family='sans-serif' font-size='11'>{label}</text>\
<text x='340' y='366' fill='#E9ECEF' font-family='monospace' font-size='11' text-anchor='end'>{paid} / {price}</text></svg>",
        estate = esc(i.estate),
        status = esc(i.status),
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
                s.matches(&format!("y='338' width='66' height='6' fill='{ORANGE}'"))
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

    #[test]
    fn formats_dollars() {
        assert_eq!(dollars(85_000_000_000), "$85,000");
        assert_eq!(dollars(999_000_000), "$999");
        assert_eq!(dollars(1_234_567_000_000), "$1,234,567");
    }
}
