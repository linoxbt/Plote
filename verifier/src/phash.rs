//! 64-bit perceptual hash (DCT pHash via `image_hasher`) and Hamming distance.

use image::DynamicImage;
use image_hasher::{HashAlg, HasherConfig};

/// pHash only needs ~32×32, so hash a ≤ 512 px copy.
pub const HASH_INPUT_MAX: u32 = 512;

pub fn phash(img: &DynamicImage) -> u64 {
    let small = crate::img::downscale(img.clone(), HASH_INPUT_MAX);
    let hasher = HasherConfig::with_bytes_type::<[u8; 8]>()
        .hash_size(8, 8)
        .hash_alg(HashAlg::Mean)
        .preproc_dct()
        .to_hasher();
    let h = hasher.hash_image(&small);
    let mut b = [0u8; 8];
    b.copy_from_slice(&h.as_bytes()[..8]);
    u64::from_be_bytes(b)
}

pub fn to_hex(h: u64) -> String {
    format!("{h:016x}")
}

pub fn hamming(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

/// Smallest distance to any known hash; 64 if there are none.
pub fn nearest(h: u64, known: &[u64]) -> u32 {
    known.iter().map(|k| hamming(h, *k)).min().unwrap_or(64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synth;

    fn hash_of(bytes: &[u8]) -> u64 {
        phash(&crate::img::decode(bytes, None).unwrap().work)
    }

    #[test]
    fn hamming_basics() {
        assert_eq!(hamming(0, 0), 0);
        assert_eq!(hamming(0, u64::MAX), 64);
        assert_eq!(hamming(0b1011, 0b0001), 2);
        assert_eq!(nearest(5, &[]), 64);
        assert_eq!(nearest(0, &[u64::MAX, 1, 3]), 1);
        assert_eq!(to_hex(0xc3a1_f0e2_9b7d_4410), "c3a1f0e29b7d4410");
        assert_eq!(to_hex(1).len(), 16);
    }

    #[test]
    fn reencoded_and_resized_copy_is_close() {
        let orig = synth::jpeg(1600, 1200, 7, 92);
        let h0 = hash_of(&orig);
        for (scale, q) in [(1.0, 60), (0.5, 75), (0.3, 50), (0.8, 40)] {
            let copy = synth::reencode(&orig, scale, q);
            let d = hamming(h0, hash_of(&copy));
            assert!(d <= 4, "scale {scale} q {q}: distance {d}");
        }
        // PNG of the same scene, too.
        let png = synth::png(1600, 1200, 7);
        assert!(hamming(h0, hash_of(&png)) <= 4);
    }

    #[test]
    fn different_scenes_are_far() {
        let hashes: Vec<u64> = (1..=8)
            .map(|s| hash_of(&synth::jpeg(800, 600, s, 90)))
            .collect();
        for i in 0..hashes.len() {
            for j in (i + 1)..hashes.len() {
                let d = hamming(hashes[i], hashes[j]);
                assert!(d > 12, "seeds {} and {}: distance {d}", i + 1, j + 1);
            }
        }
    }
}
