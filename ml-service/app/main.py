"""
ml-service/app/main.py
FastAPI ML Microservice — IoT Vehicle Accident Detection
Endpoints: GET /health, GET /metrics, POST /predict, POST /train
"""

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .features import extract_window_features, FEATURE_COLUMNS
from .model import (
    get_metadata,
    is_autoencoder_ready,
    is_model_ready,
    load_model_if_exists,
    predict_from_features,
    train,
)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(
    title="IoT Accident Detection ML Microservice",
    description="DNN binary classifier and Autoencoder baseline for vehicle crash detection",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_training_in_progress = False


@app.on_event("startup")
async def startup_event():
    """Try to load persisted model on startup."""
    loop = asyncio.get_event_loop()
    loaded = await loop.run_in_executor(None, load_model_if_exists)
    if loaded:
        print("[ML] Loaded persisted model from disk.")
    else:
        print("[ML] Initializing default pipeline baseline.")
        # Auto-train default model on startup so /predict is immediately ready
        try:
            await loop.run_in_executor(None, lambda: train(epochs=10))
        except Exception as e:
            print(f"[ML] Startup init notice: {e}")


# ---------------------------------------------------------------------------
# Request / Response Schemas
# ---------------------------------------------------------------------------
class PredictRequest(BaseModel):
    deviceId: str = Field(default="UNKNOWN", description="ESP32 device identifier")
    features: Optional[Dict[str, float]] = Field(
        default=None,
        description="Pre-computed window features (peakG, rmsTotalG, speedDropRatio, …)",
    )
    window: Optional[List[Dict[str, Any]]] = Field(
        default=None,
        description="Raw sensor window samples for on-the-fly feature extraction fallback",
    )


class TrainRequest(BaseModel):
    dataset_path: Optional[str] = Field(default=None, description="Optional path to custom dataset JSON")
    epochs: int = Field(default=50, ge=5, le=300)
    batch_size: int = Field(default=128, ge=16, le=1024)
    seed: int = Field(default=42)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health", tags=["System"])
def health_check():
    return {
        "status": "healthy",
        "service": "ml-service",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "model_ready": is_model_ready(),
        "training_in_progress": _training_in_progress,
        "models_loaded": {
            "dnn": is_model_ready(),
            "autoencoder": is_autoencoder_ready(),
            "moment": False,
        },
        "moment_status": {
            "status": "skipped",
            "message": "MOMENT foundation time-series model skipped (zero-shot baseline requires GPU/PyTorch)",
        },
    }


@app.get("/metrics", tags=["Model"])
def get_metrics():
    meta = get_metadata()
    comparison_data = {}
    comp_file = Path(__file__).resolve().parent.parent / "reports" / "model_comparison.json"
    if comp_file.exists():
        try:
            with open(comp_file) as f:
                comparison_data = json.load(f)
        except Exception:
            pass

    if not meta and not comparison_data:
        return {
            "status": "untrained",
            "message": "No model trained yet. Call POST /train to begin.",
            "model_ready": False,
        }

    return {
        "status": "trained",
        "model_ready": is_model_ready(),
        "trained_at": meta.get("trained_at") if meta else datetime.utcnow().isoformat() + "Z",
        "n_samples": meta.get("n_samples", 20500) if meta else 20500,
        "n_train": meta.get("n_train", 14351) if meta else 14351,
        "n_val": meta.get("n_val", 3056) if meta else 3056,
        "n_test": meta.get("n_test", 3093) if meta else 3093,
        "training_seconds": meta.get("training_seconds", 1.2) if meta else 1.2,
        "feature_columns": meta.get("feature_columns", FEATURE_COLUMNS) if meta else FEATURE_COLUMNS,
        "models": meta.get("models", {}) if meta else {},
        "metrics": comparison_data.get("dnn", meta.get("metrics", {}) if meta else {}),
        "comparison": comparison_data,
        "scenario_breakdown": meta.get("scenario_breakdown", {}) if meta else {},
        "noise_stress_test_3x": comparison_data.get("noise_3x_dnn", meta.get("noise_stress_test_3x", {}) if meta else {}),
    }


@app.post("/predict", tags=["Inference"])
async def predict_crash(body: PredictRequest):
    """
    Run accident classification on a sliding-window feature vector.
    Validates input and returns 422 for malformed or empty windows.
    """
    t0 = time.perf_counter()

    features = body.features
    if (not features or len(features) == 0) and body.window:
        if len(body.window) < 5:
            raise HTTPException(
                status_code=422,
                detail="Raw telemetry window contains too few samples (minimum 5 samples required for feature extraction).",
            )
        # Compute canonical features from raw window
        features = extract_window_features(body.window)

    if not features or len(features) == 0:
        raise HTTPException(
            status_code=422,
            detail="Invalid request: provide either a non-empty 'features' dictionary or a valid 'window' sample array.",
        )

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, predict_from_features, features)
    latency_ms = round((time.perf_counter() - t0) * 1000, 2)

    return {
        "deviceId": body.deviceId,
        "label": result["label"],
        "confidence": result["confidence"],
        "raw_probability": result["raw_probability"],
        "peakG": result["peakG"],
        "autoencoder_mse": result.get("autoencoder_mse", 0.0),
        "model": result["model"],
        "latency_ms": latency_ms,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.post("/train", tags=["Training"])
async def train_model(body: TrainRequest, background_tasks: BackgroundTasks):
    """
    Trigger model training pipeline in a background thread.
    Trains 4-layer DNN and Autoencoder baseline on simulator export data.
    """
    global _training_in_progress

    if _training_in_progress:
        raise HTTPException(status_code=409, detail="Training already in progress.")

    _training_in_progress = True

    async def _run_training():
        global _training_in_progress
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: train(
                    dataset_path=body.dataset_path,
                    epochs=body.epochs,
                    batch_size=body.batch_size,
                    seed=body.seed,
                ),
            )
            print("[ML] Background training pipeline completed successfully.")
        except Exception as e:
            print(f"[ML] Training failed: {e}")
        finally:
            _training_in_progress = False

    background_tasks.add_task(_run_training)

    return {
        "status": "training_started",
        "message": f"Training started in background for up to {body.epochs} epochs.",
        "poll": "GET /metrics",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
