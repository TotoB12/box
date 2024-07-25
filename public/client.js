let socket;
let localStream;
let peerConnections = {};
let peerPingTimes = {};
let pingIntervals = {};
let userName = localStorage.getItem("userName") || "";
let mySocketId = null;
let stopwatchInterval;
let connectedTime;

const joinRoomBtn = document.getElementById("joinRoom");
const settingsBtn = document.getElementById("settingsBtn");
const micSwitch = document.getElementById("micSwitch");
const updateNameBtn = document.getElementById("updateNameBtn");
const closeModalBtn = document.getElementById("closeModal");
const settingsModal = document.getElementById("settingsModal");
const currentUserNameSpan = document.getElementById("currentUserName");
const roomIdInput = document.getElementById("roomId");
const userListContainer = document.getElementById("userList");
const stopwatchElement = document.getElementById("stopwatch");

if (joinRoomBtn) {
    joinRoomBtn.addEventListener("click", joinRoom);
}

if (settingsBtn) {
    settingsBtn.addEventListener("click", openSettings);
}

if (micSwitch) {
    micSwitch.addEventListener("change", toggleMicrophone);
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
        currentUserNameSpan.textContent = userName || "Guest";
    }
}

function initializePage() {
    updateCurrentUserName();
    if (window.location.pathname.startsWith("/rooms/")) {
        const roomId = window.location.pathname.split("/").pop();
        if (/^\d{4}$/.test(roomId)) {
            initializeRoom(roomId);
        } else {
            alert("Invalid room ID. Please use a 4-digit number.");
            window.location.href = "/";
        }
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

    window.location.href = `/rooms/${roomId}`;
}

async function initializeRoom(roomId) {
    if (!userName) {
        alert("Please set your name before joining a room.");
        openSettings();
        return;
    }

    document.getElementById("roomDisplay").textContent = roomId;
    document.title = `Box - ${roomId}`;
    showLoadingAnimation();

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });
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
    } catch (error) {
        console.error("Error accessing microphone:", error);
        alert(
            "Unable to access the microphone. Please check your settings and try again.",
        );
        hideLoadingAnimation();
    }
}

function showLoadingAnimation() {
    if (userListContainer) {
        userListContainer.innerHTML = '<div class="loading-animation"></div>';
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
}

function updateUserList(users) {
    hideLoadingAnimation();
    if (!userListContainer) return;

    userListContainer.innerHTML = "";
    const otherUsers = users.filter((user) => user.id !== mySocketId);

    if (otherUsers.length === 0) {
        const noUsersMessage = document.createElement("div");
        noUsersMessage.className = "no-users-message";
        noUsersMessage.textContent = "You sure seem lonely";
        userListContainer.appendChild(noUsersMessage);
    } else {
        otherUsers.forEach((user) => {
            const userItem = document.createElement("div");
            userItem.className = "user-item";
            userItem.dataset.userId = user.id;

            const userName = document.createElement("span");
            userName.textContent = user.name;

            const networkSpeed = document.createElement("div");
            networkSpeed.className = "network-speed";
            for (let i = 0; i < 3; i++) {
                const bar = document.createElement("div");
                bar.className = "network-bar";
                networkSpeed.appendChild(bar);
            }

            userItem.appendChild(userName);
            userItem.appendChild(networkSpeed);
            userListContainer.appendChild(userItem);

            updateNetworkSpeedIndicator(user.id, peerPingTimes[user.id] || 300);
        });
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
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
    };

    localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnections[userId] = peerConnection;

    pingIntervals[userId] = measurePingTime(userId);

    return peerConnection;
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
        const networkSpeed = userItem.querySelector(".network-speed");
        const bars = networkSpeed.querySelectorAll(".network-bar");

        bars.forEach((bar, index) => {
            bar.classList.remove("active", "slow", "medium");
            if (pingTime < 100 && index < 3) {
                bar.classList.add("active");
            } else if (pingTime < 300 && index < 2) {
                bar.classList.add("active", "medium");
            } else if (pingTime >= 300 && index < 1) {
                bar.classList.add("active", "slow");
            }
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
    }
}

function updateMicIcon(isOn) {
    const micIcon = document.querySelector(".mic-icon");
    if (isOn) {
        micIcon.classList.remove("fa-microphone-slash", "mic-off");
        micIcon.classList.add("fa-microphone", "mic-on");
    } else {
        micIcon.classList.remove("fa-microphone", "mic-on");
        micIcon.classList.add("fa-microphone-slash", "mic-off");
    }
}

if (micSwitch) {
    micSwitch.addEventListener("change", function () {
        toggleMicrophone();
        updateMicIcon(this.checked);
    });
}

if (micSwitch) {
    updateMicIcon(micSwitch.checked);
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
    } else {
        alert("Please enter a valid name.");
    }
}

document.addEventListener("DOMContentLoaded", initializePage);

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
