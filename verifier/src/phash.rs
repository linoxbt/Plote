//! 64-bit perceptual hash (DCT pHash via `image_hasher`) and Hamming distance.

use image::DynamicImage;
use image_hasher::{HashAlg, HasherConfig};

/// pHash only needs ~32×32, so hash a ≤ 512 px copy.
pub const HASH_INPUT_MAX: u32 = 512;

fn hasher() -> image_hasher::Hasher<[u8; 8]> {
    HasherConfig::with_bytes_type::<[u8; 8]>()
        .hash_size(8, 8)
        .hash_alg(HashAlg::Mean)
        .preproc_dct()
        .to_hasher()
}

fn hash_with(hasher: &image_hasher::Hasher<[u8; 8]>, img: &DynamicImage) -> u64 {
    let h = hasher.hash_image(img);
    let mut b = [0u8; 8];
    b.copy_from_slice(&h.as_bytes()[..8]);
    u64::from_be_bytes(b)
}

/// The canonical hash: of the image as given (already orientation-corrected).
/// This is the hash reported in the verdict and stored on-chain.
pub fn phash(img: &DynamicImage) -> u64 {
    let small = crate::img::downscale(img.clone(), HASH_INPUT_MAX);
    hash_with(&hasher(), &small)
}

/// Hashes of all 8 orientations (the dihedral group: rotations by 0/90/180/270
/// degrees and their mirror images). Index 0 is the canonical `phash`. A DCT
/// pHash is not invariant under flips or rotations, so a recycled photo that was
/// mirrored or rotated (in pixels or with the EXIF Orientation tag) would
/// otherwise look new; comparing every variant against the known hashes closes that.
pub fn phash_variants(img: &DynamicImage) -> [u64; 8] {
    let small = crate::img::downscale(img.clone(), HASH_INPUT_MAX);
    let mirrored = small.fliph();
    let hasher = hasher();
    [
        hash_with(&hasher, &small),
        hash_with(&hasher, &small.rotate90()),
        hash_with(&hasher, &small.rotate180()),
        hash_with(&hasher, &small.rotate270()),
        hash_with(&hasher, &mirrored),
        hash_with(&hasher, &mirrored.rotate90()),
        hash_with(&hasher, &mirrored.rotate180()),
        hash_with(&hasher, &mirrored.rotate270()),
    ]
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

/// Smallest distance from any of `hashes` (e.g. the 8 orientation variants) to
/// any known hash; 64 if either list is empty.
pub fn nearest_any(hashes: &[u64], known: &[u64]) -> u32 {
    hashes
        .iter()
        .map(|h| nearest(*h, known))
        .min()
        .unwrap_or(64)
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
    fn variants_catch_mirrored_and_rotated_copies() {
        let orig = crate::img::decode(&synth::jpeg(1600, 1200, 21, 90), None)
            .unwrap()
            .work;
        let h0 = phash(&orig);
        let v0 = phash_variants(&orig);
        assert_eq!(v0[0], h0, "index 0 is the canonical hash");
        for copy in [
            orig.fliph(),
            orig.flipv(),
            orig.rotate90(),
            orig.rotate180(),
            orig.rotate270(),
            orig.fliph().rotate90(),
        ] {
            // Re-encode too, as a recycler would.
            let bytes = synth::encode_jpeg(&copy, 70);
            let work = crate::img::decode(&bytes, None).unwrap().work;
            let plain = hamming(phash(&work), h0);
            let best = nearest_any(&phash_variants(&work), &[h0]);
            assert!(best <= 4, "variant distance {best} (canonical {plain})");
        }
        // Mirroring alone defeats the canonical hash, which is why variants exist.
        let m = crate::img::decode(&synth::encode_jpeg(&orig.fliph(), 90), None)
            .unwrap()
            .work;
        assert!(hamming(phash(&m), h0) > 8);
        assert_eq!(nearest_any(&[], &[h0]), 64);
        assert_eq!(nearest_any(&[1, 2], &[]), 64);
        assert_eq!(nearest_any(&[0b111, 0b1], &[0]), 1);
    }

    #[test]
    fn different_scenes_are_far() {
        let hashes: Vec<u64> = (1..=8)
            .map(|s| hash_of(&synth::jpeg(800, 600, s, 90)))
            .collect();
        // Different scenes stay far apart even across orientation variants.
        for i in 0..4u64 {
            let a = crate::img::decode(&synth::jpeg(800, 600, i + 1, 90), None).unwrap();
            let others: Vec<u64> = hashes
                .iter()
                .enumerate()
                .filter(|(j, _)| *j as u64 != i)
                .map(|(_, h)| *h)
                .collect();
            let d = nearest_any(&phash_variants(&a.work), &others);
            assert!(d > 8, "seed {}: variant distance {d}", i + 1);
        }
        for i in 0..hashes.len() {
            for j in (i + 1)..hashes.len() {
                let d = hamming(hashes[i], hashes[j]);
                assert!(d > 12, "seeds {} and {}: distance {d}", i + 1, j + 1);
            }
        }
    }
}
