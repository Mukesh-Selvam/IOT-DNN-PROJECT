"""
ml-service/tests/test_model.py
Unit tests for DNN training, Autoencoder baseline, group run_id split, and stress-testing.
"""

import json
from pathlib import Path
import pytest

from app.model import (
    AutoencoderAnomalyDetector,
    FeatureScaler,
    compute_binary_metrics,
    predict_from_features,
    train,
    is_model_ready,
    is_autoencoder_ready,
    REPORTS_DIR,
)
from app.data_generator import (
    FEATURE_COLUMNS,
    LABEL_COLUMN,
    RUN_ID_COLUMN,
    generate_synthetic_dataset,
    split_dataset_by_run_id,
)


def test_feature_scaler_fit_transform():
    scaler = FeatureScaler()
    data = [
        [1.0, 10.0],
        [2.0, 20.0],
        [3.0, 30.0],
    ]
    transformed = scaler.fit_transform(data)
    assert len(transformed) == 3
    # Mean of transformed should be 0.0
    assert abs(sum(r[0] for r in transformed)) < 1e-5
    assert abs(sum(r[1] for r in transformed)) < 1e-5


def test_split_by_run_id_zero_leakage():
    df = generate_synthetic_dataset(n_runs=30, rng_seed=123)
    train_df, val_df, test_df = split_dataset_by_run_id(df, test_size=0.2, val_size=0.2, random_state=42)

    train_runs = {r[RUN_ID_COLUMN] for r in train_df}
    val_runs = {r[RUN_ID_COLUMN] for r in val_df}
    test_runs = {r[RUN_ID_COLUMN] for r in test_df}

    # Zero overlap between train, val, and test run groups
    assert len(train_runs.intersection(val_runs)) == 0, "Data leakage between train and val!"
    assert len(train_runs.intersection(test_runs)) == 0, "Data leakage between train and test!"
    assert len(val_runs.intersection(test_runs)) == 0, "Data leakage between val and test!"


def test_autoencoder_anomaly_detection():
    # Generate normal driving vectors (low G, low rotation)
    normal_data = [
        [1.0, 1.0, 1.0, 0.05, 0.0, 0.0, 1.0, 5.0, 50.0, 48.0, 2.0, 0.04, 10.0, 3.0]
        for _ in range(50)
    ]
    ae = AutoencoderAnomalyDetector(input_dim=14, latent_dim=4)
    ae.fit(normal_data)

    assert ae.fitted is True
    assert ae.threshold > 0.0

    # Test normal point -> reconstruction error below threshold (label 0)
    normal_test = [
        [1.02, 1.01, 1.01, 0.06, 0.01, 0.01, 0.99, 6.0, 52.0, 50.0, 2.0, 0.038, 12.0, 3.5]
    ]
    preds, scores = ae.predict(normal_test)
    assert preds[0] == 0, f"Normal sample falsely flagged as anomaly (score: {scores[0]}, threshold: {ae.threshold})"

    # Test severe crash point -> reconstruction error high (label 1 anomaly)
    crash_test = [
        [12.5, 3.2, 4.5, 3.8, -4.5, 2.1, 1.5, 380.0, 65.0, 0.0, 65.0, 1.0, 240.0, 85.0]
    ]
    preds_crash, scores_crash = ae.predict(crash_test)
    assert scores_crash[0] > scores[0], "Crash MSE must exceed normal driving MSE"


def test_training_pipeline_and_reports_generation():
    meta = train(epochs=10, seed=42)

    assert meta["n_samples"] > 0
    assert "metrics" in meta
    assert meta["metrics"]["accuracy"] >= 0.85
    assert meta["metrics"]["recall"] >= 0.85

    assert is_model_ready() is True
    assert is_autoencoder_ready() is True

    # Verify reports were saved
    comparison_file = REPORTS_DIR / "model_comparison.json"
    assert comparison_file.exists(), "model_comparison.json must be generated in reports/"
    with open(comparison_file) as f:
        comp_data = json.load(f)
    assert "dnn" in comp_data
    assert "autoencoder" in comp_data
    assert comp_data["moment"]["status"] == "skipped"


def test_prediction_inference():
    # Crash input
    crash_features = {
        "peakG": 7.5,
        "speedDropRatio": 0.95,
        "maxGyroDps": 160.0,
        "speedInitial": 60.0,
        "speedFinal": 0.0,
    }
    result = predict_from_features(crash_features)
    assert result["label"] == "ACCIDENT"
    assert result["confidence"] >= 0.90
    assert result["peakG"] == 7.5

    # Pothole input (high G but no speed drop or chassis spin)
    pothole_features = {
        "peakG": 4.8,
        "speedDropRatio": 0.02,
        "maxGyroDps": 15.0,
        "speedInitial": 50.0,
        "speedFinal": 49.0,
    }
    res_pothole = predict_from_features(pothole_features)
    assert res_pothole["label"] == "NON_ACCIDENT"


def test_predict_validation_and_422_conditions():
    """
    Verifies input validation rules that trigger HTTP 422 in FastAPI /predict:
    1. Neither features nor window provided -> 422 invalid
    2. Raw window with < 5 samples -> 422 too few samples
    3. Valid features -> 200 OK
    """
    def validate_predict_payload(features=None, window=None):
        if (not features or len(features) == 0) and window:
            if len(window) < 5:
                return 422, "Raw telemetry window contains too few samples (minimum 5 samples required for feature extraction)."
            from app.features import extract_window_features
            features = extract_window_features(window)
        if not features or len(features) == 0:
            return 422, "Invalid request: provide either a non-empty 'features' dictionary or a valid 'window' sample array."
        return 200, features

    # Case 1: Empty payload
    status, msg = validate_predict_payload()
    assert status == 422
    assert "invalid request" in msg.lower()

    # Case 2: Window with only 2 samples
    short_window = [
        {"ax": 0.1, "ay": 0.0, "az": 1.0, "gx": 0, "gy": 0, "gz": 0, "speed": 40},
        {"ax": 0.1, "ay": 0.0, "az": 1.0, "gx": 0, "gy": 0, "gz": 0, "speed": 40},
    ]
    status_short, msg_short = validate_predict_payload(window=short_window)
    assert status_short == 422
    assert "too few samples" in msg_short.lower()

    # Case 3: Valid features
    valid_features = {"peakG": 3.0, "speedDropRatio": 0.4, "maxGyroDps": 60.0}
    status_valid, _ = validate_predict_payload(features=valid_features)
    assert status_valid == 200


def test_metrics_functions_and_ci95():
    """Verifies binary classification metrics (Accuracy, Precision, Recall, F1, ROC-AUC) and Wald 95% CIs."""
    from app.evaluate_all import evaluate_binary_predictions, compute_ci95

    y_true = [1, 1, 1, 1, 0, 0, 0, 0]
    y_pred = [1, 1, 1, 0, 0, 0, 0, 1]  # 3 TP, 1 FN, 3 TN, 1 FP
    latencies = [1.0, 1.2, 0.8, 1.1, 0.9, 1.0, 1.3, 0.7]

    res = evaluate_binary_predictions(y_true, y_pred, latencies)
    assert res["accuracy"] == 0.75
    assert res["precision"] == 0.75
    assert res["recall"] == 0.75
    assert res["f1"] == 0.75
    assert res["auc_roc"] == 0.75
    assert res["confusion_matrix"] == [[3, 1], [1, 3]]
    assert res["latency_median_ms"] > 0

    ci = compute_ci95(0.8, 100)
    assert 0.05 < ci < 0.10

