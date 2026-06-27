import { Room } from './room';
export { Room };

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- HTTP API ----
    if (path === '/api/create-room' && request.method === 'POST') {
      let roomCode;
      let playerId;
      for (let attempt = 0; attempt < 10; attempt++) {
        roomCode = generateRoomCode();
        const id = env.ROOM.idFromName(roomCode);
        const stub = env.ROOM.get(id);
        const req = new Request('http://dummy', { method: 'POST' });
        req.headers.set('X-DO-Action', 'init');
        const initRes = await stub.fetch(req);
        if (initRes.ok) {
          const data = await initRes.json();
          playerId = data.playerId;
          break;
        }
      }

      if (!playerId) {
        return new Response(JSON.stringify({ error: 'Could not create room. Try again.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      return new Response(JSON.stringify({ roomCode, playerId }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (path === '/api/join-room' && request.method === 'POST') {
      const { roomCode } = await request.json();
      if (!roomCode || roomCode.length !== 4) {
        return new Response(JSON.stringify({ error: 'Invalid room code.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      const id = env.ROOM.idFromName(roomCode);
      const stub = env.ROOM.get(id);
      const req = new Request('http://dummy', { method: 'GET' });
      req.headers.set('X-DO-Action', 'check');
      const joinRes = await stub.fetch(req);

      if (joinRes.status !== 200) {
        const { error } = await joinRes.json();
        return new Response(JSON.stringify({ error }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      const { playerId } = await joinRes.json();
      return new Response(JSON.stringify({ playerId, roomCode }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // ---- WebSocket ----
    if (path === '/ws') {
      const roomCode = url.searchParams.get('roomCode');
      const playerId = url.searchParams.get('playerId');

      if (!roomCode || !playerId) {
        return new Response('Missing roomCode or playerId', { status: 400 });
      }

      const id = env.ROOM.idFromName(roomCode);
      const stub = env.ROOM.get(id);

      const forwardReq = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
      forwardReq.headers.set('X-Room-Code', roomCode);
      forwardReq.headers.set('X-Player-Id', playerId);

      return stub.fetch(forwardReq);
    }

    // ---- Static assets (Workers Sites) ----
    return env.ASSETS.fetch(request);
  },
};
