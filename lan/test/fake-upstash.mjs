// A stand-in for the Upstash REST API, for tests and the restart acceptance script only (never shipped as a store).
import http from 'node:http';

export async function fakeUpstash() {
  const db = new Map(); const log = []; const st = { down: false, calls: 0 };
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      st.calls++;
      if (req.headers.authorization !== 'Bearer tok-test') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
      if (st.down) { res.writeHead(503); return res.end('{"error":"down"}'); }
      const out = JSON.parse(body).map(([c, k, ...a]) => {
        log.push(c);
        if (c === 'RPUSH') { const l = db.get(k) ?? []; l.push(...a); db.set(k, l); return { result: l.length }; }
        if (c === 'LRANGE') return { result: [...(db.get(k) ?? [])] };
        if (c === 'RENAMENX') { if (!db.has(k)) return { result: 0 }; db.set(a[0], db.get(k)); db.delete(k); return { result: 1 }; }
        if (c === 'EVAL') {
          const [count, current, archive, ...lines] = a;
          if (db.has(archive)) {
            if (JSON.stringify(db.get(current)) !== JSON.stringify(lines)) return { error: 'reset confirmation mismatch' };
            return { result: 1 };
          }
          if (db.has(current)) { db.set(archive, [...db.get(current)]); db.delete(current); }
          db.set(current, [...lines]); return { result: 1 };
        }
        if (c === 'EXPIRE') return { result: 1 };
        if (c === 'PING') return { result: 'PONG' };
        return { error: `ERR unknown ${c}` };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${srv.address().port}`, db, log, st, close: () => new Promise((ok) => srv.close(ok)) };
}
