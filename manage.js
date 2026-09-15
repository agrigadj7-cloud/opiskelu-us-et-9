import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const db=new Database(path.join(__dirname,"site.db"));
const [cmd,...args]=process.argv.slice(2);
const usage=`Komennot:\n  npm run admin -- list\n  npm run admin -- creator USER PASSWORD\n  npm run admin -- admin USER\n  npm run admin -- moderator USER\n  npm run admin -- user USER\n  npm run admin -- password USER NEWPASSWORD\n  npm run admin -- delete USER`;
function user(name){return db.prepare("SELECT id,username,role FROM users WHERE username=?").get(name)}
if(cmd==="list"){
  for(const u of db.prepare("SELECT id,username,role,muted_until,created_at FROM users ORDER BY id").all()) console.log(`${u.id}\t${u.username}\t${u.role}${u.muted_until>Date.now()?"\tMUTED":""}`);
}else if(["creator","admin","moderator","user"].includes(cmd)){
  const name=args[0]; if(!name){console.log(usage);process.exit(1)}
  const u=user(name); if(!u){console.error("Käyttäjää ei löydy:",name);process.exit(1)}
  if(cmd==="creator" && args[1]){const hash=await bcrypt.hash(args[1],12);db.prepare("UPDATE users SET password_hash=?,role='creator' WHERE id=?").run(hash,u.id);console.log(`Valmis: ${name} -> creator`)}
  else {db.prepare("UPDATE users SET role=? WHERE id=?").run(cmd,u.id);console.log(`Valmis: ${name} -> ${cmd}`)}
}else if(cmd==="password"){
  const u=user(args[0]), pw=args[1]; if(!u||!pw||pw.length<8){console.log(usage);process.exit(1)}
  const hash=await bcrypt.hash(pw,12);db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash,u.id);console.log(`Salasana vaihdettu: ${u.username}`);
}else if(cmd==="delete"){
  const u=user(args[0]); if(!u){console.error("Käyttäjää ei löydy");process.exit(1)}
  if(u.role==="creator"){console.error("Luojan poistaminen on estetty");process.exit(1)}
  db.prepare("DELETE FROM users WHERE id=?").run(u.id);console.log(`Poistettu: ${u.username}`);
}else console.log(usage);
