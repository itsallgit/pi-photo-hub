// events.js - the live event stream every viewer follows (R1): GET /api/events (Server-Sent
// Events). Each "state" event carries the full now-playing view, so a viewer that missed one
// catches up with the next; the browser reconnects by itself (retry 2 s).
const clients = new Map(); // res -> { role, since }

function handler(getView) {
    return (req, res) => {
        res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
        });
        res.write("retry: 2000\n\n");
        const role = String(req.query.role || "viewer").slice(0, 20);
        clients.set(res, { role, since: new Date().toISOString(), ip: req.socket.remoteAddress });
        send(res, "state", getView());
        req.on("close", () => clients.delete(res));
    };
}

function send(res, event, data) {
    try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { /* closed */ }
}

function broadcast(event, data) {
    for (const res of clients.keys()) send(res, event, data);
}

// Keep connections open through proxies and detect dead ones.
setInterval(() => { for (const res of clients.keys()) { try { res.write(": ping\n\n"); } catch { clients.delete(res); } } }, 20000).unref();

function viewers() {
    return [...clients.values()];
}

module.exports = { handler, broadcast, viewers };
