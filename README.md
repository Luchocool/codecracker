# CodeCracker 🔒

A real-time multiplayer code-cracking game built with Node.js, Socket.io, and Tailwind CSS. Two players face off — set a secret code, then take turns guessing each other's combination.

## How to Run

### 1. Install dependencies

```
npm install
```

### 2. Start the server

```
npm start
```

The server runs on `http://localhost:3000`.

### 3. Open the game

Open **two browser tabs** (or two devices on the same network) to `http://localhost:3000`.

- **Tab 1** → Click **PLAY** → **Create a Room** → share the 4-character code
- **Tab 2** → Click **PLAY** → type the code → **Join**

## How to Play

1. **Lobby** — Both players type their names (updates live). The host sets the code length (4/6/8 digits). Click **READY** — the game starts when both are ready.
2. **Set your code** — Use the rolling number dials (click arrows, scroll with mouse wheel, or click the number) to choose your secret combination, then click **SUBMIT**.
3. **Guess** — Once both codes are locked, take turns guessing. Each guess shows:
   - ● how many digits are **correct and in the right position**
   - ● how many digits are **correct but in the wrong position**
4. **Win** — First to guess the opponent's code exactly wins.

## Project Structure

```
├── server.js          Express + Socket.io backend
├── package.json       
├── public/
│   ├── index.html     Frontend HTML + Tailwind CSS
│   └── client.js      Client-side Socket.io logic
```

## Tech Stack

- **Backend:** Node.js, Express, Socket.io
- **Frontend:** HTML5, CSS3, Tailwind CSS (CDN), Socket.io client (CDN)
