// Pirate Cribbage - minimal server (works on Railway)
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(express.static("public"));

app.get("/health", (req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server);

io.on("connection", (socket) => {
  socket.emit("hello", { msg: "🏴‍☠️ Ahoy! Pirate Cribbage server is alive." });

  socket.on("ping", () => {
    socket.emit("hello", { msg: "🏴‍☠️ Ahoy! Ping received loud and clear." });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Listening on", PORT));

