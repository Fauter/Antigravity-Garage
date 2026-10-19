/**
 * OpsLogger — the single logging pipeline for GarageIA.
 *
 * TWO sinks, deliberately separate:
 *
 *   HUMAN CONSOLE   compact, one line per event:  `HH:mm:ss  AREA      message`
 *                   filtered by GARAGEIA_LOG_LEVEL (error|warn|info|debug|trace, default info).
 *                   WARN and ERROR are ALWAYS printed, whatever the configured level.
 *
 *   STRUCTURED FILES (never filtered by level, so reducing console noise never loses data)
 *       ops.log      JSON Lines, one record per event, ISO-UTC timestamps, full detail
 *                    (counts, durations, ids, http status, error code/message/stack, details).
 *       startup.log  human lifecycle log: STARTUP/DB/UI at INFO+ and every WARN/ERROR.
 *
 * A call decides its sinks via `sink`:
 *   'consoleAndFile' (default)  human line on console + record in files
 *   'fileOnly'                  record in files only (e.g. SYNC_START/SYNC_SUCCESS, which are
 *                               forensic markers whose human counterpart is a different call)
 *
 * Invariants (covered by tests/logging-*.test.ts):
 *   - one call prints at most ONE console line (plus indented stack at DEBUG/TRACE),
 *   - secrets never reach any sink (see sanitizeText / sanitizeValue),
 *   - a failure inside the logger is contained and never propagates to the app,
 *   - logging has no side effects on application state.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/** Standard console areas. LEGACY is transitional: it labels un-migrated console.* output captured by the bridge. */
export const LOG_AREAS = [
    'STARTUP', 'DB', 'UI', 'AUTH', 'SYNC', 'NETWORK', 'ENTRY', 'EXIT', 'PAYMENT',
    'CORREL', 'HARDWARE', 'PRINT', 'HTTP', 'ERROR', 'LEGACY',
] as const;
export type LogArea = typeof LOG_AREAS[number] | (string & {});

export type LogSink = 'consoleAndFile' | 'fileOnly';

export interface LogFields {
    /** Structured operation name stored as `operation` in ops.log (e.g. SYNC_SUCCESS, APP_START). */
    event?: string;
    status?: 'START' | 'SUCCESS' | 'FAIL';
    sink?: LogSink;
    operationId?: string;
    garageId?: string;
    terminalId?: string;
    plate?: string;
    durationMs?: number;
    httpStatus?: number;
    counts?: Record<string, number>;
    onlineState?: string;
    remoteApiState?: string;
    dbState?: string;
    leaseRemaining?: number;
    errorCode?: string;
    errorMessage?: string;
    stack?: string;
    /** An Error (or error-like object). Promoted to errorMessage/errorCode/stack. */
    error?: unknown;
    /** Print the stack on the console even at INFO (reserved for fatal crashes). */
    showStack?: boolean;
    /** Anything else lands in `details` (sanitized). */
    [key: string]: unknown;
}

export interface LogRecord {
    timestamp: string;
    level: LogLevel;
    area: LogArea;
    message: string;
    operation?: string;
    status?: string;
    operationId?: string;
    garageId?: string;
    terminalId: string;
    plate?: string;
    durationMs?: number;
    httpStatus?: number;
    counts?: Record<string, number>;
    onlineState?: string;
    remoteApiState?: string;
    dbState?: string;
    leaseRemaining?: number;
    errorCode?: string;
    errorMessage?: string;
    stack?: string;
    appVersion: string;
    details?: Record<string, unknown>;
    truncated?: boolean;
}

const LEVEL_RANK: Record<LogLevel, number> = { TRACE: 10, DEBUG: 20, INFO: 30, WARN: 40, ERROR: 50 };

// ─── Sanitization ────────────────────────────────────────────────────────────

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /(password|passwd|passcode|pwd|secret|authorization|cookie|api[-_]?key|anon[-_]?key|service[-_]?role|(access|refresh|id|auth|bearer|session)[-_]?token|private[-_]?key|credential)/i;
const SENSITIVE_KEY_EXACT = /^(pin|pin[-_]?code|token|jwt|otp)$/i;

export function isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEY.test(key) || SENSITIVE_KEY_EXACT.test(key);
}

