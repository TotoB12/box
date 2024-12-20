let socket;
let localAudioStream;
let localVideoStream;
let peerConnections = {};
let userVideoStreams = {};
const cleanupFunctions = {};
let userName = localStorage.getItem("userName") || "Guest";
let mySocketId = null;
let stopwatchInterval;
let connectedTime;
let availableCameras = [];
let frontCamera;
let backCamera;
let currentCameraIndex = 0;

const joinRoomBtn = document.getElementById("joinRoom");
const settingsBtn = document.getElementById("settingsBtn");
const micSwitch = document.getElementById("micSwitch");
const videoSwitch = document.getElementById("videoSwitch");
const flipCameraBtn = document.getElementById("flipCameraBtn");
const updateNameBtn = document.getElementById("updateNameBtn");
const closeModalBtn = document.getElementById("closeModal");
const settingsModal = document.getElementById("settingsModal");
const currentUserNameSpan = document.getElementById("currentUserName");
const roomIdInput = document.getElementById("roomId");
const updateUserNameInput = document.getElementById("updateUserName");
const userListContainer = document.getElementById("userList");
const stopwatchElement = document.getElementById("stopwatch");
const roomContainer = document.querySelector(".room-container");

if (joinRoomBtn) {
    joinRoomBtn.addEventListener("click", joinRoom);
}

if (settingsBtn) {
    settingsBtn.addEventListener("click", openSettings);
}

if (micSwitch) {
    micSwitch.addEventListener("change", toggleMicrophone);
}

if (videoSwitch) {
    videoSwitch.addEventListener("change", toggleVideo);
}

if (flipCameraBtn) {
    flipCameraBtn.addEventListener("click", flipCamera);
}

if (updateNameBtn) {
    updateNameBtn.addEventListener("click", updateUserName);
}

if (closeModalBtn) {
    closeModalBtn.addEventListener("click", closeSettings);
}

if (roomIdInput) {
    roomIdInput.addEventListener("input", function (e) {
        this.value = this.value.replace(/[^0-9]/g, "").slice(0, 4);
    });
}

function updateCurrentUserName() {
    if (currentUserNameSpan) {
        currentUserNameSpan.textContent = userName;
    }
}

function initializePage() {
    updateCurrentUserName();
    if (window.location.pathname.startsWith("/room/")) {
        const roomId = window.location.pathname.split("/").pop();
        if (/^\d{4}$/.test(roomId)) {
            initializeRoom(roomId);
        } else {
            alert("Invalid room ID. Please use a 4-digit number.");
            window.location.href = "/";
        }
    }

    if (roomIdInput) {
        roomIdInput.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                joinRoom();
            }
        });
    }

    if (updateUserNameInput) {
        updateUserNameInput.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                updateUserName();
            }
        });
    }
}

function openSettings() {
    settingsModal.style.display = "block";
    document.getElementById("updateUserName").value = userName;
}

function closeSettings() {
    settingsModal.style.display = "none";
}

window.onclick = function (event) {
    if (event.target == settingsModal) {
        closeSettings();
    }
};

function joinRoom() {
    const roomId = roomIdInput.value;

    if (roomId.length !== 4) {
        alert("Please enter a valid 4-digit room code.");
        return;
    }

    if (!userName) {
        alert("Please set your name in the settings before joining a room.");
        openSettings();
        return;
    }

    window.location.href = `/room/${roomId}`;
}

async function initializeRoom(roomId) {
    if (userName === "Guest") {
        alert("Please set your name in the settings before joining a room.");
        await new Promise((resolve) => {
            openSettings();
            const nameUpdateListener = function () {
                updateUserName();
                updateNameBtn.removeEventListener("click", nameUpdateListener);
                closeSettings();
                resolve();
            };
            updateNameBtn.addEventListener("click", nameUpdateListener);
        });
    }

    document.getElementById("roomDisplay").textContent = roomId;
    document.title = `Box - ${roomId}`;
    showLoadingAnimation();

    try {
        socket = io("https://api.totob12.com", { path: "/box/socket.io" });

        socket.on("connect", () => {
            mySocketId = socket.id;
            socket.emit("join-room", { roomId, userName });
            startStopwatch();
            startHeartbeat();
        });

        socket.on("user-connected", handleUserConnected);
        socket.on("user-disconnected", handleUserDisconnected);
        socket.on("update-user-list", updateUserList);
        socket.on("offer", handleOffer);
        socket.on("answer", handleAnswer);
        socket.on("ice-candidate", handleNewICECandidateMsg);
        socket.on("heartbeat", handleHeartbeat);
        socket.on("update-ping", handleUpdatePing);

        updateToggleStates();

        await initializeVideoDevices();

        const controlsContainer = document.createElement("div");
        controlsContainer.className = "room-controls";
        controlsContainer.appendChild(document.querySelector(".user-controls"));
        document.body.appendChild(controlsContainer);
    } catch (error) {
        console.error("Error initializing room:", error);
        alert(
            "Unable to initialize the room. Please check your settings and try again.",
        );
        hideLoadingAnimation();
    }
}

