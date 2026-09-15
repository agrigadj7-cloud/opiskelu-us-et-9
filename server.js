import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "Opiskelu_US_ET_site_v21_moderointi");
const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);
const io = new Server(httpServer);
const dataDir = process.env.DATA_DIR || __dirname;
const db = new Database(path.join(dataDir, "site.db"));

db.pragma("journal_mode = WAL");
try { db.exec("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''"); } catch (e) {}
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 avatar TEXT DEFAULT '',
 role TEXT NOT NULL DEFAULT 'user',
 muted_until INTEGER DEFAULT 0,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 body TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS forum_posts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 title TEXT NOT NULL,
 category TEXT NOT NULL,
 message TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS comments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 body TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const CREATOR_USER = process.env.CREATOR_USER || "Admin.Cxcjl";
const CREATOR_PASS = process.env.CREATOR_PASS || "Aina1234!";

const existing = db.prepare("SELECT id FROM users WHERE username=?").get(CREATOR_USER);
if (!existing) {
  const hash = bcrypt.hashSync(CREATOR_PASS, 12);
  db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)")
    .run(CREATOR_USER, hash, "creator", Date.now());
}

// Built-in moderation accounts from the original site. They are created only if missing.
const seedAccounts = [
  { username: "Black", password: process.env.BLACK_PASS || "Black2620", role: "admin" },
  { username: "White", password: process.env.WHITE_PASS || "White2062", role: "moderator" }
];
for (const account of seedAccounts) {
  const found = db.prepare("SELECT id FROM users WHERE username=?").get(account.username);
  if (!found) {
    const hash = bcrypt.hashSync(account.password, 12);
    db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)")
      .run(account.username, hash, account.role, Date.now());
  }
}

app.use(express.json({ limit: "1mb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" }
}));

function auth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Требуется вход" });
  next();
}
function moderator(req, res, next) {
  if (!req.session.user || !["creator","admin","moderator"].includes(req.session.user.role))
    return res.status(403).json({ error: "Недостаточно прав" });
  next();
}
function creator(req, res, next) {
  if (!req.session.user || req.session.user.role !== "creator")
    return res.status(403).json({ error: "Только создатель" });
  next();
}

app.get("/api/version", (_, res) => res.json({ version: "v21-base-plus" }));


// Server-backed forum
app.get("/api/forum", (_, res) => {
  const rows = db.prepare(`
    SELECT p.id,p.title,p.category,p.message,p.created_at,u.username
    FROM forum_posts p JOIN users u ON u.id=p.user_id
    ORDER BY p.id DESC LIMIT 200
  `).all();
  res.json(rows);
});

app.post("/api/forum", auth, (req,res) => {
  const title = String(req.body.title || "").trim();
  const category = String(req.body.category || "US").trim();
  const message = String(req.body.message || "").trim();
  if (title.length < 1 || title.length > 80 || !["US","ET"].includes(category) || message.length < 1 || message.length > 600)
    return res.status(400).json({error:"Virheelliset keskustelutiedot"});
  const u = db.prepare("SELECT muted_until FROM users WHERE id=?").get(req.session.user.id);
  if (u?.muted_until > Date.now()) return res.status(403).json({error:"Olet mykistetty"});
  const created_at = Date.now();
  const info = db.prepare("INSERT INTO forum_posts(user_id,title,category,message,created_at) VALUES(?,?,?,?,?)")
    .run(req.session.user.id,title,category,message,created_at);
  const post={id:Number(info.lastInsertRowid),title,category,message,created_at,username:req.session.user.username};
  io.emit("forum:changed");
  res.json(post);
});

app.delete("/api/forum/:id", moderator, (req,res) => {
  const r=db.prepare("DELETE FROM forum_posts WHERE id=?").run(req.params.id);
  io.emit("forum:changed");
  res.json({ok:r.changes===1});
});

// Server-backed comments (global, matching the original v23 behavior)
app.get("/api/comments", (_, res) => {
  const rows=db.prepare(`SELECT c.id,c.body,c.created_at,u.username,u.role FROM comments c JOIN users u ON u.id=c.user_id ORDER BY c.id DESC LIMIT 200`).all();
  res.json(rows);
});

