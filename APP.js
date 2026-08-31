/* =====================================================
   GLOBAL STATE
===================================================== */

let liveAPI = false;

let soundEnabled = true;

let cameraStream = null;

let startTime = Date.now();

let peakRisk = 0;

let highEvents = 0;

let mediumEvents = 0;

let events = [];

let riskHistory = [];

let lastEventTime = 0;

let frameTimer = null;

let currentSpeedKmh = 0;

// ==========================================
// GET GPS SPEED
// ==========================================

if ("geolocation" in navigator) {

    navigator.geolocation.watchPosition(

        function (position) {

            const speedMs = position.coords.speed;

            if (speedMs !== null && speedMs >= 0) {

                currentSpeedKmh = speedMs * 3.6;

                console.log(
                    "GPS Speed:",
                    currentSpeedKmh.toFixed(2),
                    "km/h"
                );

            } else {

                currentSpeedKmh = 0;

                console.log(
                    "GPS speed unavailable"
                );
            }
        },

        function (error) {

            console.error(
                "GPS error:",
                error.message
            );

            currentSpeedKmh = 0;
        },

        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 5000
        }
    );

} else {

    console.error(
        "Geolocation is not supported by this browser."
    );
}


/* =====================================================
   ELEMENT HELPER
===================================================== */

function $(id) {

    return document.getElementById(id);

}


/* =====================================================
   PAGE NAVIGATION
===================================================== */

function showPage(pageID, button) {

    document
        .querySelectorAll(".page")
        .forEach(page => {

            page.classList.remove("active");

        });


    const page = $(pageID);

    if (page) {

        page.classList.add("active");

    }


    document
        .querySelectorAll(".nav-btn")
        .forEach(btn => {

            btn.classList.remove("active");

        });


    if (button) {

        button.classList.add("active");

    }


    const titles = {

        overview: "Live Overview",

        events: "Risk Events",

        analytics: "Session Analytics",

        system: "System"

    };


    $("pageTitle").textContent =
        titles[pageID];

}


/* =====================================================
   CAMERA
===================================================== */

async function enableCamera() {

    try {

        cameraStream =
            await navigator
                .mediaDevices
                .getUserMedia({

                    video: true,

                    audio: false

                });


        $("camera").srcObject =
            cameraStream;


        document
            .querySelector(".camera")
            .classList.add("active");


        document.querySelector(
            ".camera-card .small-button"
        ).textContent =
            "Camera Enabled";

            if (frameTimer) {
    clearInterval(frameTimer);
}

frameTimer = setInterval(
    sendCameraFrame,
    1000
);


    }

    catch(error) {

        console.error(error);

        alert(
            "Camera permission denied or camera unavailable."
        );

    }

}


/* =====================================================
   SOUND
===================================================== */

function toggleSound() {

    soundEnabled =
        !soundEnabled;


    document.querySelector(
        ".icon-button"
    ).textContent =
        soundEnabled
            ? "🔊"
            : "🔇";

}

/* =====================================================
   RISK CALCULATION
===================================================== */

function calculateRisk(
    drowsiness,
    phone,
    lane,
    speed
) {

    const score =
        (0.40 * drowsiness) +
        (0.30 * phone) +
        (0.20 * lane) +
        (0.10 * speed);

    return Math.round(score);
}

/* =====================================================
   SOUND ALERT SYSTEM
===================================================== */

let audioContext = null;
let lastSoundTime = 0;
let highRiskInterval = null;
let warningAudioContext = null;


function playBeep(frequency = 800, duration = 200) {

    try {

        if (!audioContext) {
            audioContext = new AudioContext();
        }

        const oscillator =
            audioContext.createOscillator();

        const gainNode =
            audioContext.createGain();

        oscillator.frequency.value =
            frequency;

        gainNode.gain.value =
            0.15;

        oscillator.connect(gainNode);

        gainNode.connect(
            audioContext.destination
        );

        oscillator.start();

        oscillator.stop(
            audioContext.currentTime +
            duration / 1000
        );

    } catch (error) {

        console.error(
            "Sound error:",
            error
        );

    }

}


