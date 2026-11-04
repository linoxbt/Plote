//! EXIF capture time and GPS (kamadak-exif, pure Rust).

use exif::{In, Reader, Tag, Value};

/// Default time-zone offset when the photo has no `OffsetTimeOriginal`:
/// +01:00 (West Africa Time).
pub const DEFAULT_OFFSET_MIN: i32 = 60;

#[derive(Debug, Default, Clone, PartialEq)]
pub struct ExifInfo {
    /// `DateTimeOriginal` (+ `SubSecTimeOriginal`, `OffsetTimeOriginal`) as
    /// Unix nanoseconds.
    pub time_ns: Option<u64>,
    /// GPS as (lat_e6, lon_e6).
    pub gps: Option<(i64, i64)>,
    /// EXIF orientation tag (1–8), if any.
    pub orientation: Option<u8>,
}

/// Read EXIF from a JPEG/PNG/TIFF/HEIF/WebP container. Missing or broken EXIF
/// yields an empty `ExifInfo`, never an error.
pub fn read(bytes: &[u8]) -> ExifInfo {
    let mut cur = std::io::Cursor::new(bytes);
    let Ok(ex) = Reader::new().read_from_container(&mut cur) else {
        return ExifInfo::default();
    };
    let ascii = |tag: Tag| -> Option<Vec<u8>> {
        let f = ex.get_field(tag, In::PRIMARY)?;
        match &f.value {
            Value::Ascii(v) => v.first().cloned(),
            _ => None,
        }
    };
    let time_ns = ascii(Tag::DateTimeOriginal).and_then(|dt| {
        parse_time_ns(
            &dt,
            ascii(Tag::OffsetTimeOriginal).as_deref(),
            ascii(Tag::SubSecTimeOriginal).as_deref(),
        )
    });
    let gps = read_gps(&ex);
    let orientation = ex
        .get_field(Tag::Orientation, In::PRIMARY)
        .and_then(|f| f.value.get_uint(0))
        .and_then(|v| u8::try_from(v).ok())
        .filter(|v| (1..=8).contains(v));
    ExifInfo {
        time_ns,
        gps,
        orientation,
    }
}

/// Parse EXIF "YYYY:MM:DD HH:MM:SS" with optional "+HH:MM" offset and
/// sub-second digits into Unix nanoseconds.
pub fn parse_time_ns(dt: &[u8], offset: Option<&[u8]>, subsec: Option<&[u8]>) -> Option<u64> {
    let mut d = exif::DateTime::from_ascii(dt).ok()?;
    if let Some(o) = offset {
        // A malformed offset falls back to the default rather than discarding
        // the time.
        if d.parse_offset(o).is_err() {
            d.offset = None;
        }
    }
    if let Some(s) = subsec {
        if d.parse_subsec(s).is_err() {
            d.nanosecond = None;
        }
    }
    let (y, mo, da) = (i64::from(d.year), u32::from(d.month), u32::from(d.day));
    if !(1970..=2200).contains(&y)
        || !(1..=12).contains(&mo)
        || !(1..=days_in_month(y, mo)).contains(&da)
        || d.hour > 23
        || d.minute > 59
        || d.second > 60
    {
        return None;
    }
    let offset_min = d.offset.map_or(DEFAULT_OFFSET_MIN, i32::from);
    if offset_min.abs() > 14 * 60 {
        return None;
    }
    let local_s = days_from_civil(y, mo, da) * 86_400
        + i64::from(d.hour) * 3600
        + i64::from(d.minute) * 60
        + i64::from(d.second);
    let utc_s = local_s - i64::from(offset_min) * 60;
    if utc_s < 0 {
        return None;
    }
    let ns = (utc_s as u64).checked_mul(1_000_000_000)?;
    ns.checked_add(u64::from(d.nanosecond.unwrap_or(0)))
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(y) => 29,
        _ => 28,
    }
}

/// Days since 1970-01-01 (H. Hinnant's algorithm).
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = i64::from(m);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn dms_to_deg(v: &Value) -> Option<f64> {
    let Value::Rational(r) = v else { return None };
    if r.is_empty() || r.iter().any(|x| x.denom == 0) {
        return None;
    }
    let part = |i: usize| r.get(i).map_or(0.0, |x| x.to_f64());
    let deg = part(0) + part(1) / 60.0 + part(2) / 3600.0;
    deg.is_finite().then_some(deg)
}