app.post("/api/comments", auth, (req,res) => {
  const body=String(req.body.body || "").trim();
  if(!body || body.length>2000) return res.status(400).json({error:"Virheellinen kommentti"});
  const u=db.prepare("SELECT muted_until FROM users WHERE id=?").get(req.session.user.id);
  if(u?.muted_until>Date.now()) return res.status(403).json({error:"Olet mykistetty"});
  const created_at=Date.now();
  const info=db.prepare("INSERT INTO comments(user_id,body,created_at) VALUES(?,?,?)").run(req.session.user.id,body,created_at);
  const comment={id:Number(info.lastInsertRowid),body,created_at,username:req.session.user.username,role:req.session.user.role};
  io.emit("comments:changed");
  res.json(comment);
});

app.delete("/api/comments/:id", moderator, (req,res) => {
  const r=db.prepare("DELETE FROM comments WHERE id=?").run(req.params.id);
  io.emit("comments:changed");
  res.json({ok:r.changes===1});
});

app.patch("/api/accounts/:id/role", creator, (req,res) => {
  const role=String(req.body.role || "user");
  if(!["user","moderator","admin","creator"].includes(role)) return res.status(400).json({error:"Tuntematon rooli"});
  const target=db.prepare("SELECT id,username FROM users WHERE id=?").get(req.params.id);
  if(!target) return res.status(404).json({error:"Käyttäjää ei löydy"});
  if(target.username===CREATOR_USER && role!=="creator") return res.status(400).json({error:"Luojan roolia ei voi poistaa"});
  db.prepare("UPDATE users SET role=? WHERE id=?").run(role,target.id);
  io.emit("moderation:changed");
  res.json({ok:true,id:target.id,role});
});

app.post("/api/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (username.length < 3 || password.length < 8) return res.status(400).json({ error: "Некорректные данные" });
  try {
    const hash = await bcrypt.hash(password, 12);
    const info = db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)")
      .run(username, hash, "user", Date.now());
    res.json({ id: info.lastInsertRowid, username, role: "user" });
  } catch {
    res.status(409).json({ error: "Имя уже занято" });
  }
});

app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const u = db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if (!u || !(await bcrypt.compare(password, u.password_hash)))
    return res.status(401).json({ error: "Неверный логин или пароль" });
  if (u.muted_until && u.muted_until > Date.now())
    return res.status(403).json({ error: "Аккаунт временно ограничен" });
  req.session.user = { id: u.id, username: u.username, role: u.role, avatar: u.avatar || "" };
  res.json(req.session.user);
});

app.patch("/api/profile/avatar", auth, (req,res) => {
  const avatar = String(req.body.avatar || "");
  if (avatar.length > 700000) return res.status(400).json({error:"Avatar on liian suuri"});
  if (avatar && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(avatar)) return res.status(400).json({error:"Virheellinen kuvatiedosto"});
  db.prepare("UPDATE users SET avatar=? WHERE id=?").run(avatar, req.session.user.id);
  const u = db.prepare("SELECT id,username,role,avatar FROM users WHERE id=?").get(req.session.user.id);
  req.session.user = u;
  res.json(u);
});

app.post("/api/logout", auth, (req,res) => req.session.destroy(() => res.json({ok:true})));
app.get("/api/me", (req,res) => { if(!req.session.user) return res.json(null); const u=db.prepare("SELECT id,username,role,avatar FROM users WHERE id=?").get(req.session.user.id); req.session.user=u; res.json(u); });

app.get("/api/accounts", moderator, (req,res) => {
  const rows = db.prepare("SELECT id,username,role,avatar,muted_until,created_at FROM users ORDER BY id").all();
  res.json({ count: rows.length, users: rows });
});

app.post("/api/accounts/:id/password", creator, async (req,res) => {
  const password = String(req.body.password || "");
  if (password.length < 8) return res.status(400).json({error:"Пароль должен быть не короче 8 символов"});
  const hash = await bcrypt.hash(password, 12);
  const r = db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, req.params.id);
  res.json({ok: r.changes === 1});
});