function handleRiskSound(riskScore) {

    if (!soundEnabled) {
        if (highRiskInterval) {
            clearInterval(highRiskInterval);
            highRiskInterval = null;
        }
        return;
    }

    const now = Date.now();

    
    // LOW RISK → NO SOUND
    if (riskScore <= 30) {

        if (highRiskInterval) {

            clearInterval(highRiskInterval);

            highRiskInterval = null;

        }

        return;

    }


    // MEDIUM RISK → SINGLE WARNING BEEP
    if (
        riskScore > 31 &&
        riskScore <= 60
    ) {

        if (highRiskInterval) {

            clearInterval(highRiskInterval);

            highRiskInterval = null;

        }

        if (now - lastSoundTime > 3000) {

            playBeep(800, 250);

            lastSoundTime = now;

        }

        return;

    }


    // HIGH RISK → LOUD REPEATED SOUND
    if (riskScore > 61) {

        if (!highRiskInterval) {

            playBeep(1000, 800);

            highRiskInterval = setInterval(
                () => {

                    playBeep(1000, 400);

                },
                700
            );

        }

    }

}


function createBeep(frequency, duration, volume = 0.3) {

    if (!warningAudioContext) {

        warningAudioContext =
            new (window.AudioContext ||
                window.webkitAudioContext)();
    }

    const oscillator =
        warningAudioContext.createOscillator();

    const gain =
        warningAudioContext.createGain();

    oscillator.frequency.value = frequency;

    gain.gain.value = volume;

    oscillator.connect(gain);

    gain.connect(
        warningAudioContext.destination
    );

    oscillator.start();

    gain.gain.exponentialRampToValueAtTime(
        0.001,
        warningAudioContext.currentTime +
        duration
    );

    oscillator.stop(
        warningAudioContext.currentTime +
        duration
    );
}


function playMediumWarning() {

    // अगर High Risk sound चल रहा है तो बंद करो
    stopWarningSound();

    // Single warning beep
    createBeep(600, 0.3, 0.3);
}


function playHighWarning() {

    // पहले से High Risk alarm चल रहा है
    if (highRiskInterval !== null) {
        return;
    }

    // तुरंत पहला loud beep
    createBeep(1000, 0.4, 0.6);

    // फिर repeated alarm
    highRiskInterval = setInterval(() => {

        createBeep(1000, 0.4, 0.6);

    }, 700);
}


function stopWarningSound() {

    if (highRiskInterval !== null) {

        clearInterval(highRiskInterval);

        highRiskInterval = null;
    }
}


/* =====================================================
   RISK CLASSIFICATION
===================================================== */

function getRiskLevel(score) {

    if (score >= 61) {

        return "high";

    }

    if (score >= 31) {

        return "medium";

    }

    return "low";

}


/* =====================================================
   UPDATE DASHBOARD
===================================================== */

