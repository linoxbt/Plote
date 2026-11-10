//! Decoding and downscaling.

use image::metadata::Orientation;
use image::{DynamicImage, ImageEncoder};

pub struct Decoded {
    /// Original dimensions (before orientation / downscale).
    pub width: u32,
    pub height: u32,
    /// Orientation-corrected, downscaled to ≤ `WORK_MAX` on the long side.
    pub work: DynamicImage,
}

/// Long side of the working copy (also what the AI sees).
pub const WORK_MAX: u32 = 1024;

/// Largest width or height we decode. Phone cameras top out well below this
/// (a 50 MP sensor is ~8160×6120, usually saved binned to 12 MP).
pub const MAX_DIMENSION: u32 = 8000;
/// Most the decoder may allocate. The worker runs with 256 MB of memory
/// (SPEC 5.6), so a header claiming e.g. 10000×10000 must be refused before the
/// decoder tries to allocate it (the image crate's default is 512 MiB). A 48 MP
/// RGB frame (144 MB) is refused too; 12–24 MP photos (36–72 MB) fit.
pub const MAX_DECODE_ALLOC: u64 = 128 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeError {
    /// Dimensions or decoded size exceed `MAX_DIMENSION` / `MAX_DECODE_ALLOC`.
    TooLarge(String),
    /// Not a decodable JPEG/PNG.
    Invalid(String),
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DecodeError::TooLarge(e) => write!(f, "too large: {e}"),
            DecodeError::Invalid(e) => write!(f, "{e}"),
        }
    }
}

fn limits() -> image::Limits {
    let mut l = image::Limits::default();
    l.max_image_width = Some(MAX_DIMENSION);
    l.max_image_height = Some(MAX_DIMENSION);
    l.max_alloc = Some(MAX_DECODE_ALLOC);
    l
}

fn classify(e: image::ImageError) -> DecodeError {
    match e {
        image::ImageError::Limits(_) => DecodeError::TooLarge(e.to_string()),
        e => DecodeError::Invalid(e.to_string()),
    }
}

/// Decode JPEG/PNG bytes (within `MAX_DIMENSION` and `MAX_DECODE_ALLOC`), apply
/// EXIF orientation and downscale once so that later steps never touch the
/// full-size frame.
pub fn decode(bytes: &[u8], orientation: Option<u8>) -> Result<Decoded, DecodeError> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| DecodeError::Invalid(e.to_string()))?;
    reader.limits(limits());
    let img = reader.decode().map_err(classify)?;
    let (width, height) = (img.width(), img.height());
    let mut work = downscale(img, WORK_MAX);
    if let Some(o) = orientation.and_then(Orientation::from_exif) {
        work.apply_orientation(o);
    }
    Ok(Decoded {
        width,
        height,
        work,
    })
}

/// Shrink to fit in `max`×`max` (never enlarges).
pub fn downscale(img: DynamicImage, max: u32) -> DynamicImage {
    if img.width().max(img.height()) <= max {
        img
    } else {
        img.thumbnail(max, max)
    }
}

/// JPEG-encode (quality 85) for the AI data URL.
pub fn to_jpeg(img: &DynamicImage) -> Result<Vec<u8>, String> {
    let rgb = img.to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85)
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| e.to_string())?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synth;

    #[test]
    fn decodes_jpeg_and_png_and_downscales() {
        let d = decode(&synth::jpeg(2000, 1500, 1, 80), None).unwrap();
        assert_eq!((d.width, d.height), (2000, 1500));
        assert_eq!(d.work.width().max(d.work.height()), WORK_MAX);
        let p = decode(&synth::png(300, 200, 1), None).unwrap();
        assert_eq!((p.work.width(), p.work.height()), (300, 200));
        assert!(decode(b"\xFF\xD8garbage", None).is_err());
    }

    #[test]
    fn oversized_images_are_refused_before_decoding() {
        // Wider than MAX_DIMENSION.
        let wide = synth::png(MAX_DIMENSION + 1, 16, 1);
        assert!(matches!(decode(&wide, None), Err(DecodeError::TooLarge(_))));
        let tall = synth::jpeg(16, MAX_DIMENSION + 1, 1, 50);
        assert!(matches!(decode(&tall, None), Err(DecodeError::TooLarge(_))));
        // Within the dimension cap but over the allocation cap: 7000×7000 RGB = 147 MB.
        let header_only = png_header(7000, 7000);
        assert!(matches!(
            decode(&header_only, None),
            Err(DecodeError::TooLarge(_))
        ));
        // A claimed 60000×60000 PNG is refused from the header alone.
        assert!(matches!(
            decode(&png_header(60_000, 60_000), None),
            Err(DecodeError::TooLarge(_))
        ));
        // Garbage is Invalid, not TooLarge.
        assert!(matches!(
            decode(b"\xFF\xD8garbage", None),
            Err(DecodeError::Invalid(_))
        ));
        // Normal photos still decode.
        assert!(decode(&synth::jpeg(4000, 3000, 2, 60), None).is_ok());
    }

    /// A PNG signature + IHDR claiming `w`×`h` RGB8 and a tiny (invalid) IDAT:
    /// the decoder must refuse on the header, before allocating.
    fn png_header(w: u32, h: u32) -> Vec<u8> {
        fn chunk(out: &mut Vec<u8>, kind: &[u8], data: &[u8]) {
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            let start = out.len();
            out.extend_from_slice(kind);
            out.extend_from_slice(data);
            let crc = crc32(&out[start..]);
            out.extend_from_slice(&crc.to_be_bytes());
        }
        fn crc32(b: &[u8]) -> u32 {
            let mut c = 0xFFFF_FFFFu32;
            for &x in b {
                c ^= u32::from(x);
                for _ in 0..8 {
                    c = if c & 1 != 0 {
                        0xEDB8_8320 ^ (c >> 1)
                    } else {
                        c >> 1
                    };
                }
            }
            !c
        }
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&w.to_be_bytes());
        ihdr.extend_from_slice(&h.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        chunk(&mut out, b"IHDR", &ihdr);
        chunk(&mut out, b"IDAT", &[0x78, 0x9c, 0x03, 0x00]);
        chunk(&mut out, b"IEND", &[]);
        out
    }

    #[test]
    fn orientation_rotates_work_copy() {
        let d = decode(&synth::jpeg(400, 200, 1, 80), Some(6)).unwrap();
        assert_eq!((d.width, d.height), (400, 200));
        assert_eq!((d.work.width(), d.work.height()), (200, 400));
    }

    #[test]
    fn ai_jpeg_is_valid() {
        let d = decode(&synth::jpeg(1200, 900, 4, 80), None).unwrap();
        let j = to_jpeg(&d.work).unwrap();
        let back = image::load_from_memory(&j).unwrap();
        assert_eq!(back.width(), 1024);
    }
}
