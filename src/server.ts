import http from 'http';
import app from './app';
import { setupSockets } from './sockets/socketManager';
import { syncRedisToPostgres } from './services/syncService';

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

// Setup Socket.io
setupSockets(server);

// Setup Cron Job for Durability
// Runs every 5 minutes
setInterval(syncRedisToPostgres, 5 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

export default server;
