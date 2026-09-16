"""
Phase 35 — Image Deepfake / Manipulation Detection
-----------------------------------------------------
Lightweight, no-training-required manipulation detector using
Error Level Analysis (ELA). This is NOT full deepfake (GAN-face)
detection — it flags likely digital editing/splicing, which is a
realistic, well-documented technique for a student project timeline.

Drop this file next to App.py and import `analyze_image_manipulation`.

Dependencies (add to requirements.txt):
    Pillow
    numpy
"""

import io
from PIL import Image, ImageChops, ImageEnhance
import numpy as np


def _compute_ela_image(image: Image.Image, quality: int = 90) -> Image.Image:
    """
    Re-saves the image at a known JPEG quality, then diffs it against
    the original. Untouched regions settle into a stable low-error
    pattern; edited/spliced regions usually stand out with a much
    higher error level because they don't share the original
    compression history.
    """
    image = image.convert("RGB")

    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=quality)
    buffer.seek(0)
    resaved = Image.open(buffer)

    ela_image = ImageChops.difference(image, resaved)

    extrema = ela_image.getextrema()
    max_diff = max(pair[1] for pair in extrema) or 1
    scale = 255.0 / max_diff

    ela_image = ImageEnhance.Brightness(ela_image).enhance(scale)
    return ela_image


def analyze_image_manipulation(image_bytes: bytes) -> dict:
    """
    Main entry point. Pass raw image bytes (e.g. request.files['image'].read()).

    Returns a dict shaped like:
    {
        "suspicion_score": 0-100,           # higher = more likely edited
        "verdict": "Likely Original" | "Possibly Edited" | "Likely Manipulated",
        "notes": str                        # human-readable caveat
    }
    """
    try:
        image = Image.open(io.BytesIO(image_bytes))
    except Exception:
        return {
            "suspicion_score": 0,
            "verdict": "Unknown",
            "notes": "Could not read image file.",
        }

    ela_image = _compute_ela_image(image)
    ela_array = np.asarray(ela_image).astype(np.float32)

    # Mean and max error give a cheap proxy for how "inconsistent"
    # the compression artifacts are across the image.
    mean_error = float(ela_array.mean())
    std_error = float(ela_array.std())

    # Heuristic thresholds — tune these against a small labeled
    # sample set (a few known-edited vs known-original images)
    # before relying on them for the report/demo.
    suspicion_score = min(100, round((mean_error * 0.6 + std_error * 0.4), 1))

    if suspicion_score < 15:
        verdict = "Likely Original"
    elif suspicion_score < 35:
        verdict = "Possibly Edited"
    else:
        verdict = "Likely Manipulated"

    return {
        "suspicion_score": suspicion_score,
        "verdict": verdict,
        "notes": (
            "Based on Error Level Analysis (JPEG compression inconsistency), "
            "not a trained deepfake/GAN classifier. Best used as a supporting "
            "signal alongside the text/URL checks, not a standalone verdict."
        ),
    }


# --- Flask route sketch (add to App.py) ---------------------------------
#
# from deepfake_detector import analyze_image_manipulation
#
# @app.route("/predict-image-manipulation", methods=["POST"])
# def predict_image_manipulation():
#     if "image" not in request.files:
#         return jsonify({"error": "No image uploaded"}), 400
#     image_bytes = request.files["image"].read()
#     result = analyze_image_manipulation(image_bytes)
#     return jsonify(result)