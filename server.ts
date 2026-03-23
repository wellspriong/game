import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = Number(process.env.PORT) || 3000;

  // Store active users: { socketId: { username, score, color, avatar, votesToKick } }
  const users = new Map<string, { username: string; score: number; color: string; avatar?: string; votesToKick: Set<string> }>();
  // Store message history
  const messages: { id: string; user: string; text: string; timestamp: number; isSystem?: boolean }[] = [];

  // Game State
  let gameActive = false;
  let currentDrawer: string | null = null;
  let currentWord = "";
  let currentHint: string[] = [];
  let timer: NodeJS.Timeout | null = null;
  let timeLeft = 0;
  let round = 0;
  let maxRounds = 3;
  let roundTime = 60;
  let drawerIndex = 0;
  let guessedUsers = new Set<string>();
  let drawingLikes = new Set<string>();
  let drawingDislikes = new Set<string>();

  const words = {
    General: ["apple", "banana", "car", "dog", "elephant", "flower", "guitar", "house", "island", "jacket", "kangaroo", "laptop", "mountain", "notebook", "ocean", "piano", "queen", "robot", "sun", "tree", "umbrella", "violin", "whale", "xylophone", "yacht", "zebra"],
    Animals: ["lion", "tiger", "bear", "penguin", "giraffe", "monkey", "snake", "dolphin", "shark", "butterfly", "spider", "eagle", "owl", "wolf", "fox"],
    Food: ["pizza", "burger", "sushi", "taco", "pasta", "ice cream", "donut", "pancake", "sandwich", "cookie", "cake", "bread", "cheese", "egg", "milk"],
    Objects: ["hammer", "screwdriver", "umbrella", "glasses", "watch", "camera", "phone", "key", "bottle", "chair", "table", "lamp", "mirror", "clock", "brush"]
  };

  const startNewRound = () => {
    const socketIds = Array.from(users.keys());
    if (socketIds.length < 2) {
      gameActive = false;
      io.emit("game-ended", { reason: "Not enough players" });
      return;
    }

    guessedUsers.clear();
    drawingLikes.clear();
    drawingDislikes.clear();
    io.emit("drawing-feedback", { likes: 0, dislikes: 0 });

    currentDrawer = socketIds[drawerIndex];
    const categoryNames = Object.keys(words) as (keyof typeof words)[];
    const randomCategory = categoryNames[Math.floor(Math.random() * categoryNames.length)];
    const categoryWords = words[randomCategory];
    currentWord = categoryWords[Math.floor(Math.random() * categoryWords.length)];
    currentHint = currentWord.split("").map(char => char === " " ? " " : "_");

    timeLeft = roundTime;
    io.emit("new-round", {
      drawer: users.get(currentDrawer!)?.username,
      drawerId: currentDrawer,
      round: round + 1,
      maxRounds,
      timeLeft,
      category: randomCategory,
      hint: currentHint.join(" ")
    });

    io.to(currentDrawer!).emit("your-word", currentWord);

    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      timeLeft--;
      io.emit("timer-update", timeLeft);
      
      // Hint logic: Reveal a letter every 20 seconds
      if (timeLeft > 0 && timeLeft % 20 === 0 && timeLeft !== roundTime) {
        const unrevealedIndices = currentHint.map((char, index) => char === "_" ? index : -1).filter(index => index !== -1);
        if (unrevealedIndices.length > 1) { // Keep at least one letter hidden
          const randomIndex = unrevealedIndices[Math.floor(Math.random() * unrevealedIndices.length)];
          currentHint[randomIndex] = currentWord[randomIndex];
          io.emit("hint-update", currentHint.join(" "));
        }
      }

      if (timeLeft <= 0) endTurn("Time's up!");
    }, 1000);
  };

  const endTurn = (reason: string) => {
    if (timer) clearInterval(timer);
    io.emit("turn-ended", { word: currentWord, reason });

    setTimeout(() => {
      const socketIds = Array.from(users.keys());
      if (socketIds.length === 0) return;
      drawerIndex = (drawerIndex + 1) % socketIds.length;
      if (drawerIndex === 0) round++;

      if (round >= maxRounds) {
        gameActive = false;
        const sortedUsers = Array.from(users.entries())
          .map(([id, data]) => ({ id, ...data }))
          .sort((a, b) => b.score - a.score);
        io.emit("game-over", sortedUsers);
        round = 0;
        drawerIndex = 0;
      } else {
        startNewRound();
      }
    }, 3000);
  };

  io.on("connection", (socket) => {
    socket.on("join", ({ username, color, avatar }: { username: string; color: string; avatar?: string }) => {
      users.set(socket.id, { username, score: 0, color: color || "#000000", avatar, votesToKick: new Set() });
      socket.emit("history", messages);
      io.emit("users", Array.from(users.entries()).map(([id, data]) => ({ id, username: data.username, score: data.score, color: data.color, avatar: data.avatar, votesCount: data.votesToKick.size })));
      if (gameActive) socket.emit("game-state", { gameActive, currentDrawer, round, maxRounds, timeLeft });
    });

    socket.on("start-game", (settings: { rounds: number; time: number }) => {
      if (users.size < 2) return;
      gameActive = true;
      maxRounds = settings.rounds || 3;
      roundTime = settings.time || 60;
      round = 0;
      drawerIndex = 0;
      users.forEach(u => u.score = 0);
      io.emit("users", Array.from(users.entries()).map(([id, data]) => ({ id, username: data.username, score: data.score, color: data.color, avatar: data.avatar, votesCount: data.votesToKick.size })));
      startNewRound();
    });

    socket.on("draw-line", (data) => { if (socket.id === currentDrawer) socket.broadcast.emit("draw-line", data); });
    socket.on("fill-canvas", (data) => { if (socket.id === currentDrawer) socket.broadcast.emit("fill-canvas", data); });
    socket.on("clear-canvas", () => { if (socket.id === currentDrawer) io.emit("clear-canvas"); });

    socket.on("feedback", (type: "like" | "dislike") => {
      if (!gameActive || socket.id === currentDrawer) return;
      if (type === "like") { drawingLikes.add(socket.id); drawingDislikes.delete(socket.id); }
      else { drawingDislikes.add(socket.id); drawingLikes.delete(socket.id); }
      io.emit("drawing-feedback", { likes: drawingLikes.size, dislikes: drawingDislikes.size });
    });

    socket.on("vote-kick", (targetId: string) => {
      const target = users.get(targetId);
      if (!target || socket.id === targetId) return;
      target.votesToKick.add(socket.id);
      if (target.votesToKick.size >= Math.ceil(users.size / 2)) {
        io.to(targetId).emit("kicked");
        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) targetSocket.disconnect();
      } else {
        io.emit("users", Array.from(users.entries()).map(([id, data]) => ({ id, username: data.username, score: data.score, color: data.color, avatar: data.avatar, votesCount: data.votesToKick.size })));
      }
    });

    socket.on("chatMessage", (text: string) => {
      const userData = users.get(socket.id);
      if (!userData) return;
      if (gameActive && socket.id !== currentDrawer && !guessedUsers.has(socket.id)) {
        if (text.toLowerCase().trim() === currentWord.toLowerCase()) {
          guessedUsers.add(socket.id);
          userData.score += Math.ceil((timeLeft / roundTime) * 500) + 100;
          const drawerData = users.get(currentDrawer!);
          if (drawerData) drawerData.score += 50;
          io.emit("message", { id: Date.now().toString(), user: "System", text: `${userData.username} guessed the word!`, timestamp: Date.now(), isSystem: true });
          io.emit("users", Array.from(users.entries()).map(([id, data]) => ({ id, username: data.username, score: data.score, color: data.color, avatar: data.avatar, votesCount: data.votesToKick.size })));
          if (guessedUsers.size === users.size - 1) endTurn("Everyone guessed it!");
          return;
        }
      }
      const msg = { id: Date.now().toString(), user: userData.username, text, timestamp: Date.now() };
      messages.push(msg);
      if (messages.length > 100) messages.shift();
      io.emit("message", msg);
    });

    socket.on("disconnect", () => {
      const userData = users.get(socket.id);
      if (userData) {
        users.delete(socket.id);
        users.forEach(u => u.votesToKick.delete(socket.id));
        io.emit("users", Array.from(users.entries()).map(([id, data]) => ({ id, username: data.username, score: data.score, color: data.color, avatar: data.avatar, votesCount: data.votesToKick.size })));
        if (socket.id === currentDrawer && gameActive) endTurn("Drawer left the game");
        else if (users.size < 2 && gameActive) { gameActive = false; if (timer) clearInterval(timer); io.emit("game-ended", { reason: "Not enough players" }); }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