function updateDashboard(data) {

    const drowsiness =
        clamp(data.drowsiness);

    const phone =
        clamp(data.phone);

    const lane =
        clamp(data.lane);

    const speed =
        clamp(data.speed);


    const risk =
    data.backendRisk
        ? clamp(data.backendRisk.risk_score)
        : calculateRisk(
            drowsiness,
            phone,
            lane,
            speed
        );

        handleRiskSound(risk);

    /* ===============================
       SCORE
    =============================== */

    $("riskScore").textContent =
        risk;


    /* ===============================
       METRICS
    =============================== */

    $("drowsinessValue").textContent =
        Math.round(
            drowsiness
        ) + "%";


    $("phoneValue").textContent =
        Math.round(
            phone 
        ) + "%";


    $("laneValue").textContent =
        Math.round(
            lane 
        ) + "%";


    $("speedValue").textContent =
        Math.round(
            speed 
        ) + "%";


    /* ===============================
       PROGRESS BARS
    =============================== */

    $("drowsinessBar").style.width =
        drowsiness + "%";


    $("phoneBar").style.width =
        phone + "%";


    $("laneBar").style.width =
        lane + "%";


    $("speedBar").style.width =
        speed + "%";


    /* ===============================
       STATES
    =============================== */

    $("drowsinessState").textContent =

        drowsiness >= 70
            ? "Drowsy"
            : drowsiness >= 35
                ? "Attention"
                : "Alert";


    $("phoneState").textContent =

        phone >= 50
            ? "Detected"
            : "Not detected";


    /* ===============================
       RISK LEVEL
    =============================== */

    const level =
        getRiskLevel(risk);


    const riskLevel =
        $("riskLevel");


    riskLevel.className = "";


    if (level === "low") {

        riskLevel.classList.add(
            "low-text"
        );

        riskLevel.textContent =
            "LOW RISK";

        $("riskDescription").textContent =
            "Driver state is currently stable.";

        $("recommendedAction").textContent =
            "No intervention required";

    }


    else if (level === "medium") {

        riskLevel.classList.add(
            "medium-text"
        );

        riskLevel.textContent =
            "MEDIUM RISK";

        $("riskDescription").textContent =
            "Driver attention is recommended.";

        $("recommendedAction").textContent =
            "Soft audio nudge + monitoring";

    }


    else {

        riskLevel.classList.add(
            "high-text"
        );

        riskLevel.textContent =
            "HIGH RISK";

        $("riskDescription").textContent =
            "Immediate driver intervention required.";

        $("recommendedAction").textContent =
            "Alarm + log high-risk event";

    }


    /* ===============================
       RISK CIRCLE
    =============================== */

    const degrees =
        risk * 3.6;


    let color;


    if (level === "high") {

        color =
            "var(--high)";

    }

    else if (level === "medium") {

        color =
            "var(--medium)";

    }

    else {

        color =
            "var(--low)";

    }


    $("riskCircle").style.background =

        `conic-gradient(
            ${color}
            ${degrees}deg,
            #e7edf0
            ${degrees}deg
        )`;


    /* ===============================
       WARNING
    =============================== */

    if (level === "high") {

        $("riskWarning")
            .classList.add("show");

    }

    else {

        $("riskWarning")
            .classList.remove("show");

    }


    /* ===============================
       ANALYTICS
    =============================== */

    peakRisk =
        Math.max(
            peakRisk,
            risk
        );


    $("peakRisk").textContent =
        peakRisk;


    riskHistory.push({

        time: Date.now(),

        score: risk

    });


    if (
        riskHistory.length > 60
    ) {

        riskHistory.shift();

    }


    /* ===============================
       EVENTS
    =============================== */

    createEventIfNeeded(
        level,
        risk,
        drowsiness,
        phone
    );


    drawChart();

}


/* =====================================================
   CLAMP
===================================================== */

function clamp(value) {

    value = Number(value);

    if (isNaN(value)) {
        return 0;
    }

    return Math.max(
        0,
        Math.min(
            100,
            value
        )
    );
}


/* =====================================================
   CREATE EVENTS
===================================================== */

function createEventIfNeeded(
    level,
    risk,
    drowsiness,
    phone
) {

    if (level === "low") {

        return;

    }


    const now =
        Date.now();


    if (
        now - lastEventTime <
        5000
    ) {

        return;

    }


    lastEventTime =
        now;


    let trigger;


    if (
        drowsiness >= 70
    ) {

        trigger =
            "Sustained drowsiness";

    }

    else if (
        phone >= 50
    ) {

        trigger =
            "Phone usage detected";

    }

    else {

        trigger =
            "Combined risk elevation";

    }


    const event = {

        time:
            new Date()
                .toLocaleTimeString(),

        level,

        score: risk,

        trigger,

        drowsiness:
            Math.round(
                drowsiness * 100
            ),

        phone:
            Math.round(
                phone * 100
            )

    };


    events.unshift(
        event
    );


    if (
        events.length > 30
    ) {

        events.pop();

    }


    if (
        level === "high"
    ) {

        highEvents++;

    }

    else {

        mediumEvents++;

    }


    renderEvents();

}


/* =====================================================
   RENDER EVENTS
===================================================== */

