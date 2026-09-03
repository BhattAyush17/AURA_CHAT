const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("no page target");
const wsUrl = page.webSocketDebuggerUrl;

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) rej(new Error(JSON.stringify(m.error)));
    else res(m.result);
  }
};
export function send(method, params = {}) {
  const mid = ++id;
  return new Promise((res, rej) => {
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
export async function pageWs() {
  return { ws, send };
}