async function getAudioStream() {
    if (localAudioStream) {
        localAudioStream.getTracks().forEach((track) => track.stop());
    }
    localAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
    });
    return localAudioStream;
}

async function getVideoStream() {
    if (localVideoStream) {
        localVideoStream.getTracks().forEach((track) => track.stop());
    }
    const videoConstraints = { video: true };
    if (availableCameras.length > 0) {
        videoConstraints.video = {
            deviceId: availableCameras[currentCameraIndex].deviceId,
        };
    }
    localVideoStream =
        await navigator.mediaDevices.getUserMedia(videoConstraints);
    return localVideoStream;
}

function createEmptyAudioStream() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const dst = oscillator.connect(ctx.createMediaStreamDestination());
    oscillator.start();
    const track = dst.stream.getAudioTracks()[0];
    track.enabled = false;
    return new MediaStream([track]);
}

function createEmptyVideoStream() {
    const canvas = Object.assign(document.createElement("canvas"), {
        width: 640,
        height: 480,
    });
    canvas.getContext("2d").fillRect(0, 0, canvas.width, canvas.height);
    const stream = canvas.captureStream();
    stream.getVideoTracks()[0].enabled = false;
    return stream;
}

async function initializeVideoDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        availableCameras = devices.filter(
            (device) => device.kind === "videoinput",
        );

        frontCamera = availableCameras.find((device) =>
            device.label.toLowerCase().includes("front"),
        );
        backCamera = availableCameras.find((device) =>
            device.label.toLowerCase().includes("back"),
        );

        if (frontCamera && backCamera) {
            console.log("Front and back cameras identified");
        } else {
            console.log(
                "Unable to identify front and back cameras, will cycle through all cameras",
            );
        }

        updateFlipCameraButtonVisibility();
    } catch (error) {
        console.error("Error initializing video devices:", error);
    }
}

function updateFlipCameraButtonVisibility() {
    if (flipCameraBtn) {
        if (availableCameras.length > 1 && videoSwitch.checked) {
            flipCameraBtn.classList.add("visible");
        } else {
            flipCameraBtn.classList.remove("visible");
        }
    }
}

async function flipCamera() {
    if (availableCameras.length < 2 || !videoSwitch.checked) return;

    if (frontCamera && backCamera) {
        currentCameraIndex =
            currentCameraIndex === availableCameras.indexOf(frontCamera)
                ? availableCameras.indexOf(backCamera)
                : availableCameras.indexOf(frontCamera);
    } else {
        currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
    }

    try {
        const newVideoStream = await getVideoStream();
        const [newVideoTrack] = newVideoStream.getVideoTracks();

        Object.values(peerConnections).forEach((pc) => {
            const sender = pc
                .getSenders()
                .find((s) => s.track && s.track.kind === "video");
            if (sender) {
                sender.replaceTrack(newVideoTrack);
            }
        });

        toggleLocalVideoPreview(true);
        socket.emit("camera-changed");
    } catch (error) {
        console.error("Error flipping camera:", error);
        alert("Failed to switch camera. Please try again.");
    }
}

function showLoadingAnimation() {
    if (userListContainer) {
        userListContainer.innerHTML = `
            <div class="hexagon-loader">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
            </div>
        `;
    }
}

function hideLoadingAnimation() {
    if (userListContainer) {
        userListContainer.innerHTML = "";
    }
}

function handleUserConnected(user) {
    console.log("User connected:", user);
    if (user.id !== mySocketId) {
        createPeerConnection(user.id);
        callUser(user.id);
    }
}

function handleUserDisconnected(userId) {
    console.log("User disconnected:", userId);
    if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
    }
    if (cleanupFunctions[userId]) {
        cleanupFunctions[userId]();
        delete cleanupFunctions[userId];
    }
    if (userVideoStreams[userId]) {
        delete userVideoStreams[userId];
    }
    hideTalkingIndicator(userId);
}

