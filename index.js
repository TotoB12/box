const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/room/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  if (/^\d{4}$/.test(roomId)) {
    res.sendFile(path.join(__dirname, 'public', 'room.html'));
  } else {
    res.status(404).send("Invalid room ID. Please use a 4-digit number.");
  }
});

app.get('*', (req, res) => {
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log('Frontend server is running on port ' + PORT);
});
