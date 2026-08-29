const socket = io({
    transports: ['websocket', 'polling']
});

socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('connect_error', (err) => {
    console.error('Connection error:', err.message);
});

// UI Elements
const setupView = document.getElementById('setup-view');
const playerView = document.getElementById('player-view');
const nameInput = document.getElementById('name-input');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const roomDisplay = document.getElementById('room-display');
const roleBadge = document.getElementById('role-badge');
const clientOverlay = document.getElementById('client-overlay');
const hostControls = document.getElementById('host-controls');
const videoUrlInput = document.getElementById('video-url-input');
const loadBtn = document.getElementById('load-btn');
const toastEl = document.getElementById('toast');
const theaterBtn = document.getElementById('theater-btn');
const mainAppContainer = document.getElementById('app');

const participantsList = document.getElementById('participants-list');
const listenerCount = document.getElementById('listener-count');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');

// State
let currentRoom = null;
let isHost = false;
let ytPlayer = null;
let isPlayerReady = false;
let overrideStateChange = false; 
let latestHostSync = { mediaTime: 0, serverTimestamp: 0, state: 2, valid: false };

let myName = "";
let myCountry = "Unknown";
let activeParticipants = [];

// Fetch Country
fetch('https://ipapi.co/json/')
    .then(res => res.json())
    .then(data => {
        if(data.country_name) myCountry = data.country_name;
    }).catch(err => console.log("IP fetch failed", err));

// Helper: Show toast notification
function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hide', 'hidden');
    setTimeout(() => toastEl.classList.add('hide'), 3000);
}

// Time Synchronization
let serverTimeOffset = 0;
function syncTimeWithServer() {
    const start = Date.now();
    socket.emit('get-time', (serverTime) => {
        const end = Date.now();
        const latency = (end - start) / 2;
        serverTimeOffset = serverTime - (start + latency);
    });
}
setInterval(syncTimeWithServer, 5000);
syncTimeWithServer();

function getSyncedTime() {
    return Date.now() + serverTimeOffset;
}

// Load YouTube IFrame API
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

function onYouTubeIframeAPIReady() {
    console.log("YouTube API Ready");
}

function initYouTubePlayer(videoId, startState, startTime) {
    if (ytPlayer) ytPlayer.destroy();
    
    ytPlayer = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            'playsinline': 1,
            'controls': isHost ? 1 : 0,
            'disablekb': isHost ? 0 : 1,
            'rel': 0
        },
        events: {
            'onReady': (event) => onPlayerReady(event, startState, startTime),
            'onStateChange': onPlayerStateChange
        }
    });

    if (isHost && document.getElementById('player')) {
        document.getElementById('player').style.pointerEvents = 'auto';
    }
}

function onPlayerReady(event, startState, startTime) {
    isPlayerReady = true;
    
    if (startTime > 0) event.target.seekTo(startTime);
    
    if (startState === 1) { 
        event.target.playVideo();
    } else {
        event.target.pauseVideo();
    }

    if (isHost) {
        setInterval(() => {
            if (ytPlayer && currentRoom && isPlayerReady) {
                const time = ytPlayer.getCurrentTime();
                const state = ytPlayer.getPlayerState();
                socket.emit('sync', currentRoom, time, state, getSyncedTime());
            }
        }, 2000);
    }
}

function onPlayerStateChange(event) {
    if (!isHost || overrideStateChange) return;

    const state = event.data;
    const time = ytPlayer.getCurrentTime();
    const timestamp = getSyncedTime();

    if (state === YT.PlayerState.PLAYING) {
        socket.emit('play', currentRoom, time, timestamp);
    } else if (state === YT.PlayerState.PAUSED) {
        socket.emit('pause', currentRoom, time, timestamp);
    } else if (state === YT.PlayerState.BUFFERING) {
        socket.emit('seek', currentRoom, time, timestamp);
    }
}

function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : url; 
}

/* =========================================
   UI & Setup Logic
========================================= */

theaterBtn.addEventListener('click', () => {
    const isActive = mainAppContainer.classList.toggle('theater-mode');
    document.body.classList.toggle('theater-active', isActive);
    theaterBtn.classList.toggle('active', isActive);
    
    if (isActive && window.innerWidth > 1000) {
        window.scrollTo(0, 0); // Lock view cleanly
    }
});

joinBtn.addEventListener('click', () => {
    myName = nameInput.value.trim();
    const roomId = roomInput.value.trim();
    
    if (!myName) return showToast("Please enter a Display Name");
    if (!roomId) return showToast("Please enter a Room ID");
    
    socket.emit('join-room', { roomId, name: myName, country: myCountry }, (response) => {
        currentRoom = roomId;
        isHost = response.isHost;
        
        setupView.classList.add('hidden');
        playerView.classList.remove('hidden');
        
        roomDisplay.textContent = roomId;
        roleBadge.textContent = isHost ? "Host" : "Client";
        
        if (isHost) {
            clientOverlay.classList.add('hidden');
            hostControls.classList.remove('hidden');
            showToast("You created the room! You are the Host.");
        } else {
            clientOverlay.classList.remove('hidden');
            showToast("Joined room successfully.");
        }
        
        initYouTubePlayer(response.videoId, response.state, response.time);
    });
});

loadBtn.addEventListener('click', () => {
    if (!isHost) return;
    const input = videoUrlInput.value.trim();
    if (!input) return;
    
    const videoId = extractVideoId(input);
    videoUrlInput.value = '';
    
    socket.emit('load-video', currentRoom, videoId);
    ytPlayer.loadVideoById(videoId);
});

/* =========================================
   Participants Logic
========================================= */

function formatDuration(ms) {
    const min = Math.floor(ms / 60000);
    if(min < 1) return '< 1 min';
    return `${min} min`;
}

