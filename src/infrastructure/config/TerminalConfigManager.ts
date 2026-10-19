
import fs from "fs";
import path from "path";
import { DATA_DIR } from "../database/datastore.js";

export interface TerminalConfig {
    garage_id: string;
    owner_id: string;
    name: string;
    address: string;
    configured_at?: string;
}

export type TerminalConfigStatus = 'VALID' | 'UNCONFIGURED' | 'CORRUPT';

export interface TerminalConfigState {
    status: TerminalConfigStatus;
    config: TerminalConfig | null;
    source: 'PRIMARY' | 'BACKUP' | 'NONE';
    error?: string;
}

export class TerminalConfigManager {
    private static getConfigPath(): string {
        const isTestEnv = Boolean(process.env.NODE_ENV === 'test' || process.env.VITEST);
        const baseDir = isTestEnv ? path.join(DATA_DIR, 'test') : DATA_DIR;
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        return path.join(baseDir, "terminal-config.json");
    }

    private static getBackupConfigPath(): string {
        return this.getConfigPath() + ".bak";
    }

    private static isValidConfig(parsed: any): parsed is TerminalConfig {
        return Boolean(
            parsed &&
            typeof parsed === 'object' &&
            typeof parsed.garage_id === 'string' &&
            parsed.garage_id.trim().length > 0
        );
    }

    public static getConfigStatus(): TerminalConfigState {
        const configPath = this.getConfigPath();
        const backupPath = this.getBackupConfigPath();
        let primaryError: string | undefined;

        if (fs.existsSync(configPath)) {
            try {
                const data = fs.readFileSync(configPath, "utf-8");
                const parsed = JSON.parse(data);
                if (this.isValidConfig(parsed)) {
                    return { status: 'VALID', config: parsed, source: 'PRIMARY' };
                }
                primaryError = 'Missing or invalid garage_id in terminal-config.json';
            } catch (err: any) {
                primaryError = err?.message || String(err);
                console.error("Error reading terminal config:", err);
            }
        }

        if (fs.existsSync(backupPath)) {
            try {
                const backupData = fs.readFileSync(backupPath, "utf-8");
                const parsedBackup = JSON.parse(backupData);
                if (this.isValidConfig(parsedBackup)) {
                    try {
                        fs.writeFileSync(configPath, JSON.stringify(parsedBackup, null, 2), "utf-8");
                    } catch {
                        // Ignore write-back error during recovery
                    }
                    return { status: 'VALID', config: parsedBackup, source: 'BACKUP' };
                }
            } catch (err: any) {
                primaryError = primaryError || (err?.message || String(err));
            }
        }

        if (primaryError) {
            return { status: 'CORRUPT', config: null, source: 'NONE', error: primaryError };
        }

        return { status: 'UNCONFIGURED', config: null, source: 'NONE' };
    }

    public static getConfig(): TerminalConfig | null {
        return this.getConfigStatus().config;
    }

    public static setConfig(config: TerminalConfig): void {
        if (!this.isValidConfig(config)) {
            throw new Error("Cannot persist invalid TerminalConfig without garage_id");
        }
        const configPath = this.getConfigPath();
        const backupPath = this.getBackupConfigPath();
        const tmpPath = configPath + ".tmp";
        const serialized = JSON.stringify(config, null, 2);

        fs.writeFileSync(tmpPath, serialized, "utf-8");
        try {
            fs.renameSync(tmpPath, configPath);
        } catch {
            fs.writeFileSync(configPath, serialized, "utf-8");
            try {
                if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            } catch {}
        }

        try {
            fs.writeFileSync(backupPath, serialized, "utf-8");
        } catch {
            // Non-fatal if backup write fails
        }
    }

    public static clearConfig(): void {
        const configPath = this.getConfigPath();
        const backupPath = this.getBackupConfigPath();
        const tmpPath = configPath + ".tmp";
        for (const p of [configPath, backupPath, tmpPath]) {
            if (fs.existsSync(p)) {
                try {
                    fs.unlinkSync(p);
                } catch {}
            }
        }
    }
}

