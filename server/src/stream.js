const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

const MAX_EVENTS = 100;
const eventBuffer = [];
let clientId = 0;
const clients = new Map();

function addEvent(eventType, data) {
  const entry = { eventType, data, timestamp: new Date().toISOString() };
  eventBuffer.unshift(entry);
  if (eventBuffer.length > MAX_EVENTS) eventBuffer.pop();

  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const [id, res] of clients) {
    try { res.write(payload); } catch { clients.delete(id); }
  }
}

function sseHandler(req, res) {
  res.writeHead(200, SSE_HEADERS);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  for (const event of eventBuffer.slice(0, 10).reverse()) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  const id = ++clientId;
  clients.set(id, res);
  req.on('close', () => clients.delete(id));
}

function recentEventsHandler(req, res) {
  res.json(eventBuffer.slice(0, 20));
}

module.exports = { addEvent, sseHandler, recentEventsHandler };