function renderParticipants() {
    participantsList.innerHTML = '';
    listenerCount.textContent = activeParticipants.length;
    
    const now = Date.now();
    activeParticipants.forEach(p => {
        const li = document.createElement('li');
        li.className = 'participant-item';
        
        const avatar = p.name.charAt(0).toUpperCase();
        const duration = formatDuration(now - p.joinTime);
        const hostBadge = p.isHost ? ' (Host)' : '';
        
        li.innerHTML = `
            <div class="participant-avatar">${avatar}</div>
            <div class="participant-info">
                <span class="participant-name">${p.name}${hostBadge}</span>
                <span class="participant-meta">
                    <span>${p.country}</span>
                    <span>${duration}</span>
                </span>
            </div>
        `;
        participantsList.appendChild(li);
    });
}

// Refresh durations gently
setInterval(renderParticipants, 60000);

socket.on('participants-update', (participants) => {
    activeParticipants = participants;
    renderParticipants();
});

/* =========================================
   Chat Logic
========================================= */

function appendChatMessage(data, isSelf) {
    const li = document.createElement('li');
    li.className = `chat-message ${isSelf ? 'self' : ''}`;
    
    // Secure against XSS
    const safeText = document.createTextNode(data.text);
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.appendChild(safeText);
    
    // Time formatting
    const timeString = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const senderInfo = document.createElement('div');
    senderInfo.className = 'chat-sender-info';
    
    if (!isSelf) {
        const sender = document.createElement('span');
        sender.className = 'chat-sender';
        sender.textContent = data.sender;
        senderInfo.appendChild(sender);
    }
    
    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'chat-timestamp';
    timestampSpan.textContent = timeString;
    senderInfo.appendChild(timestampSpan);
    
    li.appendChild(senderInfo);
    li.appendChild(bubble);
    
    chatMessages.appendChild(li);
    chatMessages.scrollTop = chatMessages.scrollHeight; // autoscroll
}

function sendChat() {
    const text = chatInput.value.trim();
    if(!text || !currentRoom) return;
    
    socket.emit('chat-message', currentRoom, text);
    chatInput.value = '';
}

sendChatBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
});

socket.on('chat-message', (data) => {
    appendChatMessage(data, data.sender === myName);
});


/* =========================================
   Sync Control Socket Events
========================================= */

socket.on('notification', (msg) => {
    showToast(msg);
});

socket.on('play', (time, timestamp) => {
    if (isHost || !isPlayerReady) return;
    overrideStateChange = true;
    
    let targetTime = time;
    if (timestamp) {
        const transitSec = Math.max(0, (getSyncedTime() - timestamp) / 1000);
        targetTime += transitSec;
    }
    if (Math.abs(ytPlayer.getCurrentTime() - targetTime) > 0.5) ytPlayer.seekTo(targetTime);
    ytPlayer.playVideo();
    setTimeout(() => overrideStateChange = false, 100);
});

socket.on('pause', (time, timestamp) => {
    if (isHost || !isPlayerReady) return;
    overrideStateChange = true;
    ytPlayer.seekTo(time); 
    ytPlayer.pauseVideo();
    setTimeout(() => overrideStateChange = false, 100);
});

socket.on('seek', (time, timestamp) => {
    if (isHost || !isPlayerReady) return;
    overrideStateChange = true;
    let targetTime = time;
    if (timestamp) {
        const transitSec = Math.max(0, (getSyncedTime() - timestamp) / 1000);
        targetTime += transitSec;
    }
    ytPlayer.seekTo(targetTime);
    setTimeout(() => overrideStateChange = false, 100);
});

socket.on('load-video', (videoId) => {
    if (isHost || !isPlayerReady) return;
    overrideStateChange = true;
    ytPlayer.loadVideoById(videoId);
    setTimeout(() => overrideStateChange = false, 100);
});

socket.on('sync', (hostTime, hostState, timestamp) => {
    if (isHost || !isPlayerReady) return;
    latestHostSync = { mediaTime: hostTime, serverTimestamp: timestamp, state: hostState, valid: true };
    let targetTime = hostTime;
    if (timestamp && hostState === 1) targetTime += Math.max(0, (getSyncedTime() - timestamp) / 1000);
    
    const currentState = ytPlayer.getPlayerState();
    overrideStateChange = true;
    if (hostState === 1 && currentState !== 1 && currentState !== 3) ytPlayer.playVideo();
    else if (hostState === 2 && currentState !== 2) ytPlayer.pauseVideo();
    setTimeout(() => overrideStateChange = false, 100);

    const drift = ytPlayer.getCurrentTime() - targetTime; 
    if (Math.abs(drift) > 2.0 || (hostState === 2 && Math.abs(drift) > 0.5)) {
        overrideStateChange = true;
        ytPlayer.seekTo(targetTime);
        ytPlayer.setPlaybackRate(1.0);
        setTimeout(() => overrideStateChange = false, 100);
    }
});

setInterval(() => {
    if (isHost || !isPlayerReady || !latestHostSync.valid || latestHostSync.state !== 1 || ytPlayer.getPlayerState() !== 1) return; 
    const elapsedRealTime = Math.max(0, (getSyncedTime() - latestHostSync.serverTimestamp) / 1000);
    const expectedTime = latestHostSync.mediaTime + elapsedRealTime;
    const drift = ytPlayer.getCurrentTime() - expectedTime; 
    
    if (Math.abs(drift) > 2.0) return;
    
    if (drift < -0.05) ytPlayer.setPlaybackRate(1.25);
    else if (drift > 0.05) ytPlayer.setPlaybackRate(0.75);
    else ytPlayer.setPlaybackRate(1.0);
}, 250);
