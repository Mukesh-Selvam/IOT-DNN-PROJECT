import { Aedes } from 'aedes';
import net from 'net';

const PORT = parseInt(process.env.MQTT_PORT || '1883', 10);
const aedes = new Aedes();
const server = net.createServer((socket) => aedes.handle(socket));

server.listen(PORT, function () {
  console.log(`[MQTT Broker] Embedded MQTT broker running on port ${PORT}`);
  console.log(`[MQTT Broker] Clients can connect via mqtt://localhost:${PORT}`);
});

aedes.on('client', function (client) {
  console.log(`[MQTT Broker] Client connected: ${client ? client.id : 'unknown'}`);
});

aedes.on('clientDisconnect', function (client) {
  console.log(`[MQTT Broker] Client disconnected: ${client ? client.id : 'unknown'}`);
});

process.on('SIGINT', () => {
  console.log('[MQTT Broker] Shutting down embedded broker...');
  server.close(() => {
    aedes.close(() => {
      process.exit(0);
    });
  });
});
