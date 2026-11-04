//! Fuzzy comparison of the challenge code the model read off the paper.
//!
//! Rules: case-insensitive; spaces, dashes (and other whitespace) ignored;
//! O≡0 and I≡1≡L; then at most one character edit (Levenshtein ≤ 1).

/// Canonical form used for comparison.
pub fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace() && !matches!(c, '-' | '‐' | '‑' | '–' | '—'))
        .flat_map(char::to_uppercase)
        .map(|c| match c {
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        })
        .collect()
}

/// Levenshtein distance (small strings; O(n·m) is fine).
pub fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let sub = prev[j] + usize::from(ca != cb);
            cur[j + 1] = sub.min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum ChallengeResult {
    Match,
    /// The model saw no code (null / empty after normalisation).
    Missing,
    Mismatch,
}

pub fn compare(expected: &str, read: Option<&str>) -> ChallengeResult {
    let read = match read.map(normalize) {
        Some(r) if !r.is_empty() => r,
        _ => return ChallengeResult::Missing,
    };
    let expected = normalize(expected);
    if expected.is_empty() {
        // Nothing was issued; nothing can match.
        return ChallengeResult::Mismatch;
    }
    if edit_distance(&expected, &read) <= 1 {
        ChallengeResult::Match
    } else {
        ChallengeResult::Mismatch
    }
}

#[cfg(test)]
mod tests {
    use super::ChallengeResult::*;
    use super::*;

    #[test]
    fn exact_and_case_insensitive() {
        assert_eq!(compare("K7RQ4M", Some("K7RQ4M")), Match);
        assert_eq!(compare("K7RQ4M", Some("k7rq4m")), Match);
    }

    #[test]
    fn ignores_spaces_and_dashes() {
        assert_eq!(compare("K7RQ4M", Some("K7R-Q4M")), Match);
        assert_eq!(compare("K7RQ4M", Some(" k7 rq 4m ")), Match);
        assert_eq!(compare("K7RQ4M", Some("K7R–Q4M")), Match);
    }

    #[test]
    fn lookalikes_are_equivalent() {
        assert_eq!(compare("B0LT1X", Some("BOLTIX")), Match);
        assert_eq!(compare("B0LT1X", Some("bo1tlx")), Match);
        assert_eq!(compare("AI0L", Some("A10I")), Match);
    }

    #[test]
    fn one_edit_allowed() {
        assert_eq!(compare("K7RQ4M", Some("K7RQ4N")), Match); // substitution
        assert_eq!(compare("K7RQ4M", Some("K7RQ4")), Match); // deletion
        assert_eq!(compare("K7RQ4M", Some("K7RQQ4M")), Match); // insertion
    }

    #[test]
    fn two_edits_rejected() {
        assert_eq!(compare("K7RQ4M", Some("K7RQXX")), Mismatch);
        assert_eq!(compare("K7RQ4M", Some("Q7RK4M")), Mismatch); // swap = 2 subs
        assert_eq!(compare("K7RQ4M", Some("ZZZZZZ")), Mismatch);
    }

    #[test]
    fn missing() {
        assert_eq!(compare("K7RQ4M", None), Missing);
        assert_eq!(compare("K7RQ4M", Some("")), Missing);
        assert_eq!(compare("K7RQ4M", Some(" - ")), Missing);
    }

    #[test]
    fn levenshtein_basics() {
        assert_eq!(edit_distance("", ""), 0);
        assert_eq!(edit_distance("abc", ""), 3);
        assert_eq!(edit_distance("kitten", "sitting"), 3);
    }
}
