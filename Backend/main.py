from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import cv2
import numpy as np
import mediapipe as mp


from fastapi import FastAPI, UploadFile, File, Form
from ultralytics import YOLO
from pathlib import Path


# =====================================================
# APP
# =====================================================

app = FastAPI(title="DriveGuard AI Backend")


# =====================================================
# CORS
# =====================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500"
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =====================================================
# MEDIAPIPE FACE LANDMARKER
# =====================================================

MODEL_PATH = (
    Path(__file__).parent
    / "models"
    / "face_landmarker.task"
)

BaseOptions = mp.tasks.BaseOptions
FaceLandmarker = mp.tasks.vision.FaceLandmarker
FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions

landmarker_options = FaceLandmarkerOptions(
    base_options=BaseOptions(
        model_asset_path=str(MODEL_PATH)
    ),
    num_faces=1,
    min_face_detection_confidence=0.5,
    min_face_presence_confidence=0.5,
    min_tracking_confidence=0.5,
)

face_landmarker = FaceLandmarker.create_from_options(
    landmarker_options
)


# =====================================================
# YOLO OBJECT DETECTION
# =====================================================

phone_model = YOLO("yolo11n.pt")


# =====================================================
# REQUEST MODEL
# =====================================================

class DriverData(BaseModel):

    drowsiness: float = 0
    phone_usage: float = 0
    lane_departure: float = 0
    speed_factor: float = 0


# =====================================================
# RISK CALCULATION
# =====================================================

def calculate_risk(data: DriverData):

    risk_score = (
        data.drowsiness * 0.40
        + data.phone_usage * 0.30
        + data.lane_departure * 0.20
        + data.speed_factor * 0.10
    )

    risk_score = round(risk_score, 2)

    if risk_score <= 40:

        risk_level = "LOW"
        action = "No intervention required"

    elif risk_score <= 70:

        risk_level = "MEDIUM"
        action = "Driver attention recommended"

    else:

        risk_level = "HIGH"
        action = "Immediate driver intervention required"

    return {
        "risk_score": risk_score,
        "risk_level": risk_level,
        "recommended_action": action
    }


# =====================================================
# EYE ASPECT RATIO
# =====================================================

def eye_aspect_ratio(landmarks, points):

    p1 = landmarks[points[0]]
    p2 = landmarks[points[1]]
    p3 = landmarks[points[2]]
    p4 = landmarks[points[3]]
    p5 = landmarks[points[4]]
    p6 = landmarks[points[5]]

    vertical_1 = np.linalg.norm(
        np.array([p2.x, p2.y])
        -
        np.array([p6.x, p6.y])
    )

    vertical_2 = np.linalg.norm(
        np.array([p3.x, p3.y])
        -
        np.array([p5.x, p5.y])
    )

    horizontal = np.linalg.norm(
        np.array([p1.x, p1.y])
        -
        np.array([p4.x, p4.y])
    )

    if horizontal == 0:
        return 0

    return (
        vertical_1 + vertical_2
    ) / (2.0 * horizontal)


# =====================================================
# DROWSINESS STATE
# =====================================================

closed_eye_frames = 0


# =====================================================
# SPEED FACTOR
# =====================================================

previous_gray = None


def calculate_speed_factor(frame):

    global previous_gray

    gray = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2GRAY
    )

    gray = cv2.resize(
        gray,
        (320, 240)
    )

    if previous_gray is None:

        previous_gray = gray.copy()

        return 0

    flow = cv2.calcOpticalFlowFarneback(
        previous_gray,
        gray,
        None,
        0.5,
        3,
        15,
        3,
        5,
        1.2,
        0
    )

    magnitude, angle = cv2.cartToPolar(
        flow[..., 0],
        flow[..., 1]
    )

    motion_score = float(
        np.mean(magnitude)
    )

    speed_factor = min(
        100,
        round(motion_score * 20, 2)
    )

    previous_gray = gray.copy()

    return speed_factor


# =====================================================
# DROWSINESS DETECTION
# =====================================================

