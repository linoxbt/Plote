//! Synthetic test images (no downloads). Compiled for tests and with the
//! `synth` feature (used by `examples/gen_fixture.rs`).

use exif::experimental::Writer;
use exif::{Field, In, Rational, Tag, Value};
use image::{DynamicImage, ImageEncoder, Rgb, RgbImage};

/// Tiny deterministic PRNG (xorshift64*).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u32) -> u32 {
        (self.next() % u64::from(n.max(1))) as u32
    }
}

/// A structured "scene": seed-dependent gradient plus blocks and discs, so
/// different seeds give very different perceptual hashes and the same seed
/// survives resizing / re-encoding.
pub fn scene(w: u32, h: u32, seed: u64) -> RgbImage {
    let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    // Background: a few random low-frequency waves, so the coarse structure
    // (what pHash looks at) differs strongly between seeds.
    let waves: Vec<(f64, f64, f64, f64)> = (0..3)
        .map(|_| {
            (
                f64::from(1 + rng.below(4)),
                f64::from(1 + rng.below(4)),
                f64::from(rng.below(628)) / 100.0,
                f64::from(40 + rng.below(50)),
            )
        })
        .collect();
    let tint = [rng.below(80), rng.below(80), rng.below(80)];
    let mut img = RgbImage::from_fn(w, h, |x, y| {
        let (u, v) = (
            f64::from(x) / f64::from(w.max(1)),
            f64::from(y) / f64::from(h.max(1)),
        );
        let l: f64 = 128.0
            + waves
                .iter()
                .map(|(fx, fy, ph, a)| a * (std::f64::consts::PI * (fx * u + fy * v) + ph).cos())
                .sum::<f64>();
        let px = |t: u32| (l * 0.8 + f64::from(t)).clamp(0.0, 255.0) as u8;
        Rgb([px(tint[0]), px(tint[1]), px(tint[2])])
    });
    for _ in 0..12 {
        let (cx, cy) = (rng.below(w), rng.below(h));
        let rw = w / 10 + rng.below(w / 4 + 1);
        let rh = h / 10 + rng.below(h / 4 + 1);
        let c = Rgb([
            rng.below(256) as u8,
            rng.below(256) as u8,
            rng.below(256) as u8,
        ]);
        let disc = rng.below(2) == 0;
        for y in cy.saturating_sub(rh / 2)..(cy + rh / 2).min(h) {
            for x in cx.saturating_sub(rw / 2)..(cx + rw / 2).min(w) {
                let inside = if disc {
                    let dx = (f64::from(x) - f64::from(cx)) / (f64::from(rw) / 2.0);
                    let dy = (f64::from(y) - f64::from(cy)) / (f64::from(rh) / 2.0);
                    dx * dx + dy * dy <= 1.0
                } else {
                    true
                };
                if inside {
                    img.put_pixel(x, y, c);
                }
            }
        }
    }
    img
}

pub fn encode_jpeg(img: &DynamicImage, quality: u8) -> Vec<u8> {
    let mut out = Vec::new();
    let rgb = img.to_rgb8();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .expect("jpeg encode");
    out
}

pub fn encode_png(img: &DynamicImage) -> Vec<u8> {
    let mut out = Vec::new();
    let rgb = img.to_rgb8();
    image::codecs::png::PngEncoder::new(&mut out)
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .expect("png encode");
    out
}

pub fn jpeg(w: u32, h: u32, seed: u64, quality: u8) -> Vec<u8> {
    encode_jpeg(&DynamicImage::ImageRgb8(scene(w, h, seed)), quality)
}

pub fn png(w: u32, h: u32, seed: u64) -> Vec<u8> {
    encode_png(&DynamicImage::ImageRgb8(scene(w, h, seed)))
}

/// Decode, resize by `scale`, re-encode as JPEG at `quality` (a "recycled"
/// photo: screenshot, WhatsApp forward, crop-free resize).
pub fn reencode(bytes: &[u8], scale: f32, quality: u8) -> Vec<u8> {
    let img = image::load_from_memory(bytes).expect("decode");
    let (w, h) = (
        ((img.width() as f32) * scale).round().max(1.0) as u32,
        ((img.height() as f32) * scale).round().max(1.0) as u32,
    );
    let img = img.resize_exact(w, h, image::imageops::FilterType::Triangle);
    encode_jpeg(&img, quality)
}