function updateUserList(users) {
    hideLoadingAnimation();
    if (!userListContainer) return;

    const currentUserIds = new Set(
        Array.from(userListContainer.children).map((el) => el.dataset.userId),
    );
    const newUserIds = new Set(users.map((user) => user.id));

    currentUserIds.forEach((userId) => {
        if (!newUserIds.has(userId)) {
            removeUser(userId);
        }
    });

    users.forEach((user) => {
        if (user.id !== mySocketId) {
            if (currentUserIds.has(user.id)) {
                updateUser(user);
            } else {
                addUser(user);
            }
        }
    });

    updateUserListLayout(users.length - 1);
    updateEmptyRoomMessage();
}

function updateUserListLayout(userCount) {
    if (!userListContainer) return;

    userListContainer.className = "user-list";

    if (userCount === 0) {
        userListContainer.classList.add("empty-room");
    } else if (userCount === 1) {
        userListContainer.classList.add("single-user");
    } else if (userCount === 2) {
        userListContainer.classList.add("two-users");
    }
}

function updateUser(user) {
    const userItem = document.querySelector(
        `.user-item[data-user-id="${user.id}"]`,
    );
    if (userItem) {
        const nameElement = userItem.querySelector(".user-list-name");
        const micIcon = userItem.querySelector(".mic-icon");
        const videoIcon = userItem.querySelector(".video-icon");
        const videoContainer = userItem.querySelector(".video-container");

        if (nameElement.textContent !== user.name) {
            nameElement.textContent = user.name;
        }

        const isMuted = micIcon.classList.contains("fa-microphone-slash");
        if (isMuted !== user.muted) {
            micIcon.classList.toggle("fa-microphone-slash", user.muted);
            micIcon.classList.toggle("fa-microphone", !user.muted);
            micIcon.classList.toggle("mic-off", user.muted);
            micIcon.classList.toggle("mic-on", !user.muted);
        }

        const isVideoOff = videoIcon.classList.contains("fa-video-slash");
        if (isVideoOff !== user.videoOff) {
            videoIcon.classList.toggle("fa-video-slash", user.videoOff);
            videoIcon.classList.toggle("fa-video", !user.videoOff);
            videoIcon.classList.toggle("video-off", user.videoOff);
            videoIcon.classList.toggle("video-on", !user.videoOff);
            toggleVideoPlaceholder(videoContainer, user.videoOff);
        }

        if (userVideoStreams[user.id]) {
            attachVideoStream(user.id, userVideoStreams[user.id]);
        }
    }
}

function addUser(user) {
    const userItem = document.createElement("div");
    userItem.className = "user-item";
    userItem.dataset.userId = user.id;

    userItem.innerHTML = `
        <button class="menu-btn" aria-label="User Options">
            <i class="fas fa-ellipsis-v"></i>
        </button>
        <div class="dropdown-menu">
            <label class="dropdown-item">
                Captions
                <input type="checkbox" class="toggle-input captions-toggle" data-user-id="${user.id}" />
                <span class="toggle-slider"></span>
            </label>
            <label class="dropdown-item">
                Show Ping
                <input type="checkbox" class="toggle-input ping-toggle" data-user-id="${user.id}" />
                <span class="toggle-slider"></span>
            </label>
            <button class="fullscreen-btn dropdown-item" data-user-id="${user.id}">
                <i class="fas fa-expand"></i> Fullscreen
            </button>
        </div>
        <div class="video-container" id="video-${user.id}"></div>
        <div class="status-bar">
            <div class="left-container">
                <i class="fas mic-icon fa-microphone${user.muted ? "-slash mic-off" : " mic-on"}"></i>
                <i class="fas video-icon fa-video${user.videoOff ? "-slash video-off" : " video-on"}"></i>
                <span class="user-list-name">${user.name}</span>
            </div>
            <div class="right-container">
                <span class="ping-indicator" data-user-id="${user.id}" style="display:none;">0</span>
                <div class="network-speed">
                    <div class="network-bar"></div>
                    <div class="network-bar"></div>
                    <div class="network-bar"></div>
                </div>
            </div>
        </div>
    `;

    userListContainer.appendChild(userItem);

    const videoContainer = userItem.querySelector(".video-container");
    toggleVideoPlaceholder(videoContainer, user.videoOff);

    if (userVideoStreams[user.id]) {
        attachVideoStream(user.id, userVideoStreams[user.id]);
    }

    const menuBtn = userItem.querySelector(".menu-btn");
    const dropdownMenu = userItem.querySelector(".dropdown-menu");

    menuBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        dropdownMenu.classList.toggle("open");
        menuBtn.classList.toggle("menu-btn-active");
    });

    dropdownMenu.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    document.addEventListener("click", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    function handleClickOutside(event) {
        if (
            !dropdownMenu.contains(event.target) &&
            !menuBtn.contains(event.target) &&
            dropdownMenu.classList.contains("open")
        ) {
            dropdownMenu.classList.remove("open");
            menuBtn.classList.remove("menu-btn-active");
        }
    }

    const captionsToggle = userItem.querySelector(".captions-toggle");
    captionsToggle.addEventListener("change", () => {
        const userId = captionsToggle.dataset.userId;
        const isChecked = captionsToggle.checked;
        toggleCaptions(userId, isChecked);
    });

    const pingToggle = userItem.querySelector(".ping-toggle");
    pingToggle.addEventListener("change", () => {
        const userId = pingToggle.dataset.userId;
        const isChecked = pingToggle.checked;
        togglePingDisplay(userId, isChecked);
    });

    const fullscreenBtn = userItem.querySelector(".fullscreen-btn");
    fullscreenBtn.addEventListener("click", () => {
        toggleFullscreen(videoContainer);
    });
}

