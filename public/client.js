let socket;
let localStream;
let localVideoStream;
let peerConnections = {};
let peerPingTimes = {};
let pingIntervals = {};
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
    micSwitch.addEventListener("change", function () {
        toggleMicrophone();
        updateMicIcon(this.checked);
    });
}

if (videoSwitch) {
    videoSwitch.addEventListener("change", function () {
        toggleVideo();
        updateVideoIcon(this.checked);
        toggleLocalVideoPreview(this.checked);
    });
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
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });
        await initializeVideoDevices();
        socket = io();

        socket.on("connect", () => {
            mySocketId = socket.id;
            socket.emit("join-room", { roomId, userName });
            startStopwatch();
        });

        socket.on("user-connected", handleUserConnected);
        socket.on("user-disconnected", handleUserDisconnected);
        socket.on("update-user-list", updateUserList);
        socket.on("offer", handleOffer);
        socket.on("answer", handleAnswer);
        socket.on("ice-candidate", handleNewICECandidateMsg);

        toggleMicrophone();
        toggleVideo();
        toggleLocalVideoPreview(videoSwitch.checked);

        const controlsContainer = document.createElement("div");
        controlsContainer.className = "room-controls";
        controlsContainer.appendChild(document.querySelector(".user-controls"));
        document.body.appendChild(controlsContainer);
    } catch (error) {
        console.error("Error accessing media devices:", error);
        alert(
            "Unable to access the microphone or camera. Please check your settings and try again.",
        );
        hideLoadingAnimation();
    }
}

async function initializeVideoDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        availableCameras = devices.filter(device => device.kind === 'videoinput');

        frontCamera = availableCameras.find(device => device.label.toLowerCase().includes('front'));
        backCamera = availableCameras.find(device => device.label.toLowerCase().includes('back'));

        if (frontCamera && backCamera) {
            console.log('Front and back cameras identified');
        } else {
            console.log('Unable to identify front and back cameras, will cycle through all cameras');
        }

        if (availableCameras.length > 0) {
            localVideoStream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: availableCameras[0].deviceId }
            });
        } else {
            console.warn('No video input devices found');
            localVideoStream = new MediaStream();
        }

        updateFlipCameraButtonVisibility();
    } catch (error) {
        console.error('Error initializing video devices:', error);
        localVideoStream = new MediaStream();
    }
}

function updateFlipCameraButtonVisibility() {
    if (flipCameraBtn) {
        if (availableCameras.length > 1 && videoSwitch.checked) {
            flipCameraBtn.classList.add('visible');
        } else {
            flipCameraBtn.classList.remove('visible');
        }
    }
}

async function flipCamera() {
    if (availableCameras.length < 2) return;

    if (frontCamera && backCamera) {
        currentCameraIndex = (currentCameraIndex === availableCameras.indexOf(frontCamera)) 
            ? availableCameras.indexOf(backCamera) 
            : availableCameras.indexOf(frontCamera);
    } else {
        currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
    }

    const newCameraId = availableCameras[currentCameraIndex].deviceId;

    try {
        const newVideoStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: newCameraId }
        });

        localVideoStream.getVideoTracks().forEach(track => track.stop());

        const [newVideoTrack] = newVideoStream.getVideoTracks();
        localVideoStream.removeTrack(localVideoStream.getVideoTracks()[0]);
        localVideoStream.addTrack(newVideoTrack);

        toggleLocalVideoPreview(videoSwitch.checked);

        Object.values(peerConnections).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                sender.replaceTrack(newVideoTrack);
            }
        });

        socket.emit('camera-changed');
    } catch (error) {
        console.error('Error flipping camera:', error);
        alert('Failed to switch camera. Please try again.');
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
    if (pingIntervals[userId]) {
        clearInterval(pingIntervals[userId]);
        delete pingIntervals[userId];
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
        <div class="video-container" id="video-${user.id}"></div>
        <div class="status-bar">
            <div class="left-container">
                <i class="fas mic-icon fa-microphone${user.muted ? "-slash mic-off" : " mic-on"}"></i>
                <i class="fas video-icon fa-video${user.videoOff ? "-slash video-off" : " video-on"}"></i>
                <span class="user-list-name">${user.name}</span>
            </div>
            <div class="right-container">
                <div class="network-speed">
                    <div class="network-bar"></div>
                    <div class="network-bar"></div>
                    <div class="network-bar"></div>
                </div>
            </div>
        </div>
    `;

    userListContainer.appendChild(userItem);
    updateNetworkSpeedIndicator(user.id, peerPingTimes[user.id] || 300);

    const videoContainer = userItem.querySelector(".video-container");
    toggleVideoPlaceholder(videoContainer, user.videoOff);

    if (userVideoStreams[user.id]) {
        attachVideoStream(user.id, userVideoStreams[user.id]);
    }
}

function toggleVideoPlaceholder(videoContainer, isVideoOff) {
    if (isVideoOff) {
        let placeholder = videoContainer.querySelector(".video-off-placeholder");
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
        const placeholder = videoContainer.querySelector(".video-off-placeholder");
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

    localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
    });

    localVideoStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localVideoStream);
    });

    peerConnections[userId] = peerConnection;

    pingIntervals[userId] = measurePingTime(userId);

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

        const userItem = videoContainer.closest('.user-item');
        const videoIcon = userItem.querySelector('.video-icon');
        const isVideoOff = videoIcon.classList.contains('fa-video-slash');
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

function measurePingTime(userId) {
    const intervalId = setInterval(() => {
        if (peerConnections[userId]) {
            const start = Date.now();
            peerConnections[userId]
                .getStats()
                .then(() => {
                    const pingTime = Date.now() - start;
                    peerPingTimes[userId] = pingTime;
                    updateNetworkSpeedIndicator(userId, pingTime);
                })
                .catch((error) => {
                    console.error("Error measuring ping time:", error);
                    clearInterval(intervalId);
                });
        } else {
            console.log(
                `Peer connection for user ${userId} no longer exists. Stopping ping measurements.`,
            );
            clearInterval(intervalId);
        }
    }, 5000);

    return intervalId;
}

function updateNetworkSpeedIndicator(userId, pingTime) {
    console.log(pingTime);
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

function toggleMicrophone() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = micSwitch.checked;
        if (socket) {
            socket.emit("mute-status", !audioTrack.enabled);
        }
    }
}

function toggleVideo() {
    if (localVideoStream) {
        const videoTrack = localVideoStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = videoSwitch.checked;
            updateVideoIcon(videoTrack.enabled);
            updateFlipCameraButtonVisibility();
            if (socket) {
                socket.emit("video-status", !videoTrack.enabled);
            }
        }
    }
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
        if (isOn) {
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

document.addEventListener("DOMContentLoaded", initializePage);