function renderEvents() {

    const stream =
        $("eventStream");


    if (
        events.length === 0
    ) {

        stream.innerHTML =
            `<div class="empty-event">
                No risk events yet.
            </div>`;

    }

    else {

        stream.innerHTML =
            events
                .slice(0,5)
                .map(event => `

                    <div class="event-row">

                        <span class="event-time">
                            ${event.time}
                        </span>

                        <span
                            class="event-badge ${event.level}">

                            ${event.level.toUpperCase()}
                            ${event.score}

                        </span>

                        <span>
                            ${event.trigger}
                        </span>

                    </div>

                `)
                .join("");

    }


    renderEventTable();

}


/* =====================================================
   EVENT TABLE
===================================================== */

function renderEventTable() {

    const table =
        $("eventTable");


    if (
        events.length === 0
    ) {

        table.innerHTML = `

            <tr>

                <td colspan="6">

                    No events recorded.

                </td>

            </tr>

        `;

        return;

    }


    table.innerHTML =

        events
            .map(event => `

                <tr>

                    <td>
                        ${event.time}
                    </td>

                    <td>

                        <span
                            class="event-badge ${event.level}">

                            ${event.level.toUpperCase()}
                            ${event.score}

                        </span>

                    </td>

                    <td>
                        ${event.trigger}
                    </td>

                    <td>
                        ${event.drowsiness}%
                    </td>

                    <td>
                        ${event.phone}%
                    </td>

                    <td>

                        ${
                            event.level === "high"
                            ? "Alarm + Log"
                            : "Soft Nudge"
                        }

                    </td>

                </tr>

            `)
            .join("");

}


/* =====================================================
   CLEAR EVENTS
===================================================== */

function clearEvents() {

    events = [];

    highEvents = 0;

    mediumEvents = 0;

    renderEvents();

}


/* =====================================================
   ANALYTICS
===================================================== */

function updateAnalytics() {

    const elapsed =
        Math.floor(
            (
                Date.now() -
                startTime
            ) / 1000
        );


    const hours =
        Math.floor(
            elapsed / 3600
        );


    const minutes =
        Math.floor(
            (elapsed % 3600) /
            60
        );


    const seconds =
        elapsed % 60;


    $("sessionTime").textContent =

        String(hours).padStart(2,"0")
        + ":"
        +
        String(minutes).padStart(2,"0")
        + ":"
        +
        String(seconds).padStart(2,"0");


    $("highEvents").textContent =
        highEvents;


    $("mediumEvents").textContent =
        mediumEvents;


    $("peakRisk").textContent =
        peakRisk;

}


/* =====================================================
   RISK GRAPH
===================================================== */

function drawChart() {

    const canvas =
        $("riskChart");


    if (!canvas) {

        return;

    }


    const ctx =
        canvas.getContext("2d");


    const width =
        canvas.clientWidth;


    const height =
        320;


    canvas.width =
        width * devicePixelRatio;


    canvas.height =
        height * devicePixelRatio;


    ctx.scale(
        devicePixelRatio,
        devicePixelRatio
    );


    ctx.clearRect(
        0,
        0,
        width,
        height
    );


    const padding =
        35;


    /* GRID */

    ctx.strokeStyle =
        "#e6ebee";

    ctx.lineWidth = 1;


    [0,25,50,75,100]
        .forEach(value => {

            const y =

                height -
                padding -
                (
                    value / 100
                ) *
                (
                    height -
                    padding * 2
                );


            ctx.beginPath();

            ctx.moveTo(
                padding,
                y
            );

            ctx.lineTo(
                width - padding,
                y
            );

            ctx.stroke();


            ctx.fillStyle =
                "#89969f";

            ctx.font =
                "10px Arial";


            ctx.fillText(
                value,
                5,
                y + 3
            );

        });


    if (
        riskHistory.length < 2
    ) {

        return;

    }


    /* LINE */

    ctx.beginPath();


    riskHistory
        .forEach(
            (point,index) => {

                const x =

                    padding +

                    (
                        index /
                        (
                            riskHistory.length - 1
                        )
                    ) *

                    (
                        width -
                        padding * 2
                    );


                const y =

                    height -
                    padding -

                    (
                        point.score /
                        100
                    ) *

                    (
                        height -
                        padding * 2
                    );


                if (index === 0) {

                    ctx.moveTo(
                        x,
                        y
                    );

                }

                else {

                    ctx.lineTo(
                        x,
                        y
                    );

                }

            }
        );


    ctx.strokeStyle =
        "#118b74";

    ctx.lineWidth = 2.5;

    ctx.stroke();

}