function toggleCaptions(userId, isEnabled) {
    console.log(
        `Captions for user ${userId} are now ${isEnabled ? "enabled" : "disabled"}.`,
    );
}

function toggleFullscreen(element) {
    if (!document.fullscreenElement) {
        element.requestFullscreen().catch((err) => {
            console.error(
                `Error attempting to enable fullscreen mode: ${err.message} (${err.name})`,
            );
        });
    } else {
        document.exitFullscreen();
    }
}

function toggleVideoPlaceholder(videoContainer, isVideoOff) {
    if (isVideoOff) {
        let placeholder = videoContainer.querySelector(
            ".video-off-placeholder",
        );
        if (!placeholder) {
            placeholder = document.createElement("div");
            placeholder.className = "video-off-placeholder";
            placeholder.innerHTML = '<i class="fas fa-user user-icon"></i>';
            videoContainer.appendChild(placeholder);
        }
        const videoElement = videoContainer.querySelector("video");
        if (videoElement) {
            videoElement.style.display = "none";
        }
        placeholder.style.display = "flex";
    } else {
        const placeholder = videoContainer.querySelector(
            ".video-off-placeholder",
        );
        if (placeholder) {
            placeholder.style.display = "none";
        }
        const videoElement = videoContainer.querySelector("video");
        if (videoElement) {
            videoElement.style.display = "block";
        }
    }
}

function removeUser(userId) {
    const userItem = document.querySelector(
        `.user-item[data-user-id="${userId}"]`,
    );
    if (userItem) {
        userItem.remove();
    }
    handleUserDisconnected(userId);
}

function updateEmptyRoomMessage() {
    const noUsersMessage = userListContainer.querySelector(".no-users-message");
    const hasUsers = userListContainer.querySelector(".user-item");

    if (!hasUsers && !noUsersMessage) {
        const message = document.createElement("div");
        message.className = "no-users-message";
        message.textContent = "You sure seem lonely...";
        userListContainer.appendChild(message);
    } else if (hasUsers && noUsersMessage) {
        noUsersMessage.remove();
    }
}

function createPeerConnection(userId) {
    const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("ice-candidate", {
                target: userId,
                candidate: event.candidate,
            });
        }
    };

    peerConnection.ontrack = (event) => {
        if (event.track.kind === "audio") {
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.play();
            cleanupFunctions[userId] = detectTalking(userId, event.streams[0]);
        } else if (event.track.kind === "video") {
            userVideoStreams[userId] = event.streams[0];
            attachVideoStream(userId, event.streams[0]);
        }
    };

    peerConnection.addTrack(
        createEmptyAudioStream().getAudioTracks()[0],
        new MediaStream(),
    );
    peerConnection.addTrack(
        createEmptyVideoStream().getVideoTracks()[0],
        new MediaStream(),
    );

    peerConnections[userId] = peerConnection;

    return peerConnection;
}

