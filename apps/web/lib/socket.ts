'use client';
import { io, Socket } from 'socket.io-client';
import { ServerToClientEvents, ClientToServerEvents } from '@agenttrade/types';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:8080', {
      transports: ['websocket'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      autoConnect: true,
    });

    socket.on('connect', () => {
      const token = localStorage.getItem('at_token');
      const userId = localStorage.getItem('at_user_id');
      if (userId) socket?.emit('subscribe', userId);
    });
  }
  return socket;
}
