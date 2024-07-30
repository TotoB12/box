import { Server } from 'socket.io'

const ioHandler = (req, res) => {
  if (!res.socket.server.io) {
    const io = new Server(res.socket.server)

    io.on('connection', (socket) => {
      console.log('A user connected')

      socket.on('join-room', ({ roomId, userName }) => {
        socket.join(roomId)
        socket.to(roomId).emit('user-connected', { id: socket.id, name: userName })
      })

      socket.on('offer', (data) => {
        socket.to(data.target).emit('offer', {
          sdp: data.sdp,
          sender: socket.id
        })
      })

      socket.on('answer', (data) => {
        socket.to(data.target).emit('answer', {
          sdp: data.sdp,
          sender: socket.id
        })
      })

      socket.on('ice-candidate', (data) => {
        socket.to(data.target).emit('ice-candidate', {
          candidate: data.candidate,
          sender: socket.id
        })
      })

      socket.on('disconnect', () => {
        console.log('A user disconnected')
        socket.rooms.forEach((room) => {
          socket.to(room).emit('user-disconnected', socket.id)
        })
      })
    })

    res.socket.server.io = io
  }
  res.end()
}

export const config = {
  api: {
    bodyParser: false
  }
}

export default ioHandler