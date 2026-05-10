import http from 'http';
import app from './app';
import { setupSockets } from './sockets/socketManager';

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

// Setup Socket.io
setupSockets(server);

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

export default server;
