/**
 * Minimal headless-Chrome harness for layout tests: loads static HTML into the same Chrome build Remotion renders
 * with and measures where each character is actually painted. Talks CDP over Node's built-in WebSocket, so the
 * test needs no extra dependencies. Returns null when no browser binary is configured (the tests then skip).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Painted box of one UTF-16 code unit of the element's text, in document order (no-break space reported as ' '). */
export interface CharBox {
  ch: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function browserExecutable(): string | undefined {
  let exe = process.env.KAMPORA_TEST_BROWSER ?? process.env.REMOTION_BROWSER_EXECUTABLE;
  if (!exe) {
    // Read only this one key from the repo .env (the same binary the render worker uses).
    let dir = process.cwd();
    while (!existsSync(join(dir, '.env')) && resolve(dir, '..') !== dir) dir = resolve(dir, '..');
    const envFile = join(dir, '.env');
    if (existsSync(envFile)) {
      const line = readFileSync(envFile, 'utf8')
        .split(/\r?\n/)
        .find((l) => l.startsWith('REMOTION_BROWSER_EXECUTABLE='));
      exe = line?.slice('REMOTION_BROWSER_EXECUTABLE='.length).trim();
    }
  }
  return exe && existsSync(exe) ? exe : undefined;
}

export class ChromeLayout {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private listeners: Array<(method: string) => void> = [];
  private sessionId = '';
  private readonly proc: ChildProcess;
  private readonly ws: WebSocket;
  private readonly profileDir: string;

  private constructor(proc: ChildProcess, ws: WebSocket, profileDir: string) {
    this.proc = proc;
    this.ws = ws;
    this.profileDir = profileDir;
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        result?: unknown;
        error?: { message: string };
      };
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p?.reject(new Error(msg.error.message));
        else p?.resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg.method);
      }
    });
  }

  static async launch(): Promise<ChromeLayout | null> {
    const exe = browserExecutable();
    if (!exe) return null;
    const profileDir = mkdtempSync(join(tmpdir(), 'kampora-layout-'));
    const proc = spawn(
      exe,
      [
        '--headless',
        '--disable-gpu',
        '--no-first-run',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const wsUrl = await new Promise<string>((resolveUrl, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('Chrome did not start')), 20_000);
      proc.stderr!.on('data', (d: Buffer) => {
        buf += d.toString();
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) {
          clearTimeout(timer);
          resolveUrl(m[1]!);
        }
      });
      proc.on('exit', () => reject(new Error(`Chrome exited: ${buf.slice(0, 300)}`)));
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', fail, { once: true });
    });
    const chrome = new ChromeLayout(proc, ws, profileDir);
    const { targetId } = (await chrome.send('Target.createTarget', { url: 'about:blank' })) as {
      targetId: string;
    };
    const { sessionId } = (await chrome.send('Target.attachToTarget', { targetId, flatten: true })) as {
      sessionId: string;
    };
    chrome.sessionId = sessionId;
    await chrome.send('Page.enable');
    await chrome.send('Emulation.setDeviceMetricsOverride', {
      width: 1080,
      height: 1920,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return chrome;
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    const msg: Record<string, unknown> = { id, method, params };
    if (this.sessionId) msg.sessionId = this.sessionId;
    return new Promise((ok, fail) => {
      this.pending.set(id, { resolve: ok, reject: fail });
      this.ws.send(JSON.stringify(msg));
    });
  }

  /** Replaces the page with `bodyHtml` (wrapped in a UTF-8 1080×1920 document) and waits for load. */
  async setBody(bodyHtml: string): Promise<void> {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;width:1080px;font-family:Arial,sans-serif}</style></head><body>${bodyHtml}</body></html>`;
    const loaded = new Promise<void>((ok) => {
      const l = (method: string) => {
        if (method === 'Page.loadEventFired') {
          this.listeners = this.listeners.filter((x) => x !== l);
          ok();
        }
      };
      this.listeners.push(l);
    });
    await this.send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` });
    await loaded;
  }

  /** Painted box of every character inside the first element matching `selector`. */
  async charBoxes(selector: string): Promise<CharBox[]> {
    const expression = `(() => {
      const root = document.querySelector(${JSON.stringify(selector)});
      if (!root) throw new Error('no element for selector');
      const out = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (let i = 0; i < node.data.length; i++) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          const ch = node.data[i] === String.fromCharCode(160) ? ' ' : node.data[i];
          out.push({ ch, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        }
      }
      return out;
    })()`;
    const res = (await this.send('Runtime.evaluate', { expression, returnByValue: true })) as {
      result: { value: CharBox[] };
      exceptionDetails?: { text: string };
    };
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
    return res.result.value;
  }

  async close(): Promise<void> {
    const exited = new Promise((r) => {
      if (this.proc.exitCode !== null) r(undefined);
      else this.proc.once('exit', r);
    });
    try {
      await this.send('Browser.close');
    } catch {
      // already gone
    }
    this.ws.close();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    this.proc.kill();
    try {
      rmSync(this.profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Windows can keep the profile locked briefly after Chrome exits; it is only a temp dir.
    }
  }
}

