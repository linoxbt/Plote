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

/// Decode JPEG/PNG bytes, apply EXIF orientation and downscale once so that
/// later steps never touch the full-size frame.
pub fn decode(bytes: &[u8], orientation: Option<u8>) -> Result<Decoded, String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
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