fn read_gps(ex: &exif::Exif) -> Option<(i64, i64)> {
    let get = |t: Tag| ex.get_field(t, In::PRIMARY);
    let lat = dms_to_deg(&get(Tag::GPSLatitude)?.value)?;
    let lon = dms_to_deg(&get(Tag::GPSLongitude)?.value)?;
    let sign = |t: Tag, neg: u8| -> f64 {
        match get(t).map(|f| &f.value) {
            Some(Value::Ascii(v)) if v.first().and_then(|s| s.first()) == Some(&neg) => -1.0,
            _ => 1.0,
        }
    };
    let lat = lat * sign(Tag::GPSLatitudeRef, b'S');
    let lon = lon * sign(Tag::GPSLongitudeRef, b'W');
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return None;
    }
    // 0,0 is what some cameras write when they have no fix.
    if lat == 0.0 && lon == 0.0 {
        return None;
    }
    Some(((lat * 1e6).round() as i64, (lon * 1e6).round() as i64))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synth;

    #[test]
    fn civil_days() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(days_from_civil(2026, 11, 4), 20_761);
    }

    #[test]
    fn time_default_offset_is_plus_one() {
        // 2026-11-04 12:00:00 local, +01:00 => 11:00:00Z
        let t = parse_time_ns(b"2026:11:04 12:00:00", None, None).unwrap();
        let expect = (20_761 * 86_400 + 11 * 3600) as u64 * 1_000_000_000;
        assert_eq!(t, expect);
    }

    #[test]
    fn time_explicit_offset_and_subsec() {
        let t = parse_time_ns(b"2026:11:04 12:00:00", Some(b"-05:30"), Some(b"25")).unwrap();
        let expect = (20_761 * 86_400 + 17 * 3600 + 30 * 60) as u64 * 1_000_000_000 + 250_000_000;
        assert_eq!(t, expect);
        // malformed offset -> default +01:00
        let t2 = parse_time_ns(b"2026:11:04 12:00:00", Some(b"junk!!"), None).unwrap();
        assert_eq!(
            t2,
            parse_time_ns(b"2026:11:04 12:00:00", None, None).unwrap()
        );
    }

    #[test]
    fn time_rejects_blank_and_invalid() {
        assert_eq!(parse_time_ns(b"    :  :     :  :  ", None, None), None);
        assert_eq!(parse_time_ns(b"2026:13:04 12:00:00", None, None), None);
        assert_eq!(parse_time_ns(b"2026:02:30 12:00:00", None, None), None);
        assert_eq!(parse_time_ns(b"garbage", None, None), None);
    }

    #[test]
    fn reads_time_and_gps_from_synthetic_jpeg() {
        let jpeg = synth::jpeg(64, 48, 1, 90);
        let with = synth::with_exif(
            &jpeg,
            &synth::ExifSpec {
                datetime: Some("2026:11:04 09:30:00".into()),
                offset: Some("+01:00".into()),
                gps: Some((6.447118, -3.474201)),
                orientation: Some(1),
            },
        );
        let info = read(&with);
        assert_eq!(
            info.time_ns,
            parse_time_ns(b"2026:11:04 09:30:00", None, None)
        );
        let (lat, lon) = info.gps.unwrap();
        assert!((lat - 6_447_118).abs() <= 1, "{lat}");
        assert!((lon + 3_474_201).abs() <= 1, "{lon}");
        assert_eq!(info.orientation, Some(1));
        // Still decodes as an image.
        assert!(image::load_from_memory(&with).is_ok());
    }

    #[test]
    fn no_exif_is_empty() {
        assert_eq!(read(&synth::jpeg(16, 16, 2, 90)), ExifInfo::default());
        assert_eq!(read(b"not an image"), ExifInfo::default());
    }

    #[test]
    fn southern_and_zero_gps() {
        let jpeg = synth::jpeg(16, 16, 3, 90);
        let s = synth::with_exif(
            &jpeg,
            &synth::ExifSpec {
                gps: Some((-33.8688, 151.2093)),
                ..Default::default()
            },
        );
        let (lat, lon) = read(&s).gps.unwrap();
        assert!((lat + 33_868_800).abs() <= 1 && (lon - 151_209_300).abs() <= 1);
        let z = synth::with_exif(
            &jpeg,
            &synth::ExifSpec {
                gps: Some((0.0, 0.0)),
                ..Default::default()
            },
        );
        assert_eq!(read(&z).gps, None);
    }
}