interface Placed {
  token: string;
  line: number;
  center: number;
}

/**
 * The tokens of `text` (split on spaces, as written) in the order a Hebrew reader sees them on screen:
 * top line first, and right-to-left within a line. Correct RTL rendering of a Hebrew sentence returns the
 * tokens in their written order.
 */
export function visualOrderRtl(boxes: CharBox[], tokens?: string[]): string[] {
  const text = boxes.map((b) => b.ch).join('');
  const wanted = tokens ?? text.split(/[ \n\t]+/).filter(Boolean);
  const lineTops: number[] = [];
  const lineOf = (top: number) => {
    let idx = lineTops.findIndex((t) => Math.abs(t - top) < 20);
    if (idx < 0) {
      lineTops.push(top);
      idx = lineTops.length - 1;
    }
    return idx;
  };
  const placed: Placed[] = [];
  let from = 0;
  for (const token of wanted) {
    const at = text.indexOf(token, from);
    if (at < 0) throw new Error(`token "${token}" not found in "${text}"`);
    from = at + token.length;
    const own = boxes.slice(at, at + token.length).filter((b) => b.right > b.left);
    const left = Math.min(...own.map((b) => b.left));
    const right = Math.max(...own.map((b) => b.right));
    placed.push({ token, line: lineOf(own[0]!.top), center: (left + right) / 2 });
  }
  const order = [...lineTops.keys()].sort((a, b) => lineTops[a]! - lineTops[b]!);
  return placed
    .sort((a, b) => order.indexOf(a.line) - order.indexOf(b.line) || b.center - a.center)
    .map((p) => p.token);
}

/** The characters of `run` (a substring of the text) in on-screen left-to-right order. */
export function leftToRight(boxes: CharBox[], run: string): string {
  const text = boxes.map((b) => b.ch).join('');
  const at = text.indexOf(run);
  if (at < 0) throw new Error(`"${run}" not found in "${text}"`);
  return boxes
    .slice(at, at + run.length)
    .slice()
    .sort((a, b) => a.left - b.left)
    .map((b) => b.ch)
    .join('');
}

/** Horizontal center of the first occurrence of `run`. */
export function centerOf(boxes: CharBox[], run: string): number {
  const text = boxes.map((b) => b.ch).join('');
  const at = text.indexOf(run);
  if (at < 0) throw new Error(`"${run}" not found in "${text}"`);
  const own = boxes.slice(at, at + run.length);
  return (Math.min(...own.map((b) => b.left)) + Math.max(...own.map((b) => b.right))) / 2;
}

/** Whether every painted character of `run` sits on one line. */
export function sameLine(boxes: CharBox[], run: string): boolean {
  const text = boxes.map((b) => b.ch).join('');
  const at = text.indexOf(run);
  if (at < 0) throw new Error(`"${run}" not found in "${text}"`);
  return lineCount(boxes.slice(at, at + run.length)) === 1;
}

/** Number of distinct painted lines. */
export function lineCount(boxes: CharBox[]): number {
  const tops: number[] = [];
  for (const b of boxes)
    if (b.right > b.left && !tops.some((t) => Math.abs(t - b.top) < 20)) tops.push(b.top);
  return tops.length;
}