function attachVideoStream(userId, stream) {
    const videoContainer = document.getElementById(`video-${userId}`);
    if (videoContainer) {
        let videoElement = videoContainer.querySelector("video");
        if (!videoElement) {
            videoElement = document.createElement("video");
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            videoContainer.appendChild(videoElement);
        }
        videoElement.srcObject = stream;

        const userItem = videoContainer.closest(".user-item");
        const videoIcon = userItem.querySelector(".video-icon");
        const isVideoOff = videoIcon.classList.contains("fa-video-slash");
        toggleVideoPlaceholder(videoContainer, isVideoOff);
    }
}

function detectTalking(userId, stream) {
    const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;

    microphone.connect(analyser);
    analyser.connect(javascriptNode);
    javascriptNode.connect(audioContext.destination);

    const checkTalking = () => {
        const array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        const average = array.reduce((a, b) => a + b) / array.length;

        const talkingThreshold = 10;
        if (average > talkingThreshold) {
            showTalkingIndicator(userId);
        } else {
            hideTalkingIndicator(userId);
        }
    };

    javascriptNode.onaudioprocess = checkTalking;

    return () => {
        javascriptNode.disconnect();
        microphone.disconnect();
        analyser.disconnect();
        audioContext.close();
    };
}

function showTalkingIndicator(userId) {
    const userItem = document.querySelector(
        `.user-item[data-user-id="${userId}"]`,
    );
    if (userItem && !userItem.querySelector(".talking-indicator")) {
        const icon = document.createElement("i");
        icon.className = "fas fa-volume-up talking-indicator";
        userItem.querySelector(".left-container").appendChild(icon);
    }
}

function hideTalkingIndicator(userId) {
    const userItem = document.querySelector(
        `.user-item[data-user-id="${userId}"]`,
    );
    if (userItem) {
        const talkingIndicator = userItem.querySelector(".talking-indicator");
        if (talkingIndicator) {
            talkingIndicator.remove();
        }
    }
}

function togglePingDisplay(userId, showPing) {
    const pingIndicator = document.querySelector(
        `.ping-indicator[data-user-id="${userId}"]`,
    );
    if (pingIndicator) {
        pingIndicator.style.display = showPing ? "inline" : "none";
    }
}

function updateNetworkSpeedIndicator(userId, pingTime) {
    const userItem = document.querySelector(
        `.user-item[data-user-id="${userId}"]`,
    );
    if (userItem) {
        const bars = userItem.querySelectorAll(".network-bar");
        const activeBarCount = pingTime < 100 ? 3 : pingTime < 300 ? 2 : 1;
        const barClass =
            pingTime < 100
                ? "active"
                : pingTime < 300
                  ? "active medium"
                  : "active slow";

        bars.forEach((bar, index) => {
            bar.className = `network-bar ${index < activeBarCount ? barClass : ""}`;
        });
    }
}

async function callUser(userId) {
    const peerConnection = peerConnections[userId];
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer", {
        target: userId,
        sdp: peerConnection.localDescription,
    });
}

async function handleOffer(data) {
    const peerConnection = createPeerConnection(data.sender);
    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(data.sdp),
    );
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("answer", {
        target: data.sender,
        sdp: peerConnection.localDescription,
    });
}

async function handleAnswer(data) {
    const peerConnection = peerConnections[data.sender];
    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(data.sdp),
    );
}

function handleNewICECandidateMsg(data) {
    const peerConnection = peerConnections[data.sender];
    peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
}

async function toggleMicrophone() {
    const isAudioOn = micSwitch.checked;
    let audioTrack;

    if (isAudioOn) {
        try {
            const audioStream = await getAudioStream();
            audioTrack = audioStream.getAudioTracks()[0];
        } catch (error) {
            console.error("Error accessing microphone:", error);
            micSwitch.checked = false;
            updateMicIcon(false);
            alert(
                "Unable to access the microphone. Please check your settings and try again.",
            );
            return;
        }
    } else {
        if (localAudioStream) {
            localAudioStream.getTracks().forEach((track) => track.stop());
            localAudioStream = null;
        }
        audioTrack = createEmptyAudioStream().getAudioTracks()[0];
    }

    Object.values(peerConnections).forEach((pc) => {
        const sender = pc
            .getSenders()
            .find((s) => s.track && s.track.kind === "audio");
        if (sender) {
            sender.replaceTrack(audioTrack);
        }
    });

    if (socket) {
        socket.emit("mute-status", !isAudioOn);
    }
    updateMicIcon(isAudioOn);
}