/* =====================================================
   DEMO MODE
===================================================== */

function generateDemoData() {

    if (liveAPI) {

        return;

    }


    const time =
        Date.now() / 1000;


    let drowsiness =

        0.12 +
        Math.sin(time / 8) *
        0.08;


    let phone = 0;


    /*
       Occasionally simulate
       phone usage.
    */

    if (
        Math.sin(time / 11) >
        0.78
    ) {

        phone = 0.72;

    }


    /*
       Occasionally simulate
       drowsiness.
    */

    if (
        Math.sin(time / 3.1) >
        0.88
    ) {

        drowsiness += 0.58;

    }


    const speed =

        0.12 +
        Math.sin(time / 13) *
        0.08;


    updateDashboard({

        drowsiness,

        phone,

        lane: 0,

        speed

    });

}


/* =====================================================
   LIVE API
===================================================== */

async function getLiveData() {

    if (!liveAPI) {
        return;
    }

    try {

        const response = await fetch(
            "http://127.0.0.1:8000/api/status",
            {
                method: "GET",
                cache: "no-store"
            }
        );

        if (!response.ok) {
            throw new Error("API unavailable");
        }

        const result = await response.json();

        console.log(
            "Live API status:",
            result
        );

    } catch (error) {

        console.log(
            "Waiting for Python API...."
        );

    }
}

/* =====================================================
   TOGGLE API
===================================================== */

function toggleAPI() {

    liveAPI =
        !liveAPI;


    if (liveAPI) {

        $("apiButton")
            .textContent =
            "Switch to Demo Mode";


        $("connectionStatus")
            .textContent =
            "Live API Mode";


        $("connectionText")
            .textContent =
            "API Is Live";


        /*
           Immediately test API.
        */

        getLiveData();

    }

    else {

        $("apiButton")
            .textContent =
            "Switch to Live API";


        $("connectionStatus")
            .textContent =
            "Demo Engine Online";


        $("connectionText")
            .textContent =
            "Local simulation active";

    }

}


/* =====================================================
   CLOCK
===================================================== */

function updateClock() {

    $("clock")
        .textContent =
        new Date()
            .toLocaleTimeString(
                [],
                {
                    hour12: false
                }
            );

}


/* =====================================================
   START
===================================================== */

setInterval(
    updateClock,
    1000
);


setInterval(
    updateAnalytics,
    1000
);


/*
   Demo data every 900ms
*/

setInterval(
    generateDemoData,
    900
);


/*
   Live API polling every 500ms
*/

setInterval(
    getLiveData,
    500
);


/* Initial */

updateClock();

updateAnalytics();

renderEvents();

generateDemoData();

drawChart();


/* Resize chart */

window.addEventListener(
    "resize",
    drawChart
);

async function sendCameraFrame() {

    if (!cameraStream) {
        console.log("Camera is not running");
        return;
    }

    const video = document.getElementById("camera");

    if (!video || video.videoWidth === 0) {
        console.log("Camera frame not ready");
        return;
    }

    const canvas = document.createElement("canvas");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");

    ctx.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
    );

    canvas.toBlob(async (blob) => {

        if (!blob) {
            console.error("Canvas blob creation failed");
            return;
        }

        const formData = new FormData();

        formData.append(
            "file",
            blob,
            "camera_frame.jpg"
        );

        formData.append(
    "speed_kmh",
    currentSpeedKmh.toFixed(2)
);

console.log(
    "Sending GPS speed:",
    currentSpeedKmh.toFixed(2),
    "km/h"
);

        try {

            const response = await fetch(
                "http://127.0.0.1:8000/api/frame",
                {
                    method: "POST",
                    body: formData
                }
            );

            console.log(
                "Frame HTTP status:",
                response.status
            );

            const text = await response.text();

            console.log(
                "Frame raw response:",
                text
            );

            try {

                const data = JSON.parse(text);

                console.log(
                    "Backend received frame:",
                    data
                );

                if (data.status === "analyzed") {

    updateDashboard({

        drowsiness: data.drowsiness,

        phone: data.phone_usage,

        lane: data.lane_departure,

        speed: data.speed_factor,

        backendRisk: data.risk

    });

    console.log(
        "Dashboard updated from backend:",
        {
            drowsiness: data.drowsiness,
            phone_usage: data.phone_usage,
            lane_departure: data.lane_departure,
            speed_factor: data.speed_factor,
            risk: data.risk
        }
    );
}

            } catch (error) {

                console.error(
                    "Response JSON parse failed:",
                    error
                );

            }

        } catch (error) {

            console.error(
                "Frame upload failed:",
                error
            );

        }

    }, "image/jpeg", 0.8);

}
/* =========================================
   DRIVER LOGIN + PROFILE SYSTEM
========================================= */