app.delete("/api/accounts/:id", creator, (req,res) => {
  const u = db.prepare("SELECT username FROM users WHERE id=?").get(req.params.id);
  if (!u || u.username === CREATOR_USER) return res.status(400).json({error:"Создателя удалить нельзя"});
  db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

app.post("/api/accounts/:id/mute", moderator, (req,res) => {
  const minutes = Math.max(1, Math.min(10080, Number(req.body.minutes || 10)));
  const until = Date.now() + minutes * 60000;
  db.prepare("UPDATE users SET muted_until=? WHERE id=?").run(until, req.params.id);
  io.emit("moderation:changed");
  res.json({ok:true, muted_until:until});
});

app.post("/api/accounts/:id/unmute", moderator, (req,res) => {
  db.prepare("UPDATE users SET muted_until=0 WHERE id=?").run(req.params.id);
  io.emit("moderation:changed");
  res.json({ok:true});
});

app.get("/api/admin-chat", moderator, (req,res) => {
  res.json(db.prepare(`
    SELECT m.id,m.body,m.created_at,u.username,u.role,u.avatar
    FROM admin_messages m JOIN users u ON u.id=m.user_id
    ORDER BY m.id DESC LIMIT 200
  `).all().reverse());
});

app.post("/api/admin-chat", moderator, (req,res) => {
  const body = String(req.body.body || "").trim();
  if (!body || body.length > 2000) return res.status(400).json({error:"Viesti on tyhjä tai liian pitkä"});
  const created_at = Date.now();
  const info = db.prepare("INSERT INTO admin_messages(user_id,body,created_at) VALUES(?,?,?)")
    .run(req.session.user.id, body, created_at);
  const u = db.prepare("SELECT username,role,avatar FROM users WHERE id=?").get(req.session.user.id);
  const msg = {id:Number(info.lastInsertRowid),body,created_at,...u};
  io.emit("admin-chat:new", msg);
  res.json(msg);
});

app.delete("/api/admin-chat/:id", moderator, (req,res) => {
  db.prepare("DELETE FROM admin_messages WHERE id=?").run(req.params.id);
  io.emit("admin-chat:deleted", {id:Number(req.params.id)});
  res.json({ok:true});
});

app.get("/api/messages", (_,res) => {
  res.json(db.prepare(`
    SELECT m.id,m.body,m.created_at,u.username,u.role
    FROM messages m JOIN users u ON u.id=m.user_id
    ORDER BY m.id DESC LIMIT 100
  `).all().reverse());
});

app.post("/api/messages", auth, (req,res) => {
  const body = String(req.body.body || "").trim();
  if (!body || body.length > 2000) return res.status(400).json({error:"Некорректное сообщение"});
  const u = db.prepare("SELECT muted_until FROM users WHERE id=?").get(req.session.user.id);
  if (u?.muted_until > Date.now()) return res.status(403).json({error:"Вы замучены"});
  const created_at = Date.now();
  const info = db.prepare("INSERT INTO messages(user_id,body,created_at) VALUES(?,?,?)")
    .run(req.session.user.id, body, created_at);
  const msg = {id:Number(info.lastInsertRowid),body,created_at,username:req.session.user.username,role:req.session.user.role};
  io.emit("message:new", msg);
  res.json(msg);
});

app.delete("/api/messages/:id", moderator, (req,res) => {
  db.prepare("DELETE FROM messages WHERE id=?").run(req.params.id);
  io.emit("message:deleted", {id:Number(req.params.id)});
  res.json({ok:true});
});

const online = new Map();
io.use((socket,next) => {
  // Shared session is intentionally not wired here; client sends display identity.
  next();
});
io.on("connection", socket => {
  socket.on("presence:join", data => {
    const username = String(data?.username || "Гость");
    online.set(socket.id, username);
    io.emit("presence:list", [...new Set(online.values())]);
  });
  socket.on("disconnect", () => {
    online.delete(socket.id);
    io.emit("presence:list", [...new Set(online.values())]);
  });
});

app.use(express.static(root, { index: "index.html" }));
app.get("*", (_,res) => res.sendFile(path.join(root,"index.html")));

const port = Number(process.env.PORT || 3000);
httpServer.listen(port, "0.0.0.0", () => console.log(`Online site v23 online: http://localhost:${port}`));
