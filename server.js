const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("join-room", ({ roomId, userName }) => {
    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add({ id: socket.id, name: userName });

    io.to(roomId).emit("user-connected", { id: socket.id, name: userName });
    io.to(roomId).emit("update-user-list", Array.from(rooms.get(roomId)));

    socket.on("disconnect", () => {
      console.log("A user disconnected");
      if (rooms.has(roomId)) {
        rooms.get(roomId).delete({ id: socket.id, name: userName });
        if (rooms.get(roomId).size === 0) {
          rooms.delete(roomId);
        } else {
          io.to(roomId).emit("user-disconnected", socket.id);
          io.to(roomId).emit("update-user-list", Array.from(rooms.get(roomId)));
        }
      }
    });

    socket.on("update-user-name", (newName) => {
      const user = Array.from(rooms.get(roomId)).find(
        (u) => u.id === socket.id,
      );
      if (user) {
        user.name = newName;
        io.to(roomId).emit("update-user-list", Array.from(rooms.get(roomId)));
      }
    });
  });

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