#[derive(Debug, Default, Clone)]
pub struct ExifSpec {
    /// "YYYY:MM:DD HH:MM:SS"
    pub datetime: Option<String>,
    /// "+01:00"
    pub offset: Option<String>,
    /// (lat, lon) in degrees
    pub gps: Option<(f64, f64)>,
    pub orientation: Option<u16>,
}

fn ascii(tag: Tag, s: &str) -> Field {
    Field {
        tag,
        ifd_num: In::PRIMARY,
        value: Value::Ascii(vec![s.as_bytes().to_vec()]),
    }
}

fn dms(deg: f64) -> Value {
    let a = deg.abs();
    let d = a.floor();
    let m = ((a - d) * 60.0).floor();
    let s = (a - d - m / 60.0) * 3600.0;
    Value::Rational(vec![
        Rational {
            num: d as u32,
            denom: 1,
        },
        Rational {
            num: m as u32,
            denom: 1,
        },
        Rational {
            num: (s * 10_000.0).round() as u32,
            denom: 10_000,
        },
    ])
}

/// Build a raw TIFF/EXIF blob.
pub fn exif_blob(spec: &ExifSpec) -> Vec<u8> {
    let mut fields = Vec::new();
    if let Some(dt) = &spec.datetime {
        fields.push(ascii(Tag::DateTimeOriginal, dt));
    }
    if let Some(o) = &spec.offset {
        fields.push(ascii(Tag::OffsetTimeOriginal, o));
    }
    if let Some(o) = spec.orientation {
        fields.push(Field {
            tag: Tag::Orientation,
            ifd_num: In::PRIMARY,
            value: Value::Short(vec![o]),
        });
    }
    if let Some((lat, lon)) = spec.gps {
        fields.push(Field {
            tag: Tag::GPSVersionID,
            ifd_num: In::PRIMARY,
            value: Value::Byte(vec![2, 3, 0, 0]),
        });
        fields.push(ascii(
            Tag::GPSLatitudeRef,
            if lat < 0.0 { "S" } else { "N" },
        ));
        fields.push(Field {
            tag: Tag::GPSLatitude,
            ifd_num: In::PRIMARY,
            value: dms(lat),
        });
        fields.push(ascii(
            Tag::GPSLongitudeRef,
            if lon < 0.0 { "W" } else { "E" },
        ));
        fields.push(Field {
            tag: Tag::GPSLongitude,
            ifd_num: In::PRIMARY,
            value: dms(lon),
        });
    }
    if fields.is_empty() {
        // Writer needs at least one field; an unrelated tag keeps it valid.
        fields.push(ascii(Tag::Software, "plote-synth"));
    }
    let mut w = Writer::new();
    for f in &fields {
        w.push_field(f);
    }
    let mut buf = std::io::Cursor::new(Vec::new());
    w.write(&mut buf, false).expect("exif write");
    buf.into_inner()
}

/// Insert an APP1/Exif segment right after the JPEG SOI marker.
pub fn with_exif(jpeg: &[u8], spec: &ExifSpec) -> Vec<u8> {
    assert!(jpeg.starts_with(&[0xFF, 0xD8]), "not a JPEG");
    let tiff = exif_blob(spec);
    let len = u16::try_from(2 + 6 + tiff.len()).expect("exif too big");
    let mut out = Vec::with_capacity(jpeg.len() + tiff.len() + 10);
    out.extend_from_slice(&jpeg[..2]);
    out.extend_from_slice(&[0xFF, 0xE1]);
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(b"Exif\0\0");
    out.extend_from_slice(&tiff);
    out.extend_from_slice(&jpeg[2..]);
    out
}

/// Format Unix nanoseconds as an EXIF local time string at `offset_min`.
pub fn exif_datetime(ns: u64, offset_min: i32) -> String {
    let s = (ns / 1_000_000_000) as i64 + i64::from(offset_min) * 60;
    let (days, rem) = (s.div_euclid(86_400), s.rem_euclid(86_400));
    // civil_from_days (H. Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}:{m:02}:{d:02} {:02}:{:02}:{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}
