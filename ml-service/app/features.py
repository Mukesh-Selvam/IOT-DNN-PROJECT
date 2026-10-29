"""
ml-service/app/features.py
Canonical 14-feature window feature extractor.
Guaranteed mathematical parity with server/src/utils/features.js within 1e-4.
"""

import math
from typing import Any, Dict, List

FEATURE_COLUMNS = [
    "peakG",
    "meanTotalG",
    "rmsTotalG",
    "stdTotalG",
    "meanAx",
    "meanAy",
    "meanAz",
    "maxJerkGPerS",
    "speedInitial",
    "speedFinal",
    "speedDelta",
    "speedDropRatio",
    "maxGyroDps",
    "meanGyroDps",
]


def magnitude(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> float:
    return math.sqrt(x * x + y * y + z * z)


def extract_window_features(window: List[Dict[str, Any]]) -> Dict[str, float]:
    """
    Extracts statistical and kinematic features from a raw telemetry window.
    Matches server/src/utils/features.js exactly.
    """
    if not window or len(window) == 0:
        return {
            "count": 0,
            "peakG": 0.0,
            "meanTotalG": 0.0,
            "rmsTotalG": 0.0,
            "stdTotalG": 0.0,
            "meanAx": 0.0,
            "meanAy": 0.0,
            "meanAz": 0.0,
            "maxJerkGPerS": 0.0,
            "speedInitial": 0.0,
            "speedFinal": 0.0,
            "speedDelta": 0.0,
            "speedDropRatio": 0.0,
            "maxGyroDps": 0.0,
            "meanGyroDps": 0.0,
            "peakIndex": -1,
            "peakTimestamp": None,
        }

    N = len(window)
    peak_g = 0.0
    peak_index = -1
    peak_timestamp = None

    sum_mag_a = 0.0
    sum_sq_mag_a = 0.0

    sum_ax = 0.0
    sum_ay = 0.0
    sum_az = 0.0

    max_jerk_g_per_s = 0.0
    max_gyro_dps = 0.0
    sum_gyro_dps = 0.0

    magnitudes_a = [0.0] * N

    for i in range(N):
        pt = window[i]
        # Support both flat {ax, ay, az} and nested {accel: {x, y, z}}
        accel = pt.get("accel") or {}
        ax = float(pt.get("ax") if pt.get("ax") is not None else accel.get("x", 0.0))
        ay = float(pt.get("ay") if pt.get("ay") is not None else accel.get("y", 0.0))
        az = float(pt.get("az") if pt.get("az") is not None else accel.get("z", 0.0))

        gyro = pt.get("gyro") or {}
        gx = float(pt.get("gx") if pt.get("gx") is not None else gyro.get("x", 0.0))
        gy = float(pt.get("gy") if pt.get("gy") is not None else gyro.get("y", 0.0))
        gz = float(pt.get("gz") if pt.get("gz") is not None else gyro.get("z", 0.0))

        mag_a = magnitude(ax, ay, az)
        magnitudes_a[i] = mag_a

        sum_mag_a += mag_a
        sum_sq_mag_a += mag_a * mag_a

        sum_ax += ax
        sum_ay += ay
        sum_az += az

        if mag_a > peak_g:
            peak_g = mag_a
            peak_index = i
            peak_timestamp = pt.get("ts")

        mag_g = magnitude(gx, gy, gz)
        if mag_g > max_gyro_dps:
            max_gyro_dps = mag_g
        sum_gyro_dps += mag_g

        if i > 0:
            prev_pt = window[i - 1]
            ts_cur = pt.get("ts") or 0
            ts_prev = prev_pt.get("ts") or 0
            dt = max(0.001, (ts_cur - ts_prev) / 1000.0)
            jerk = abs(mag_a - magnitudes_a[i - 1]) / dt
            if jerk > max_jerk_g_per_s:
                max_jerk_g_per_s = jerk

    mean_total_g = sum_mag_a / N
    rms_total_g = math.sqrt(sum_sq_mag_a / N)

    var_sum = 0.0
    for i in range(N):
        diff = magnitudes_a[i] - mean_total_g
        var_sum += diff * diff
    std_total_g = math.sqrt(var_sum / N)

    first_pt = window[0]
    last_pt = window[-1]
    gps_first = first_pt.get("gps") or {}
    gps_last = last_pt.get("gps") or {}
    speed_initial = float(first_pt.get("speed") if first_pt.get("speed") is not None else gps_first.get("speed", 0.0))
    speed_final = float(last_pt.get("speed") if last_pt.get("speed") is not None else gps_last.get("speed", 0.0))
    speed_delta = speed_initial - speed_final
    speed_drop_ratio = max(0.0, (speed_initial - speed_final) / speed_initial) if speed_initial > 1.0 else 0.0

    return {
        "count": N,
        "peakG": round(peak_g, 2),
        "meanTotalG": round(mean_total_g, 2),
        "rmsTotalG": round(rms_total_g, 2),
        "stdTotalG": round(std_total_g, 2),
        "meanAx": round(sum_ax / N, 2),
        "meanAy": round(sum_ay / N, 2),
        "meanAz": round(sum_az / N, 2),
        "maxJerkGPerS": round(max_jerk_g_per_s, 1),
        "speedInitial": round(speed_initial, 1),
        "speedFinal": round(speed_final, 1),
        "speedDelta": round(speed_delta, 1),
        "speedDropRatio": round(speed_drop_ratio, 2),
        "maxGyroDps": round(max_gyro_dps, 1),
        "meanGyroDps": round(sum_gyro_dps / N, 1),
        "peakIndex": peak_index,
        "peakTimestamp": peak_timestamp,
    }