def calculate_drowsiness(landmarks):

    global closed_eye_frames

    left_eye = [
        33,
        160,
        158,
        133,
        153,
        144
    ]

    right_eye = [
        362,
        385,
        387,
        263,
        373,
        380
    ]

    left_ear = eye_aspect_ratio(
        landmarks,
        left_eye
    )

    right_ear = eye_aspect_ratio(
        landmarks,
        right_eye
    )

    ear = (
        left_ear + right_ear
    ) / 2.0

    # Eye closed threshold
    EYE_CLOSED_THRESHOLD = 0.21

    if ear < EYE_CLOSED_THRESHOLD:

        closed_eye_frames += 1

    else:

        closed_eye_frames = 0

    # Drowsiness score

    if closed_eye_frames < 2:

        drowsiness = 0

    elif closed_eye_frames < 3:

        drowsiness = 30

    elif closed_eye_frames < 5:

        drowsiness = 60

    elif closed_eye_frames < 7:

        drowsiness = 80

    else:

        drowsiness = 100

    return (
        round(drowsiness, 2),
        round(ear, 4),
        closed_eye_frames
    )


# =====================================================
# LANE DEPARTURE DETECTION
# =====================================================

def calculate_lane_departure(frame):

    height, width = frame.shape[:2]

    # Convert to grayscale
    gray = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2GRAY
    )

    # Reduce noise
    blur = cv2.GaussianBlur(
        gray,
        (5, 5),
        0
    )

    # Detect edges
    edges = cv2.Canny(
        blur,
        50,
        150
    )

    # Region of interest
    mask = np.zeros_like(edges)

    polygon = np.array([[
        (0, height),
        (width, height),
        (int(width * 0.60), int(height * 0.55)),
        (int(width * 0.40), int(height * 0.55))
    ]], dtype=np.int32)

    cv2.fillPoly(
        mask,
        polygon,
        255
    )

    roi = cv2.bitwise_and(
        edges,
        mask
    )

    # Hough line detection
    lines = cv2.HoughLinesP(
        roi,
        1,
        np.pi / 180,
        threshold=50,
        minLineLength=50,
        maxLineGap=100
    )

    left_lines = []
    right_lines = []

    if lines is not None:

        for line in lines:

            # Handle HoughLinesP output safely
            coords = np.asarray(line).reshape(-1)

            if len(coords) != 4:
                continue

            x1, y1, x2, y2 = coords

            x1 = int(x1)
            y1 = int(y1)
            x2 = int(x2)
            y2 = int(y2)

            if x2 == x1:
                continue

            slope = (
                (y2 - y1)
                /
                (x2 - x1)
            )

            # Ignore horizontal lines
            if abs(slope) < 0.5:
                continue

            if slope < 0:

                left_lines.append(
                    (x1, y1, x2, y2)
                )

            else:

                right_lines.append(
                    (x1, y1, x2, y2)
                )

    # Both lane sides required
    if not left_lines or not right_lines:

        return {
            "lane_departure": 0,
            "lane_detected": False,
            "lane_position": "unknown"
        }

    # Calculate left lane center
    left_x = np.mean([
        (x1 + x2) / 2
        for x1, y1, x2, y2 in left_lines
    ])

    # Calculate right lane center
    right_x = np.mean([
        (x1 + x2) / 2
        for x1, y1, x2, y2 in right_lines
    ])

    # Calculate lane center
    lane_center = (
        left_x + right_x
    ) / 2

    # Center of camera frame
    frame_center = width / 2

    # Difference between lane center and camera center
    offset = (
        lane_center - frame_center
    )

    # Normalize offset
    normalized_offset = (
        abs(offset) / width
    )

    # Determine lane position
    if normalized_offset < 0.05:

        lane_departure = 0
        lane_position = "center"

    elif normalized_offset < 0.10:

        lane_departure = 40
        lane_position = "slightly_departed"

    else:

        lane_departure = 100

        if offset > 0:
            lane_position = "right"
        else:
            lane_position = "left"

    return {
        "lane_departure": lane_departure,
        "lane_detected": True,
        "lane_position": lane_position
    }


# =====================================================
# ROOT
# =====================================================

@app.get("/")
def root():

    return {
        "status": "online",
        "message": "DriveGuard AI Backend is running"
    }


# =====================================================
# HEALTH
# =====================================================

@app.get("/health")
def health():

    return {
        "status": "healthy"
    }


# =====================================================
# API STATUS
# =====================================================

@app.get("/api/status")
def api_status():

    return {
        "status": "online",
        "message": "Python AI engine active"
    }


# =====================================================
# RISK API
# =====================================================

@app.post("/api/risk")
def calculate_driver_risk(
    data: DriverData
):

    result = calculate_risk(data)

    return {
        "input": data,
        "result": result
    }


# =====================================================
# CAMERA FRAME API
# =====================================================

