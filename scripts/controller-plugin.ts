import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {resolve} from 'node:path';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {Plugin} from 'vite';

export function isLocalControllerRequest(req: Pick<IncomingMessage, 'headers' | 'socket'>): boolean {
  const address = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '')) return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) return false;
    if (req.headers.origin && new URL(req.headers.origin).host !== host.host) return false;
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    return true;
  } catch {
    return false;
  }
}
export function macControllerPlugin(): Plugin {
  const clients = new Set<ServerResponse>();
  let child: ChildProcessWithoutNullStreams | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const send = (data: string) => {
    for (const response of clients) if (!response.write(`data: ${data}\n\n`)) response.destroy();
  };
  const stop = () => {
    if (stopTimer) clearTimeout(stopTimer);
    child?.kill();
    child = null;
  };
  const start = (root: string) => {
    if (child) return;
    const process = spawn('/usr/bin/swift', [resolve(root, 'scripts/mac-controller.swift')], {stdio: 'pipe'});
    child = process;
    let buffer = '';
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          if (Array.isArray(JSON.parse(line))) send(line);
        } catch {}
      }
    });
    process.stderr.on('data', () => {});
    const lost = () => {
      if (child !== process) return;
      child = null;
      for (const client of clients) client.end();
      clients.clear();
    };
    process.on('error', lost);
    process.on('exit', lost);
  };
  return {
    name: 'local-macos-controller',
    configureServer(server) {
      server.middlewares.use('/__controller/events', (req, res, next) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (!isLocalControllerRequest(req)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (process.platform !== 'darwin') {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(': controller connection\n\n');
        if (stopTimer) clearTimeout(stopTimer);
        clients.add(res);
        start(server.config.root);
        res.on('close', () => {
          clients.delete(res);
          if (!clients.size) stopTimer = setTimeout(stop, 1000);
        });
      });
      server.httpServer?.once('close', () => {
        stop();
        for (const client of clients) client.end();
        clients.clear();
      });
    },
  };
}
