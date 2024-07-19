let socket;
let localStream;
let peerConnections = {};
let userName = localStorage.getItem('userName') || '';

const joinRoomBtn = document.getElementById('joinRoom');
const settingsBtn = document.getElementById('settingsBtn');
const micSwitch = document.getElementById('micSwitch');
const updateNameBtn = document.getElementById('updateNameBtn');
const closeModalBtn = document.getElementById('closeModal');
const settingsModal = document.getElementById('settingsModal');
const currentUserNameSpan = document.getElementById('currentUserName');

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

function updateCurrentUserName() {
    if (currentUserNameSpan) {
        currentUserNameSpan.textContent = userName || 'Guest';
    }
}

function initializePage() {
    updateCurrentUserName();
    if (window.location.pathname === '/room.html') {
        initializeRoom();
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
    if (event.target == settingsModal && window.innerWidth > 768) {
        closeSettings();
    }
}

function joinRoom() {
    const roomId = document.getElementById('roomId').value;

    if (roomId.length !== 4 || !/^\d+$/.test(roomId)) {
        alert('Please enter a valid 4-digit room code.');
        return;
    }

    if (!userName) {
        alert('Please set your name in the settings before joining a room.');
        openSettings();
        return;
    }

    window.location.href = `/room.html?roomId=${roomId}`;
}

async function initializeRoom() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('roomId');

    document.getElementById('roomDisplay').textContent = roomId;

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        socket = io();

        socket.on('connect', () => {
            socket.emit('join-room', { roomId, userName });
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
    }
}

function handleUserConnected(user) {
    console.log('User connected:', user);
    createPeerConnection(user.id);
    callUser(user.id);
}

function handleUserDisconnected(userId) {
    console.log('User disconnected:', userId);
    if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
    }
}

function updateUserList(users) {
    const userList = document.getElementById('userList');
    userList.innerHTML = '';
    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = 'user-item';
        userItem.textContent = user.name;
        userList.appendChild(userItem);
    });
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

function updateUserName() {
    const newName = document.getElementById('updateUserName').value;
    if (newName && newName !== userName) {
        userName = newName;
        localStorage.setItem('userName', userName);
        updateCurrentUserName();
        if (socket) {
            socket.emit('update-user-name', newName);
        }
        closeSettings();
    }
}

document.addEventListener('DOMContentLoaded', initializePage);