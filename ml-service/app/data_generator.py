"""
ml-service/app/data_generator.py
Dataset loader and generator for the accident-detection DNN and Autoencoder.
Works on pure Python standard library with optional pandas/numpy/sklearn acceleration.
Implements group-based train/val/test splitting by run_id to guarantee zero data leakage.
"""

import json
import math
import os
import random
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .features import FEATURE_COLUMNS

LABEL_COLUMN = "label"
RUN_ID_COLUMN = "run_id"


def load_dataset(dataset_path: str = None) -> List[Dict[str, Any]]:
    """
    Loads dataset from simulator export (simulator_dataset.json) or generates a synthetic set.
    """
    candidates = [
        dataset_path,
        os.environ.get("DATASET_PATH"),
        str(Path(__file__).resolve().parent.parent / "data" / "simulator_dataset.json"),
        str(Path(__file__).resolve().parent.parent.parent / "simulator" / "data" / "dataset.json"),
    ]

    for p in candidates:
        if p and os.path.exists(p):
            try:
                with open(p, "r") as f:
                    data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    for i, row in enumerate(data):
                        if RUN_ID_COLUMN not in row:
                            row[RUN_ID_COLUMN] = f"RUN_{i // 4:04d}"
                    print(f"[Dataset] Loaded {len(data)} samples from {p}")
                    return data
            except Exception as e:
                print(f"[Dataset] Warning loading {p}: {e}")

    print("[Dataset] Generating physics-calibrated synthetic dataset...")
    return generate_synthetic_dataset(n_runs=60)


def generate_synthetic_dataset(n_runs: int = 60, rng_seed: int = 42) -> List[Dict[str, Any]]:
    """
    Generates synthetic dataset with realistic kinematics and discrete run_ids.
    Pure Python standard library implementation.
    """
    rng = random.Random(rng_seed)
    rows = []

    for run_idx in range(n_runs):
        is_accident = 1 if (run_idx % 3 == 0) else 0
        scenario = "frontal_collision" if is_accident else rng.choice(["normal", "hard_braking", "sharp_turn", "pothole"])
        run_id = f"SYN_RUN_{scenario.upper()}_{run_idx:04d}"

        # 4 sliding windows per simulated run
        for w_idx in range(4):
            if is_accident:
                peak_g = rng.uniform(5.5, 14.0)
                mean_g = rng.uniform(1.2, 2.5)
                rms_g = rng.uniform(1.8, 3.8)
                std_g = rng.uniform(1.2, 3.5)
                mean_ax = rng.uniform(-3.5, -1.0)
                mean_ay = rng.uniform(-1.0, 1.0)
                mean_az = rng.uniform(0.8, 1.2)
                max_jerk = rng.uniform(150.0, 450.0)
                speed_initial = rng.uniform(45.0, 95.0)
                speed_drop_ratio = rng.uniform(0.70, 1.0)
                speed_final = speed_initial * (1.0 - speed_drop_ratio)
                speed_delta = speed_initial - speed_final
                max_gyro = rng.uniform(90.0, 320.0)
                mean_gyro = rng.uniform(25.0, 75.0)
                lbl = 1
            else:
                if scenario == "pothole":
                    peak_g = rng.uniform(2.6, 3.4)
                    max_jerk = rng.uniform(80.0, 180.0)
                elif scenario == "hard_braking":
                    peak_g = rng.uniform(1.4, 2.2)
                    max_jerk = rng.uniform(15.0, 40.0)
                else:
                    peak_g = rng.uniform(0.95, 1.35)
                    max_jerk = rng.uniform(2.0, 20.0)

                mean_g = rng.uniform(0.98, 1.08)
                rms_g = rng.uniform(0.99, 1.15)
                std_g = rng.uniform(0.05, 0.35)
                mean_ax = rng.uniform(-0.15, 0.15)
                mean_ay = rng.uniform(-0.15, 0.15)
                mean_az = rng.uniform(0.95, 1.05)
                speed_initial = rng.uniform(30.0, 80.0)
                speed_drop_ratio = rng.uniform(0.0, 0.25) if scenario != "hard_braking" else rng.uniform(0.3, 0.45)
                speed_final = speed_initial * (1.0 - speed_drop_ratio)
                speed_delta = speed_initial - speed_final
                max_gyro = rng.uniform(5.0, 45.0)
                mean_gyro = rng.uniform(1.0, 12.0)
                lbl = 0

            rows.append({
                RUN_ID_COLUMN: run_id,
                "scenario": scenario,
                LABEL_COLUMN: lbl,
                "peakG": round(peak_g, 2),
                "meanTotalG": round(mean_g, 2),
                "rmsTotalG": round(rms_g, 2),
                "stdTotalG": round(std_g, 2),
                "meanAx": round(mean_ax, 2),
                "meanAy": round(mean_ay, 2),
                "meanAz": round(mean_az, 2),
                "maxJerkGPerS": round(max_jerk, 1),
                "speedInitial": round(speed_initial, 1),
                "speedFinal": round(speed_final, 1),
                "speedDelta": round(speed_delta, 1),
                "speedDropRatio": round(speed_drop_ratio, 2),
                "maxGyroDps": round(max_gyro, 1),
                "meanGyroDps": round(mean_gyro, 1),
            })

    return rows


def split_dataset_by_run_id(
    data: List[Dict[str, Any]],
    test_size: float = 0.15,
    val_size: float = 0.15,
    random_state: int = 42,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Grouped train/val/test split by run_id to ensure zero data leakage across runs.
    """
    rng = random.Random(random_state)
    unique_runs = list({row[RUN_ID_COLUMN] for row in data})
    rng.shuffle(unique_runs)

    n_total_runs = len(unique_runs)
    n_test = max(1, int(n_total_runs * test_size))
    n_val = max(1, int(n_total_runs * val_size))

    test_runs = set(unique_runs[:n_test])
    val_runs = set(unique_runs[n_test : n_test + n_val])
    train_runs = set(unique_runs[n_test + n_val :])

    train_data = [row for row in data if row[RUN_ID_COLUMN] in train_runs]
    val_data = [row for row in data if row[RUN_ID_COLUMN] in val_runs]
    test_data = [row for row in data if row[RUN_ID_COLUMN] in test_runs]

    print(
        f"[Split by Run-ID] Train: {len(train_data)} ({len(train_runs)} runs) | "
        f"Val: {len(val_data)} ({len(val_runs)} runs) | "
        f"Test: {len(test_data)} ({len(test_runs)} runs)"
    )

    return train_data, val_data, test_data
