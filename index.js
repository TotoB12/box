// Add in index.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/room/:roomId", (req, res) => {
  const roomId = req.params.roomId;
  if (/^\d{4}$/.test(roomId)) {
    res.sendFile(path.join(__dirname, "public", "room.html"));
  } else {
    res.status(404).send("Invalid room ID. Please use a 4-digit number.");
  }
});

app.get("*", (req, res) => {
  res.redirect("/");
});

const rooms = new Map();

io.on("connection", (socket) => {
  console.log("A user connected");

  let currentRoom = null;
  let currentUserName = null;

  socket.on("join-room", ({ roomId, userName }) => {
    currentRoom = roomId;
    currentUserName = userName;

    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    rooms.get(roomId).set(socket.id, {
      id: socket.id,
      name: userName,
      muted: false,
      videoOff: true,
    });

    io.to(roomId).emit("user-connected", {
      id: socket.id,
      name: userName,
      muted: false,
      videoOff: true,
    });
    io.to(roomId).emit(
      "update-user-list",
      Array.from(rooms.get(roomId).values()),
    );

    socket.on("disconnect", () => {
      console.log("A user disconnected");
      handleDisconnect();
    });

    socket.on("update-user-name", (newName) => {
      if (currentRoom && rooms.has(currentRoom)) {
        const user = rooms.get(currentRoom).get(socket.id);
        if (user) {
          user.name = newName;
          currentUserName = newName;
          io.to(currentRoom).emit(
            "update-user-list",
            Array.from(rooms.get(currentRoom).values()),
          );
        }
      }
    });

    socket.on("mute-status", (muted) => {
      if (currentRoom && rooms.has(currentRoom)) {
        const user = rooms.get(currentRoom).get(socket.id);
        if (user) {
          user.muted = muted;
          io.to(currentRoom).emit(
            "update-user-list",
            Array.from(rooms.get(currentRoom).values()),
          );
        }
      }
    });

    socket.on("video-status", (videoOff) => {
      if (currentRoom && rooms.has(currentRoom)) {
        const user = rooms.get(currentRoom).get(socket.id);
        if (user) {
          user.videoOff = videoOff;
          io.to(currentRoom).emit(
            "update-user-list",
            Array.from(rooms.get(currentRoom).values()),
          );
        }
      }
    });
  });

  function handleDisconnect() {
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(socket.id);
      if (rooms.get(currentRoom).size === 0) {
        rooms.delete(currentRoom);
      } else {
        io.to(currentRoom).emit("user-disconnected", socket.id);
        io.to(currentRoom).emit(
          "update-user-list",
          Array.from(rooms.get(currentRoom).values()),
        );
      }
    }
  }

  socket.on("offer", (data) => {
    socket.to(data.target).emit("offer", {
      sdp: data.sdp,
      sender: socket.id,
    });
  });

  socket.on("answer", (data) => {
    socket.to(data.target).emit("answer", {
      sdp: data.sdp,
      sender: socket.id,
    });
  });

  socket.on("ice-candidate", (data) => {
    socket.to(data.target).emit("ice-candidate", {
      candidate: data.candidate,
      sender: socket.id,
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
