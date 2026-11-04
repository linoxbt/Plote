//! Great-circle distance on a spherical Earth.

/// Mean Earth radius (IUGG), metres.
pub const EARTH_RADIUS_M: f64 = 6_371_008.8;

/// Haversine distance in metres between two points given in micro-degrees.
pub fn haversine_m(lat1_e6: i64, lon1_e6: i64, lat2_e6: i64, lon2_e6: i64) -> f64 {
    let to_rad = |e6: i64| (e6 as f64 / 1e6).to_radians();
    let (p1, p2) = (to_rad(lat1_e6), to_rad(lat2_e6));
    let dp = p2 - p1;
    let dl = to_rad(lon2_e6) - to_rad(lon1_e6);
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * a.sqrt().min(1.0).asin()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_distance() {
        assert_eq!(haversine_m(6_447_000, 3_474_000, 6_447_000, 3_474_000), 0.0);
    }

    #[test]
    fn one_degree_latitude() {
        // pi/180 * R = 111 195.08 m
        let d = haversine_m(0, 0, 1_000_000, 0);
        assert!((d - 111_195.08).abs() < 0.5, "{d}");
    }

    #[test]
    fn london_paris() {
        // Reference haversine value ~343.5 km.
        let d = haversine_m(51_507_400, -127_800, 48_856_600, 2_352_200);
        assert!((d - 343_550.0).abs() < 1_000.0, "{d}");
    }

    #[test]
    fn spec_example_is_about_23_m() {
        // SPEC 6.3: geofence (6.447000, 3.474000) vs photo (6.447118, 3.474201).
        let d = haversine_m(6_447_000, 3_474_000, 6_447_118, 3_474_201);
        assert!((d - 25.8).abs() < 1.0, "{d}");
    }

    #[test]
    fn antipodal_is_half_circumference() {
        let d = haversine_m(0, 0, 0, 180_000_000);
        assert!((d - std::f64::consts::PI * EARTH_RADIUS_M).abs() < 1.0);
    }
}
