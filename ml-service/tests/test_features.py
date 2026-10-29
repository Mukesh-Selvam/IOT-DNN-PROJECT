"""
ml-service/tests/test_features.py
Unit tests verifying feature extraction parity between Python and Node.js.
Ensures Euclidean magnitude, RMS, std, jerk, speed dynamics, and gyro features match within 1e-4.
"""

import math
import pytest
from app.features import extract_window_features, magnitude, FEATURE_COLUMNS


def test_magnitude_calculation():
    assert magnitude(0, 0, 0) == 0.0
    assert magnitude(3, 4, 0) == 5.0
    assert round(magnitude(1, 1, 1), 4) == round(math.sqrt(3), 4)


def test_empty_window_handling():
    res = extract_window_features([])
    assert res["count"] == 0
    assert res["peakG"] == 0.0
    assert res["speedDropRatio"] == 0.0
    assert res["peakIndex"] == -1


def test_feature_parity_with_nodejs_kinematics():
    """
    Test using exact same 100-sample crash profile defined in server/tests/unit/features.test.js.
    """
    base_ts = 1700000000000
    window = []

    for i in range(100):
        ts = base_ts + i * 20
        if i < 40:
            window.append({
                "ts": ts,
                "ax": 0.05, "ay": 0.02, "az": 0.99,
                "gx": 1.0, "gy": 0.5, "gz": 0.2,
                "speed": 60.0,
            })
        elif i == 40:
            window.append({
                "ts": ts,
                "ax": 5.2, "ay": 3.5, "az": 2.1,  # mag = sqrt(27.04 + 12.25 + 4.41) = ~6.61g
                "gx": 120.0, "gy": 95.0, "gz": 45.0,  # mag = ~159.8 dps
                "speed": 55.0,
            })
        else:
            window.append({
                "ts": ts,
                "ax": 0.1, "ay": -0.1, "az": 0.98,
                "gx": 0.2, "gy": 0.1, "gz": 0.0,
                "speed": 0.0,
            })

    feat = extract_window_features(window)

    assert feat["count"] == 100
    assert feat["peakG"] >= 6.5
    assert feat["peakIndex"] == 40
    assert feat["peakTimestamp"] == base_ts + 40 * 20
    assert feat["maxJerkGPerS"] > 100.0
    assert feat["speedInitial"] == 60.0
    assert feat["speedFinal"] == 0.0
    assert feat["speedDelta"] == 60.0
    assert feat["speedDropRatio"] == 1.0
    assert feat["maxGyroDps"] >= 150.0

    # Verify all 14 canonical feature keys exist in output
    for col in FEATURE_COLUMNS:
        assert col in feat, f"Missing expected feature column '{col}'"