const profileButton =
    document.getElementById("profileButton");

const loginModal =
    document.getElementById("loginModal");

const closeLogin =
    document.getElementById("closeLogin");

const loginSubmit =
    document.getElementById("loginSubmit");

const profileName =
    document.getElementById("profileName");


const profileDropdown =
    document.getElementById("profileDropdown");

const dropdownName =
    document.getElementById("dropdownName");

const dropdownEmail =
    document.getElementById("dropdownEmail");

const dropdownVehicle =
    document.getElementById("dropdownVehicle");

const logoutButton =
    document.getElementById("logoutButton");


/* =========================================
   PROFILE BUTTON CLICK
========================================= */

profileButton.addEventListener(
    "click",
    () => {

        const savedDriverName =
            localStorage.getItem("driverName");


        /* NOT LOGGED IN */

        if (!savedDriverName) {

            loginModal.classList.add("active");

            return;

        }


        /* LOGGED IN */

        profileDropdown.classList.toggle("active");

    }
);


/* =========================================
   CLOSE LOGIN MODAL
========================================= */

closeLogin.addEventListener(
    "click",
    () => {

        loginModal.classList.remove("active");

    }
);


/* =========================================
   LOGIN
========================================= */

loginSubmit.addEventListener(
    "click",
    () => {

        const name =
            document
                .getElementById("driverName")
                .value
                .trim();

        const email =
            document
                .getElementById("driverEmail")
                .value
                .trim();

        const vehicle =
            document
                .getElementById("vehicleNumber")
                .value
                .trim();


        /* NAME REQUIRED */

        if (!name) {

            alert("Please enter your name");

            return;

        }


        /* SAVE DATA */

        localStorage.setItem(
            "driverName",
            name
        );

        localStorage.setItem(
            "driverEmail",
            email
        );

        localStorage.setItem(
            "driverVehicle",
            vehicle
        );


        /* UPDATE TOP PROFILE */

        profileName.textContent =
            name;


        /* UPDATE DROPDOWN */

        dropdownName.textContent =
            name;

        dropdownEmail.textContent =
            email || "Email not added";

        dropdownVehicle.textContent =
            vehicle || "Vehicle not added";


        /* CLOSE LOGIN */

        loginModal.classList.remove("active");

    }
);


/* =========================================
   LOAD SAVED PROFILE
========================================= */

function loadProfile() {

    const name =
        localStorage.getItem("driverName");

    const email =
        localStorage.getItem("driverEmail");

    const vehicle =
        localStorage.getItem("driverVehicle");


    if (name) {

        profileName.textContent =
            name;

        dropdownName.textContent =
            name;

        dropdownEmail.textContent =
            email || "Email not added";

        dropdownVehicle.textContent =
            vehicle || "Vehicle not added";

    }

}


loadProfile();


/* =========================================
   LOGOUT
========================================= */

logoutButton.addEventListener(
    "click",
    () => {

        localStorage.removeItem("driverName");

        localStorage.removeItem("driverEmail");

        localStorage.removeItem("driverVehicle");


        /* RESET PROFILE */

        profileName.textContent =
            "Login";


        /* CLOSE DROPDOWN */

        profileDropdown.classList.remove("active");

    }
);