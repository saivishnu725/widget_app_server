"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const app_1 = __importDefault(require("./app"));
const socketManager_1 = require("./sockets/socketManager");
const PORT = process.env.PORT || 3000;
const server = http_1.default.createServer(app_1.default);
// Setup Socket.io
(0, socketManager_1.setupSockets)(server);
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
exports.default = server;
