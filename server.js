// Pirate Cribbage - minimal server (works on Railway)
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve frontend
app.use(express.static("public"));

// Health check (Railway likes this)
app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.emit("hello", {
    msg: "🏴‍☠️ Ahoy! Pirate Cribbage server is alive."
  });

  socket.on("ping", () => {
    console.log("Received ping from", socket.id);
    socket.emit("pong", {
      msg: "✅ Pong received by server."
    });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Listening on", PORT);
});

// 🚨 IMPORTANT: prevent Railway from killing idle servers
setInterval(() => {
  console.log("Heartbeat – server alive");
}, 30000);
