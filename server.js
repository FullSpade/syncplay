const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory storage
const rooms = {};
const userMap = {}; // Maps socket.id -> roomId

function broadcastParticipants(roomId) {
    if (rooms[roomId]) {
        io.to(roomId).emit('participants-update', Object.values(rooms[roomId].participants));
    }
}

io.on('connection', (socket) => {
    socket.on('join-room', (data, callback) => {
        const { roomId, name, country } = data;
        
        socket.join(roomId);
        userMap[socket.id] = roomId;
        
        if (!rooms[roomId]) {
            // First person to join becomes host
            rooms[roomId] = {
                host: socket.id,
                currentVideoId: 'jNQXAC9IVRw', // "Me at the zoo" fallback
                state: 2, 
                time: 0,
                participants: {}
            };
        }
        
        const isHost = rooms[roomId].host === socket.id;
        
        // Add to participants list
        rooms[roomId].participants[socket.id] = {
            id: socket.id,
            name: name,
            country: country || 'Unknown',
            joinTime: Date.now(),
            isHost: isHost
        };
        
        // Return room details to the joining user
        callback({
            isHost: isHost,
            videoId: rooms[roomId].currentVideoId,
            state: rooms[roomId].state,
            time: rooms[roomId].time
        });
        
        socket.to(roomId).emit('notification', `${name} joined the room.`);
        broadcastParticipants(roomId);
    });

    socket.on('get-time', (callback) => {
        callback(Date.now());
    });

    // Control events (only apply if sent by the host)
    socket.on('play', (roomId, time, timestamp) => {
        if (rooms[roomId] && rooms[roomId].host === socket.id) {
            rooms[roomId].state = 1; // playing
            rooms[roomId].time = time;
            socket.to(roomId).emit('play', time, timestamp);
        }
    });

    socket.on('pause', (roomId, time, timestamp) => {
         if (rooms[roomId] && rooms[roomId].host === socket.id) {
            rooms[roomId].state = 2; // paused
            rooms[roomId].time = time;
            socket.to(roomId).emit('pause', time, timestamp);
        }
    });

    socket.on('seek', (roomId, time, timestamp) => {
         if (rooms[roomId] && rooms[roomId].host === socket.id) {
            rooms[roomId].time = time;
            socket.to(roomId).emit('seek', time, timestamp);
        }
    });
    
    socket.on('load-video', (roomId, videoId) => {
         if (rooms[roomId] && rooms[roomId].host === socket.id) {
            rooms[roomId].currentVideoId = videoId;
            rooms[roomId].time = 0;
            rooms[roomId].state = 1;
            socket.to(roomId).emit('load-video', videoId);
        }
    });

    socket.on('sync', (roomId, time, state, timestamp) => {
        if (rooms[roomId] && rooms[roomId].host === socket.id) {
            rooms[roomId].time = time;
            rooms[roomId].state = state;
            socket.to(roomId).emit('sync', time, state, timestamp);
        }
    });

    // Chat Event
    socket.on('chat-message', (roomId, message) => {
        if (rooms[roomId] && rooms[roomId].participants[socket.id]) {
            const senderName = rooms[roomId].participants[socket.id].name;
            const chatPayload = {
                sender: senderName,
                text: message,
                timestamp: Date.now()
            };
            // Broadcast to everyone in the room (including sender to confirm receipt)
            io.to(roomId).emit('chat-message', chatPayload);
        }
    });

    socket.on('disconnect', () => {
        const roomId = userMap[socket.id];
        if (roomId && rooms[roomId]) {
            const user = rooms[roomId].participants[socket.id];
            if (user) {
                socket.to(roomId).emit('notification', `${user.name} left the room.`);
                delete rooms[roomId].participants[socket.id];
                
                // If room empty, ideally clear it. If host left, elect new host.
                // For MVP: simply broadcast updated list.
                broadcastParticipants(roomId);
            }
        }
        delete userMap[socket.id];
    });
});

server.listen(PORT, () => {
    console.log(`SyncPlay server running on http://localhost:${PORT}`);
});
