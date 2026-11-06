import http from 'node:http';
import net from 'node:net';
import { getSettings } from './settings.js';
import { viaTunnel } from './network.js';

/**
 * A local HTTP proxy (CONNECT only) for tools that take an HTTP proxy but
 * not a SOCKS one (the Copilot runtime): a host the VPN routes (Settings ›
 * VPN) goes through the SOCKS tunnel, anything else straight out. Listens on
 * 127.0.0.1 only, on a port of its own, started on first use.
 */

let server: http.Server | null = null;
let port = 0;

function socksConnect(host: string, targetPort: number): Promise<net.Socket> {
  const { host: sh, port: sp } = getSettings().proxy;
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: sh, port: sp });
    let stage = 0;
    s.once('error', reject);
    s.setTimeout(20000, () => s.destroy(new Error('The VPN tunnel didn’t answer')));
    s.on('connect', () => s.write(Buffer.from([0x05, 0x01, 0x00])));
    const onData = (d: Buffer) => {
      if (stage === 0) {
        if (d[0] !== 0x05 || d[1] !== 0x00) return s.destroy(new Error('The VPN tunnel refused the connection'));
        stage = 1;
        const name = Buffer.from(host);
        const req = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, Buffer.from([targetPort >> 8, targetPort & 0xff])]);
        s.write(req);
      } else {
        if (d[1] !== 0x00) return s.destroy(new Error(`The VPN tunnel couldn’t reach ${host} (${d[1]})`));
        s.off('data', onData);
        s.setTimeout(0);
        s.removeListener('error', reject);
        resolve(s);
      }
    };
    s.on('data', onData);
  });
}

/** The bridge's address (http://127.0.0.1:port), started if it isn't yet. */
export async function socksBridge(): Promise<string> {
  if (server && port) return `http://127.0.0.1:${port}`;
  server = http.createServer((_req, res) => {
    res.writeHead(405).end('CONNECT only');
  });
  server.on('connect', (req, client, head) => {
    const [host, p] = (req.url ?? '').split(':');
    const target = Number(p) || 443;
    const open = viaTunnel(host) ? socksConnect(host, target) : new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect({ host, port: target }, () => resolve(s));
      s.once('error', reject);
    });
    open
      .then((up) => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) up.write(head);
        up.pipe(client);
        client.pipe(up);
        up.on('error', () => client.destroy());
        client.on('error', () => up.destroy());
      })
      .catch(() => {
        client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  port = (server.address() as net.AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

export function stopSocksBridge(): void {
  server?.close();
  server = null;
  port = 0;
}