/** Redacts secrets embedded in free text (messages, stacks, URLs, header dumps, JSON fragments). */
export function sanitizeText(text: string | undefined): string | undefined {
    if (!text) return text;
    let s = String(text);
    s = s.replace(/\b(Set-Cookie|Cookie)\s*:\s*[^\r\n]*/gi, `$1: ${REDACTED}`);
    s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, `$1 ${REDACTED}`);
    s = s.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[REDACTED_JWT]');
    s = s.replace(/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g, '[REDACTED_SUPABASE_KEY]');
    s = s.replace(
        /\b(apikey|api_key|anon_key|service_role_key|access_token|refresh_token|id_token|token|password|passwd|pwd|pin|secret|authorization)\b(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;"'}\]]+)/gi,
        `$1$2${REDACTED}`,
    );
    s = s.replace(/(https?:\/\/)([^:@\s/]+:[^:@\s/]+)@/gi, `$1${REDACTED}:${REDACTED}@`);
    return s;
}

const MAX_STRING = 16_000;
const MAX_DEPTH = 8;

/** Structural sanitizer: safe for Errors, circular graphs, buffers; redacts by key name and by text content. */
export function sanitizeValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
    if (value === null || value === undefined) return value;
    const t = typeof value;
    if (t === 'string') {
        const s = sanitizeText(value as string) as string;
        return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…[truncated ${s.length - MAX_STRING} chars]` : s;
    }
    if (t === 'number' || t === 'boolean') return value;
    if (t === 'bigint') return String(value);
    if (t === 'function') return '[Function]';
    if (t === 'symbol') return String(value);
    if (value instanceof Date) return isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return `[binary ${value.length} bytes]`;
    if (value instanceof Uint8Array) return `[binary ${value.length} bytes]`;
    if (depth >= MAX_DEPTH) return '[MaxDepth]';

    const obj = value as object;
    if (seen.has(obj)) return '[Circular]';
    seen.add(obj);

    if (Array.isArray(obj)) {
        const out = obj.slice(0, 200).map((v) => sanitizeValue(v, depth + 1, seen));
        if (obj.length > 200) out.push(`[+${obj.length - 200} more items]`);
        return out;
    }
    if (obj instanceof Map) return sanitizeValue(Object.fromEntries(obj as Map<any, any>), depth + 1, seen);
    if (obj instanceof Set) return sanitizeValue(Array.from(obj as Set<any>), depth + 1, seen);

    const out: Record<string, unknown> = {};
    if (obj instanceof Error) {
        out.name = obj.name;
        out.message = sanitizeText(obj.message);
        if (obj.stack) out.stack = sanitizeText(obj.stack);
        if ((obj as any).cause !== undefined) out.cause = sanitizeValue((obj as any).cause, depth + 1, seen);
    }
    let n = 0;
    for (const key of Object.keys(obj)) {
        if (n++ >= 100) { out['[+more keys]'] = true; break; }
        out[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue((obj as any)[key], depth + 1, seen);
    }
    return out;
}

interface ErrorParts { message?: string; code?: string; stack?: string }

function extractError(err: unknown): ErrorParts {
    if (err === null || err === undefined) return {};
    if (typeof err === 'string') return { message: err };
    if (typeof err === 'object') {
        const e = err as any;
        return {
            message: typeof e.message === 'string' ? e.message : (() => { try { return JSON.stringify(sanitizeValue(e)); } catch { return String(e); } })(),
            code: e.code !== undefined && e.code !== null ? String(e.code) : undefined,
            stack: typeof e.stack === 'string' ? e.stack : undefined,
        };
    }
    return { message: String(err) };
}

// ─── Rotating file ───────────────────────────────────────────────────────────

class RotatingFile {
    constructor(
        public readonly filePath: string,
        private readonly maxBytes: number,
        private readonly maxHistory: number,
    ) {}

    append(line: string): void {
        this.ensureDir();
        this.rotateIfNeeded();
        fs.appendFileSync(this.filePath, line + '\n', 'utf8');
    }

    private ensureDir(): void {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    private historyPath(i: number): string {
        if (i === 0) return this.filePath;
        const ext = path.extname(this.filePath);
        return this.filePath.slice(0, this.filePath.length - ext.length) + `.${i}${ext}`;
    }

    private rotateIfNeeded(): void {
        let size = 0;
        try { size = fs.statSync(this.filePath).size; } catch { return; }
        if (size < this.maxBytes) return;

        try { if (fs.existsSync(this.historyPath(this.maxHistory))) fs.unlinkSync(this.historyPath(this.maxHistory)); } catch { /* best effort */ }
        for (let i = this.maxHistory - 1; i >= 0; i--) {
            const from = this.historyPath(i);
            const to = this.historyPath(i + 1);
            if (!fs.existsSync(from)) continue;
            try {
                if (fs.existsSync(to)) fs.unlinkSync(to);
                fs.renameSync(from, to);
            } catch {
                if (i === 0) return; // could not move the active log: keep appending to it rather than lose data
            }
        }
    }
}

// ─── Logger ──────────────────────────────────────────────────────────────────

type Writer = (line: string) => void;

export interface OpsLoggerOptions {
    logsDir?: string;
    env?: NodeJS.ProcessEnv;
    stdout?: Writer;
    stderr?: Writer;
    now?: () => Date;
    maxFileBytes?: number;
    maxHistory?: number;
}

const MAX_RECORD_BYTES = 64 * 1024;
const LIFECYCLE_AREAS: ReadonlySet<LogArea> = new Set<LogArea>(['STARTUP', 'DB', 'UI']);

export function resolveLogsDir(env: NodeJS.ProcessEnv = process.env): string {
    if (env.GARAGEIA_LOG_DIR) return env.GARAGEIA_LOG_DIR;
    // Automated tests must never pollute the operator's real logs.
    if (env.NODE_ENV === 'test' || env.VITEST) return path.join(os.tmpdir(), 'garageia-test-logs');
    if (env.APPDATA) return path.join(env.APPDATA, 'GarageIA', 'logs');
    return path.join(process.cwd(), '.data', 'logs');
}

export class OpsLoggerImpl {
    private readonly env: NodeJS.ProcessEnv;
    private readonly out: Writer;
    private readonly err: Writer;
    private readonly now: () => Date;
    private readonly opts: OpsLoggerOptions;
    private opsFile?: RotatingFile;
    private startupFile?: RotatingFile;
    private internalFailureReported = false;
    private appVersion?: string;
    private terminalId?: string;

    constructor(opts: OpsLoggerOptions = {}) {
        this.opts = opts;
        this.env = opts.env ?? process.env;
        this.now = opts.now ?? (() => new Date());
        // Bind directly to process.stdout/stderr to bypass any previous console.* wrappers (e.g. main.js)
        this.out = opts.stdout ?? ((l) => process.stdout.write(l + '\n'));
        this.err = opts.stderr ?? ((l) => process.stderr.write(l + '\n'));
    }

    /** Process-wide context (call once at boot). */
    setContext(ctx: { appVersion?: string; terminalId?: string }): void {
        if (ctx.appVersion) this.appVersion = ctx.appVersion;
        if (ctx.terminalId) this.terminalId = ctx.terminalId;
    }

    get logsDir(): string { return this.opts.logsDir ?? resolveLogsDir(this.env); }
    get opsLogPath(): string { return path.join(this.logsDir, 'ops.log'); }
    get startupLogPath(): string { return path.join(this.logsDir, 'startup.log'); }

    /** Effective console threshold. WARN/ERROR can never be hidden, so the threshold is capped at WARN. */
    consoleThreshold(): number {
        const raw = String(this.env.GARAGEIA_LOG_LEVEL || 'info').trim().toUpperCase() as LogLevel;
        const rank = LEVEL_RANK[raw] ?? LEVEL_RANK.INFO;
        return Math.min(rank, LEVEL_RANK.WARN);
    }

    // Public API ---------------------------------------------------------------
    trace(area: LogArea, message: string, fields?: LogFields) { this.log('TRACE', area, message, fields); }
    debug(area: LogArea, message: string, fields?: LogFields) { this.log('DEBUG', area, message, fields); }
    infoText(area: LogArea, message: string, fields?: LogFields) { this.log('INFO', area, message, fields); }
    warnText(area: LogArea, message: string, fields?: LogFields) { this.log('WARN', area, message, fields); }
    errorText(area: LogArea, message: string, fields?: LogFields) { this.log('ERROR', area, message, fields); }
    
    // Legacy aliases to support older signatures: info(message), info(message, fields), info(fields)
    info(a1: string | LogFields, a2?: string | LogFields, a3?: LogFields) { this.legacyRoute('INFO', a1, a2, a3); }
    warn(a1: string | LogFields, a2?: string | LogFields, a3?: LogFields) { this.legacyRoute('WARN', a1, a2, a3); }
    error(a1: string | LogFields, a2?: string | LogFields, a3?: LogFields) { this.legacyRoute('ERROR', a1, a2, a3); }

    private legacyRoute(level: LogLevel, a1: string | LogFields, a2?: string | LogFields, a3?: LogFields) {
        if (typeof a1 === 'object') {
            const fields = a1 as LogFields;
            this.log(level, 'LEGACY', fields.event || (fields.operation as string) || 'OP', fields); // fields only
        } else if (typeof a2 === 'string') {
            this.log(level, a1, a2, a3); // area, message, fields
        } else {
            this.log(level, 'LEGACY', a1, a2 as LogFields); // message, fields
        }
    }

    log(level: LogLevel, area: LogArea, message: string, fields: LogFields = {}): void {
        let rec: LogRecord;
        try {
            rec = this.buildRecord(level, area, message, fields);
        } catch (e) {
            this.reportInternal(e);
            return;
        }
        // Each sink is isolated: one failing never blocks the others, none can throw into the caller.
        try { this.writeOps(rec); } catch (e) { this.reportInternal(e); }
        try { this.writeStartup(rec); } catch (e) { this.reportInternal(e); }
        if (fields.sink !== 'fileOnly') {
            try { this.writeConsole(rec, !!fields.showStack); } catch (e) { this.reportInternal(e); }
        }
    }

    // Record construction ------------------------------------------------------
    private buildRecord(level: LogLevel, area: LogArea, message: string, fields: LogFields): LogRecord {
        const {
            event, status, sink: _sink, showStack: _showStack, operationId, garageId, terminalId, plate, durationMs, httpStatus,
            counts, onlineState, remoteApiState, dbState, leaseRemaining, errorCode, errorMessage, stack, error, err, ...rest
        } = fields as Record<string, any>;

        const parts = extractError(error ?? err);
        const details = Object.keys(rest).length ? (sanitizeValue(rest) as Record<string, unknown>) : undefined;

        const rec: LogRecord = {
            timestamp: this.now().toISOString(),
            level,
            area,
            message: sanitizeText(String(message)) as string,
            operation: event,
            status,
            operationId,
            garageId,
            terminalId: terminalId ?? this.terminalId ?? this.env.TERMINAL_ID ?? 'terminal_default',
            plate,
            durationMs,
            httpStatus,
            counts: counts as any,
            onlineState,
            remoteApiState,
            dbState,
            leaseRemaining,
            errorCode: errorCode ?? parts.code,
            errorMessage: sanitizeText(errorMessage ?? parts.message),
            stack: sanitizeText(stack ?? parts.stack),
            appVersion: this.appVersion ?? this.env.npm_package_version ?? 'unknown',
            details,
        };
        return rec;
    }

    // Sinks --------------------------------------------------------------------
    private files() {
        if (!this.opsFile) {
            const max = this.opts.maxFileBytes ?? 10 * 1024 * 1024;
            const hist = this.opts.maxHistory ?? 3;
            this.opsFile = new RotatingFile(this.opsLogPath, max, hist);
            this.startupFile = new RotatingFile(this.startupLogPath, Math.min(max, 5 * 1024 * 1024), hist);
        }
        return { ops: this.opsFile!, startup: this.startupFile! };
    }

    /** ops.log: EVERY record, every level. */
    private writeOps(rec: LogRecord): void {
        let line = JSON.stringify(rec);
        if (Buffer.byteLength(line) > MAX_RECORD_BYTES) {
            // Keep the identifying/forensic fields, shrink only the bulky free-form details.
            line = JSON.stringify({ ...rec, details: { note: 'details dropped: record exceeded size cap' }, truncated: true });
        }
        this.files().ops.append(line);
    }

    /** startup.log: compact human lifecycle log (STARTUP/DB/UI at INFO+, any WARN/ERROR). */
    private writeStartup(rec: LogRecord): void {
        const important = LEVEL_RANK[rec.level] >= LEVEL_RANK.WARN || (LIFECYCLE_AREAS.has(rec.area) && LEVEL_RANK[rec.level] >= LEVEL_RANK.INFO);
        if (!important) return;
        const lvl = rec.level.padEnd(5);
        const err = rec.errorMessage ? ` · ${rec.errorMessage}${rec.errorCode ? ` (${rec.errorCode})` : ''}` : '';
        this.files().startup.append(`[${rec.timestamp}] ${lvl} ${rec.area.padEnd(8)} ${rec.message}${err}`);
    }

    private hhmmss(): string {
        const d = this.now();
        const p = (n: number) => String(n).padStart(2, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }

    private writeConsole(rec: LogRecord, showStack: boolean): void {
        const rank = LEVEL_RANK[rec.level];
        const threshold = this.consoleThreshold();
        if (rank < threshold) return;

        const verbose = threshold <= LEVEL_RANK.DEBUG;
        const tag = rec.level === 'ERROR' ? 'ERR · ' : rec.level === 'WARN' ? 'WARN · ' : '';
        const errPart = rec.errorMessage ? ` · ${rec.errorMessage}${rec.errorCode ? ` (${rec.errorCode})` : ''}` : '';
        const detail = verbose ? this.compactDetail(rec, threshold <= LEVEL_RANK.TRACE ? 2000 : 240) : '';
        const line = `${this.hhmmss()}  ${rec.area.padEnd(8)}  ${tag}${rec.message}${errPart}${detail}`;

        const write = rank >= LEVEL_RANK.WARN ? this.err : this.out;
        write(line);
        if (rec.stack && (verbose || showStack)) {
            write(rec.stack.split('\n').map((l) => '            ' + l.trim()).join('\n'));
        }
    }

    private compactDetail(rec: LogRecord, maxLen: number): string {
        const kv: string[] = [];
        const add = (k: string, v: unknown) => {
            if (v === undefined) return;
            let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
            if (s.length > maxLen) s = s.slice(0, maxLen) + '…';
            kv.push(`${k}=${s}`);
        };
        add('op', rec.operation);
        add('garageId', rec.garageId);
        add('plate', rec.plate);
        add('durationMs', rec.durationMs);
        add('http', rec.httpStatus);
        if (rec.counts) for (const [k, v] of Object.entries(rec.counts)) add(k, v);
        if (rec.details) for (const [k, v] of Object.entries(rec.details)) add(k, v);
        return kv.length ? ' · ' + kv.join(' ') : '';
    }

    private reportInternal(e: unknown): void {
        if (this.internalFailureReported) return;
        this.internalFailureReported = true; // once only: a broken logger must not flood or recurse
        try { this.err(`${this.hhmmss()}  ERROR     logger internal failure (logging degraded): ${(e as any)?.message ?? e}`); } catch { /* nothing left to do */ }
    }

    // Legacy bridge -------------------------------------------------------------
    /**
     * Routes un-migrated console.* calls through the same pipeline so they are captured in the files,
     * rendered uniformly, and level-filtered: log/info/debug -> DEBUG, warn -> WARN, error -> ERROR
     * (WARN/ERROR therefore stay visible). Idempotent.
     */
    installConsoleBridge(): void {
        const c = console as any;
        if (c.__garageBridgeInstalled) return;
        c.__garageBridgeInstalled = true;
        const fmt = (args: unknown[]) => args.map((a) => {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return a.stack || a.message;
            try { return JSON.stringify(sanitizeValue(a)); } catch { return String(a); }
        }).join(' ');
        const route = (level: LogLevel) => (...args: unknown[]) => {
            const firstErr = args.find((a) => a instanceof Error) as Error | undefined;
            this.log(level, 'LEGACY', fmt(args.filter((a) => a !== firstErr)), firstErr ? { error: firstErr } : {});
        };
        c.log = route('DEBUG');
        c.info = route('DEBUG');
        c.debug = route('TRACE');
        c.warn = route('WARN');
        c.error = route('ERROR');
    }
}

export const OpsLogger = new OpsLoggerImpl();
