const express = require("express");
const path = require("path");

const app = express();

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

module.exports = app;