let socket;
let localStream;
let peerConnections = {};
let userName = localStorage.getItem('userName') || '';
let mySocketId = null;
let stopwatchInterval;
let connectedTime;

const joinRoomBtn = document.getElementById('joinRoom');
const settingsBtn = document.getElementById('settingsBtn');
const micSwitch = document.getElementById('micSwitch');
const updateNameBtn = document.getElementById('updateNameBtn');
const closeModalBtn = document.getElementById('closeModal');
const settingsModal = document.getElementById('settingsModal');
const currentUserNameSpan = document.getElementById('currentUserName');
const roomIdInput = document.getElementById('roomId');
const userListContainer = document.getElementById('userList');
const stopwatchElement = document.getElementById('stopwatch');

if (joinRoomBtn) {
    joinRoomBtn.addEventListener('click', joinRoom);
}

if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettings);
}

if (micSwitch) {
    micSwitch.addEventListener('change', toggleMicrophone);
}

if (updateNameBtn) {
    updateNameBtn.addEventListener('click', updateUserName);
}

if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeSettings);
}

if (roomIdInput) {
    roomIdInput.addEventListener('input', function(e) {
        this.value = this.value.replace(/[^0-9]/g, '').slice(0, 4);
    });
}

function updateCurrentUserName() {
    if (currentUserNameSpan) {
        currentUserNameSpan.textContent = userName || 'Guest';
    }
}

function initializePage() {
    updateCurrentUserName();
    if (window.location.pathname.startsWith('/rooms/')) {
        const roomId = window.location.pathname.split('/').pop();
        if (/^\d{4}$/.test(roomId)) {
            initializeRoom(roomId);
        } else {
            alert('Invalid room ID. Please use a 4-digit number.');
            window.location.href = '/';
        }
    }
}

function openSettings() {
    settingsModal.style.display = 'block';
    document.getElementById('updateUserName').value = userName;
}

function closeSettings() {
    settingsModal.style.display = 'none';
}

window.onclick = function(event) {
    if (event.target == settingsModal) {
        closeSettings();
    }
}

function joinRoom() {
    const roomId = roomIdInput.value;

    if (roomId.length !== 4) {
        alert('Please enter a valid 4-digit room code.');
        return;
    }

    if (!userName) {
        alert('Please set your name in the settings before joining a room.');
        openSettings();
        return;
    }

    window.location.href = `/rooms/${roomId}`;
}

async function initializeRoom(roomId) {
    if (!userName) {
        alert('Please set your name before joining a room.');
        openSettings();
        return;
    }

    document.getElementById('roomDisplay').textContent = roomId;
    document.title = `Box - ${roomId}`; // Set the room page title
    showLoadingAnimation();

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        socket = io();

        socket.on('connect', () => {
            mySocketId = socket.id;
            socket.emit('join-room', { roomId, userName });
            startStopwatch();
        });

        socket.on('user-connected', handleUserConnected);
        socket.on('user-disconnected', handleUserDisconnected);
        socket.on('update-user-list', updateUserList);
        socket.on('offer', handleOffer);
        socket.on('answer', handleAnswer);
        socket.on('ice-candidate', handleNewICECandidateMsg);

        toggleMicrophone();

    } catch (error) {
        console.error('Error accessing microphone:', error);
        alert('Unable to access the microphone. Please check your settings and try again.');
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
        userListContainer.innerHTML = '';
    }
}

function handleUserConnected(user) {
    console.log('User connected:', user);
    if (user.id !== mySocketId) {
        createPeerConnection(user.id);
        callUser(user.id);
    }
}

function handleUserDisconnected(userId) {
    console.log('User disconnected:', userId);
    if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
    }
}

function updateUserList(users) {
    hideLoadingAnimation();
    if (!userListContainer) return;

    userListContainer.innerHTML = '';
    const otherUsers = users.filter(user => user.id !== mySocketId);

    if (otherUsers.length === 0) {
        const noUsersMessage = document.createElement('div');
        noUsersMessage.className = 'no-users-message';
        noUsersMessage.textContent = 'You sure seem lonely';
        userListContainer.appendChild(noUsersMessage);
    } else {
        otherUsers.forEach(user => {
            const userItem = document.createElement('div');
            userItem.className = 'user-item';
            userItem.textContent = user.name;
            userListContainer.appendChild(userItem);
        });
    }
}

function createPeerConnection(userId) {
    const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: userId,
                candidate: event.candidate
            });
        }
    };

    peerConnection.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
    };

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnections[userId] = peerConnection;
    return peerConnection;
}

async function callUser(userId) {
    const peerConnection = peerConnections[userId];
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', {
        target: userId,
        sdp: peerConnection.localDescription
    });
}

async function handleOffer(data) {
    const peerConnection = createPeerConnection(data.sender);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', {
        target: data.sender,
        sdp: peerConnection.localDescription
    });
}

async function handleAnswer(data) {
    const peerConnection = peerConnections[data.sender];
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
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
    const micIcon = document.querySelector('.mic-icon');
    if (isOn) {
        micIcon.classList.remove('fa-microphone-slash', 'mic-off');
        micIcon.classList.add('fa-microphone', 'mic-on');
    } else {
        micIcon.classList.remove('fa-microphone', 'mic-on');
        micIcon.classList.add('fa-microphone-slash', 'mic-off');
    }
}

// Event listener for microphone toggle
if (micSwitch) {
    micSwitch.addEventListener('change', function() {
        toggleMicrophone();
        updateMicIcon(this.checked);
    });
}

// Initial icon state
if (micSwitch) {
    updateMicIcon(micSwitch.checked);
}

function updateUserName() {
    const newName = document.getElementById('updateUserName').value.trim();
    if (newName && newName !== userName) {
        userName = newName;
        localStorage.setItem('userName', userName);
        updateCurrentUserName();
        if (socket) {
            socket.emit('update-user-name', newName);
        }
        closeSettings();
    } else {
        alert('Please enter a valid name.');
    }
}

document.addEventListener('DOMContentLoaded', initializePage);

function startStopwatch() {
    connectedTime = new Date();
    stopwatchInterval = setInterval(updateStopwatch, 1000);
}

function updateStopwatch() {
    const now = new Date();
    const elapsedTime = Math.floor((now - connectedTime) / 1000);
    const hours = String(Math.floor(elapsedTime / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((elapsedTime % 3600) / 60)).padStart(2, '0');
    const seconds = String(elapsedTime % 60).padStart(2, '0');
    stopwatchElement.textContent = `${hours}:${minutes}:${seconds}`;
}