@app.post("/api/frame")
async def receive_frame(
    file: UploadFile = File(...),
    speed_kmh: float = Form(0)
):

    # -----------------------------------------
    # READ IMAGE
    # -----------------------------------------

    image_bytes = await file.read()

    image_array = np.frombuffer(
        image_bytes,
        np.uint8
    )

    frame = cv2.imdecode(
        image_array,
        cv2.IMREAD_COLOR
    )

    if frame is None:

        return {
            "status": "error",
            "message": "Could not decode image"
        }

    # -----------------------------------------
    # MEDIAPIPE FACE DETECTION
    # -----------------------------------------

    frame_rgb = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2RGB
    )

    mp_image = mp.Image(
        image_format=mp.ImageFormat.SRGB,
        data=frame_rgb
    )

    result = face_landmarker.detect(
        mp_image
    )

    # -----------------------------------------
    # NO FACE
    # -----------------------------------------

    if not result.face_landmarks:

        return {
            "status": "no_face",
            "message": "No face detected",

            "drowsiness": 0,
            "eye_aspect_ratio": 0,
            "closed_eye_frames": 0,

            "phone_detected": False,
            "phone_confidence": 0,
            "phone_usage": 0,

            "lane_detected": False,
            "lane_position": "unknown",
            "lane_departure": 0,

            "speed_factor": 0,

            "risk": calculate_risk(
                DriverData()
            )
        }

    # -----------------------------------------
    # FIRST FACE
    # -----------------------------------------

    landmarks = result.face_landmarks[0]

    drowsiness, ear, closed_frames = (
        calculate_drowsiness(
            landmarks
        )
    )

    # -----------------------------------------
    # PHONE DETECTION
    # -----------------------------------------

    phone_detected = False
    phone_confidence = 0.0

    yolo_results = phone_model(
        frame,
        verbose=False
    )

    for yolo_result in yolo_results:

        for box in yolo_result.boxes:

            class_id = int(
                box.cls[0]
            )

            confidence = float(
                box.conf[0]
            )

            class_name = phone_model.names[
                class_id
            ]

            if (
                class_name == "cell phone"
                and confidence >= 0.40
            ):

                phone_detected = True

                phone_confidence = (
                    confidence
                )

                break

        if phone_detected:
            break

    # -----------------------------------------
    # PHONE USAGE
    # -----------------------------------------

    if phone_detected:

        phone_usage = round(
            phone_confidence * 100,
            2
        )

    else:

        phone_usage = 0

    # -----------------------------------------
    # LANE DEPARTURE
    # -----------------------------------------

    lane_result = calculate_lane_departure(
        frame
    )

    lane_departure = lane_result[
        "lane_departure"
    ]

    # -----------------------------------------
    # SPEED FACTOR
    # -----------------------------------------

    speed_factor = min((speed_kmh / 100) * 100, 100)
    speed_factor = round(speed_factor, 2)

    # -----------------------------------------
    # DRIVER DATA
    # -----------------------------------------

    driver_data = DriverData(

        drowsiness=drowsiness,

        phone_usage=phone_usage,

        lane_departure=lane_departure,

        speed_factor=speed_factor
    )

    # -----------------------------------------
    # RISK
    # -----------------------------------------

    risk = calculate_risk(
        driver_data
    )

    # -----------------------------------------
    # PROLONGED EYE CLOSURE
    # -----------------------------------------

    if closed_frames >= 15:

        risk["risk_level"] = "HIGH"

        risk["recommended_action"] = (
            "Drowsiness detected - "
            "Immediate driver alert required"
        )

    elif closed_frames >= 8:

        risk["risk_level"] = "MEDIUM"

        risk["recommended_action"] = (
            "Driver appears drowsy - "
            "Please stay alert"
        )

    # -----------------------------------------
    # FINAL RESPONSE
    # -----------------------------------------

    return {

        "status": "analyzed",

        "filename": file.filename,

        "face_detected": True,

        "drowsiness": drowsiness,

        "eye_aspect_ratio": ear,

        "closed_eye_frames": closed_frames,

        "phone_detected": phone_detected,

        "phone_confidence": round(
            phone_confidence,
            3
        ),

        "phone_usage": phone_usage,

        "lane_detected": lane_result[
            "lane_detected"
        ],

        "lane_position": lane_result[
            "lane_position"
        ],

        "lane_departure": lane_departure,

        "speed_factor": speed_factor,

        "risk": risk
    }