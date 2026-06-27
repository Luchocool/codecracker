# CodeCracker Project Structure

```
CodeCracker/
├── .git/
├── backend/
│   └── server.js              # OLD Express + Socket.IO server (replaced)
├── node_modules/               # dependencies (excluded)
├── public/
│   ├── client.js               # WebSocket client (Cloudflare)
│   ├── Emote.png
│   ├── google87f99cc2aa135cd3.html
│   ├── HomeLogo.png
│   ├── index.html              # No longer loads Socket.IO
│   ├── robots.txt
│   └── sitemap.xml
├── src/                        # NEW Cloudflare Workers code
│   ├── index.js                # Worker entry (HTTP + WebSocket routing)
│   └── room.js                 # Durable Object (game state per room)
├── wrangler.toml               # Cloudflare deployment config
├── Emote.png
├── HomeLogo.png
├── package-lock.json
├── package.json
├── qr-code.png
├── README.md
├── server.err
├── server.log
└── structure.md
```
