from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
from fast_alpr import ALPR
from io import BytesIO
from PIL import Image, UnidentifiedImageError
import time
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="FastALPR Service")

alpr = None

@app.on_event("startup")
async def startup_event():
    global alpr
    logger.info("Initializing ALPR models...")
    try:
        # Default models or specific ones requested
        # First attempt with requested models
        alpr = ALPR(
            detector_model="yolo-v9-s-608-license-plate-end2end",
            ocr_model="argentinian-plates-cnn-synth-model"
        )
    except Exception as e:
        logger.error(f"Failed to load specific models, falling back to defaults: {e}")
        alpr = ALPR()
    logger.info("ALPR models initialized.")

@app.get("/health")
async def health():
    if alpr is None:
        return {"status": "starting"}
    return {"status": "ready"}

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    start_time = time.time()
    
    if file.content_type not in ["image/jpeg", "image/png"]:
        return JSONResponse(
            status_code=200,
            content={
                "status": "ERROR",
                "plate": "",
                "processingTimeMs": int((time.time() - start_time) * 1000),
                "message": "Content-Type must be image/jpeg or image/png",
                "errorCode": "INVALID_MIME"
            }
        )

    try:
        image_bytes = await file.read()
        if len(image_bytes) > 5 * 1024 * 1024:
            return JSONResponse(
                status_code=200,
                content={
                    "status": "ERROR",
                    "plate": "",
                    "processingTimeMs": int((time.time() - start_time) * 1000),
                    "message": "File too large (max 5MB)",
                    "errorCode": "FILE_TOO_LARGE"
                }
            )

        image = Image.open(BytesIO(image_bytes))
        image.verify()
        image = Image.open(BytesIO(image_bytes))
        import numpy as np
        image_np = np.array(image)
    except UnidentifiedImageError:
        return JSONResponse(
            status_code=200,
            content={
                "status": "ERROR",
                "plate": "",
                "processingTimeMs": int((time.time() - start_time) * 1000),
                "message": "Invalid image file",
                "errorCode": "INVALID_IMAGE"
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=200,
            content={
                "status": "ERROR",
                "plate": "",
                "processingTimeMs": int((time.time() - start_time) * 1000),
                "message": f"Error parsing image: {str(e)}",
                "errorCode": "IMAGE_PARSE_ERROR"
            }
        )

    try:
        results = alpr.predict(image_np)
        processing_time = int((time.time() - start_time) * 1000)

        if not results:
            return JSONResponse(
                status_code=200,
                content={
                    "status": "NOT_FOUND",
                    "plate": "",
                    "processingTimeMs": processing_time,
                    "message": "No se detectó ninguna patente"
                }
            )

        def normalize(p):
            return p.upper().replace(" ", "").replace("-", "")

        candidates = []
        for r in results:
            try:
                # Based on typical fast-alpr schema
                text = r.ocr.text if hasattr(r, 'ocr') and r.ocr else (r.text if hasattr(r, 'text') else None)
                conf = r.ocr.confidence if hasattr(r, 'ocr') and r.ocr else (r.confidence if hasattr(r, 'confidence') else 0.0)
                if isinstance(conf, list):
                    conf = sum(conf) / len(conf) if conf else 0.0
                if text:
                    candidates.append({"plate": text, "confidence": conf})
            except Exception as e:
                logger.error(f"Error parsing candidate: {e}")
                pass

        if not candidates:
            return JSONResponse(
                status_code=200,
                content={
                    "status": "NOT_FOUND",
                    "plate": "",
                    "processingTimeMs": processing_time,
                    "message": "No se detectó ninguna patente"
                }
            )

        candidates.sort(key=lambda x: x["confidence"], reverse=True)
        best = candidates[0]
        normalized_best = normalize(best["plate"])

        return JSONResponse(
            status_code=200,
            content={
                "status": "DETECTED",
                "plate": best["plate"],
                "normalizedPlate": normalized_best,
                "confidence": best["confidence"],
                "processingTimeMs": processing_time,
                "candidates": candidates
            }
        )
    except Exception as e:
        logger.error(f"Inference error: {e}")
        return JSONResponse(
            status_code=200,
            content={
                "status": "ERROR",
                "plate": "",
                "processingTimeMs": int((time.time() - start_time) * 1000),
                "message": f"Error al procesar la imagen: {str(e)}",
                "errorCode": "INFERENCE_ERROR"
            }
        )
