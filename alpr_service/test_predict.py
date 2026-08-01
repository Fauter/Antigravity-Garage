from fast_alpr import ALPR
from PIL import Image
import sys

def main():
    print("Loading model...")
    alpr = ALPR(
        detector_model="yolo-v9-s-608-license-plate-end2end",
        ocr_model="argentinian-plates-cnn-synth-model"
    )
    
    img_path = "../.data/mock/vehiculo_test.jpg"
    print(f"Loading image from {img_path}...")
    try:
        img = Image.open(img_path)
    except Exception as e:
        print(f"Error loading image: {e}")
        sys.exit(1)
        
    print("Running inference...")
    import numpy as np
    results = alpr.predict(np.array(img))
    for r in results:
        print(f"Plate: {r.ocr.text}, Confidence: {r.ocr.confidence}")

if __name__ == "__main__":
    main()
