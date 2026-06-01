/**
 * server/websocket/broadcast.js
 *
 * Pequeño helper para emitir mensajes JSON a múltiples clientes
 * (con o sin filtrado por suscripción).
 */

const WebSocket = require('ws');

function sendTo(client, payload) {
  if (client.readyState !== WebSocket.OPEN) return;
  try {
    client.send(JSON.stringify(payload));
  } catch {
    // silencioso: si falla el client, ws se cerrará y se removerá
  }
}

/**
 * Emite a todos los clientes que pasen el predicado.
 * @param {Set|Iterable} clients
 * @param {object} payload
 * @param {(c: any) => boolean} [filter]
 */
function broadcast(clients, payload, filter) {
  for (const client of clients) {
    if (filter && !filter(client)) continue;
    sendTo(client, payload);
  }
}

module.exports = { broadcast, sendTo };