async function toggleVideo() {
    const isVideoOn = videoSwitch.checked;
    let videoTrack;

    if (isVideoOn) {
        try {
            const videoStream = await getVideoStream();
            videoTrack = videoStream.getVideoTracks()[0];

            await initializeVideoDevices();
        } catch (error) {
            console.error("Error accessing camera:", error);
            videoSwitch.checked = false;
            updateVideoIcon(false);
            alert(
                "Unable to access the camera. Please check your settings and try again.",
            );
            return;
        }
    } else {
        if (localVideoStream) {
            localVideoStream.getTracks().forEach((track) => track.stop());
            localVideoStream = null;
        }
        videoTrack = createEmptyVideoStream().getVideoTracks()[0];
    }

    Object.values(peerConnections).forEach((pc) => {
        const sender = pc
            .getSenders()
            .find((s) => s.track && s.track.kind === "video");
        if (sender) {
            sender.replaceTrack(videoTrack);
        }
    });

    if (socket) {
        socket.emit("video-status", !isVideoOn);
    }
    updateVideoIcon(isVideoOn);
    toggleLocalVideoPreview(isVideoOn);
    updateFlipCameraButtonVisibility();
}

function updateToggleStates() {
    toggleMicrophone();
    toggleVideo();
}

function updateMicIcon(isOn) {
    const micIcon = document.querySelector("#micToggle .mic-icon");
    if (micIcon) {
        if (isOn) {
            micIcon.classList.remove("fa-microphone-slash", "mic-off");
            micIcon.classList.add("fa-microphone", "mic-on");
        } else {
            micIcon.classList.remove("fa-microphone", "mic-on");
            micIcon.classList.add("fa-microphone-slash", "mic-off");
        }
    }
}

function updateVideoIcon(isOn) {
    const videoIcon = document.querySelector("#videoToggle .video-icon");
    if (videoIcon) {
        if (isOn) {
            videoIcon.classList.remove("fa-video-slash", "video-off");
            videoIcon.classList.add("fa-video", "video-on");
        } else {
            videoIcon.classList.remove("fa-video", "video-on");
            videoIcon.classList.add("fa-video-slash", "video-off");
        }
    }
}

function toggleLocalVideoPreview(isOn) {
    const localVideoPreview = document.getElementById("localVideoPreview");
    if (localVideoPreview) {
        if (isOn && localVideoStream) {
            localVideoPreview.srcObject = localVideoStream;
            localVideoPreview.style.display = "block";
        } else {
            localVideoPreview.srcObject = null;
            localVideoPreview.style.display = "none";
        }
    }
}

if (micSwitch) {
    updateMicIcon(micSwitch.checked);
}

if (videoSwitch) {
    updateVideoIcon(videoSwitch.checked);
}

function updateUserName() {
    const newName = document.getElementById("updateUserName").value.trim();
    if (newName && newName !== userName) {
        userName = newName;
        localStorage.setItem("userName", userName);
        updateCurrentUserName();
        if (socket) {
            socket.emit("update-user-name", newName);
        }
        closeSettings();
    } else if (!newName) {
        userName = `Guest`;
        localStorage.setItem("userName", userName);
        updateCurrentUserName();
        if (socket) {
            socket.emit("update-user-name", userName);
        }
        closeSettings();
    } else {
        closeSettings();
    }
}

function startStopwatch() {
    connectedTime = new Date();
    stopwatchInterval = setInterval(updateStopwatch, 1000);
}

function updateStopwatch() {
    const now = new Date();
    const elapsedTime = Math.floor((now - connectedTime) / 1000);
    const hours = String(Math.floor(elapsedTime / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((elapsedTime % 3600) / 60)).padStart(
        2,
        "0",
    );
    const seconds = String(elapsedTime % 60).padStart(2, "0");
    stopwatchElement.textContent = `${hours}:${minutes}:${seconds}`;
}

function startHeartbeat() {
    setInterval(() => {
        if (socket) {
            socket.emit("heartbeat", Date.now());
        }
    }, 1000);
}

function handleHeartbeat({ senderId, timestamp }) {
    const receiveTime = Date.now();
    const roundTripTime = receiveTime - timestamp;
    socket.emit("heartbeat-ack", { targetId: senderId, roundTripTime });
}

function handleUpdatePing({ senderId, pingTime }) {
    updateNetworkSpeedIndicator(senderId, pingTime);

    const pingIndicator = document.querySelector(
        `.ping-indicator[data-user-id="${senderId}"]`,
    );
    if (pingIndicator && pingIndicator.style.display === "inline") {
        pingIndicator.textContent = `${pingTime}`;
    }
}

document.addEventListener("DOMContentLoaded", initializePage);
