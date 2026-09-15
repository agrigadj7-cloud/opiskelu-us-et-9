# Opiskelu US & ET — V21 Base Plus

This build uses the **V21 site/UI and study material as the base**, then adds the server-backed functions from later versions.

## Included
- V21 study interface, chapters, tasks, theme, forum layout and comments UI
- Server-backed registration/login/logout
- SQLite user database
- Roles: user, moderator, admin, creator
- Server-backed forum and comments
- Moderation: delete forum posts/comments, mute/unmute users
- Creator account management: role changes, password changes, account deletion
- Messages API and Socket.IO realtime events/presence support
- Docker + Render configuration for internet hosting

## Local start
```powershell
npm.cmd install
npm.cmd install-scripts approve better-sqlite3
npm.cmd rebuild better-sqlite3
npm.cmd start
```
Then open http://localhost:3000

## Console administration
```powershell
npm.cmd run admin -- list
npm.cmd run admin -- creator USER PASSWORD
npm.cmd run admin -- admin USER
npm.cmd run admin -- moderator USER
npm.cmd run admin -- user USER
npm.cmd run admin -- password USER NEWPASSWORD
npm.cmd run admin -- delete USER
```

Set `SESSION_SECRET`, `CREATOR_USER`, `CREATOR_PASS`, `BLACK_PASS`, and `WHITE_PASS` in production.
