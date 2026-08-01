import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';

export class AlprServiceManager {
    private process: ChildProcess | null = null;
    private isShuttingDown = false;
    private port = 8100;
    private restartAttempts = 0;
    private maxRestarts = 3;

    constructor() {
        app.on('will-quit', () => this.shutdown());
    }

    private resolveServicePath(): { cmd: string, args: string[], cwd: string } {
        const isPackaged = app.isPackaged;
        let cwd: string;
        let cmd: string;
        let args: string[];

        if (isPackaged) {
            // En producción, apuntamos al ejecutable independiente extraído mediante extraResources.
            cwd = path.join(process.resourcesPath, 'alpr_service');
            cmd = path.join(cwd, 'fastalpr.exe');
            args = [];
        } else {
            // En desarrollo, resolvemos desde la raíz real del proyecto (appPath).
            cwd = path.join(app.getAppPath(), 'alpr_service');
            cmd = path.join(cwd, 'venv', 'Scripts', 'python.exe');
            args = ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', this.port.toString()];
        }

        return { cmd, args, cwd };
    }

    private validateAlprInstallation(cwd: string, cmd: string): { ok: boolean, missing: string[] } {
        const missing: string[] = [];

        if (!fs.existsSync(cwd)) {
            missing.push(cwd);
        }

        if (!fs.existsSync(cmd)) {
            missing.push(cmd);
        } else {
            const stat = fs.statSync(cmd);
            if (!stat.isFile()) {
                throw new Error(`La ruta ALPR no es un archivo válido: ${cmd}`);
            }
        }

        return { ok: missing.length === 0, missing };
    }

    private handleAlprStartupFailure(error: any) {
        console.error(`❌ [AlprServiceManager] Fallo crítico al iniciar FastALPR:`, error.message || error);
        this.process = null;
        // No arrojamos la excepción globalmente. El servicio queda desactivado.
    }

    async start(): Promise<boolean> {
        if (this.process) {
            console.log('⚠️ [AlprServiceManager] El proceso ya se encuentra activo.');
            return true;
        }

        const { cmd, args, cwd } = this.resolveServicePath();

        const validation = this.validateAlprInstallation(cwd, cmd);
        if (!validation.ok) {
            console.warn(`⚠️ [AlprServiceManager] Instalación ALPR incompleta o ausente. Faltan: ${validation.missing.join(', ')}`);
            console.warn(`⚠️ [AlprServiceManager] La aplicación continuará ejecutándose en modo degradado (sin detección automática).`);
            return false; // Evitamos el spawn y el fatal error.
        }

        console.log(`🚀 [AlprServiceManager] Iniciando servicio FastALPR...`);
        console.log(`[AlprServiceManager] CMD: ${cmd}`);
        console.log(`[AlprServiceManager] CWD: ${cwd}`);
        
        try {
            this.process = spawn(cmd, args, { 
                cwd, 
                shell: false, 
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'] 
            });
        } catch (error) {
            this.handleAlprStartupFailure(error);
            return false;
        }

        // Obligatorio en Node para evitar uncaughtExceptions si spawn falla asíncronamente (e.g. ENOENT o EACCES).
        this.process.on('error', (error) => {
            this.handleAlprStartupFailure(error);
        });

        this.process.stdout?.on('data', (data) => {
            // console.log(`[FastALPR] ${data.toString().trim()}`);
        });

        this.process.stderr?.on('data', (data) => {
            const str = data.toString();
            if (str.includes('ERROR') || str.includes('Exception') || str.includes('Warning')) {
                console.error(`[FastALPR STDERR] ${str.trim()}`);
            }
        });

        this.process.on('exit', (code, signal) => {
            if (this.isShuttingDown) return;
            
            console.log(`⚠️ [AlprServiceManager] El servicio finalizó (Código: ${code}, Señal: ${signal})`);
            this.process = null;
            
            if (this.restartAttempts < this.maxRestarts) {
                this.restartAttempts++;
                console.log(`🔄 [AlprServiceManager] Reiniciando servicio (Intento ${this.restartAttempts}/${this.maxRestarts})...`);
                setTimeout(() => this.start(), 2000);
            } else {
                console.error(`❌ [AlprServiceManager] Se alcanzó el máximo de reintentos. Servicio suspendido.`);
            }
        });

        return this.waitForReady();
    }

    private async waitForReady(): Promise<boolean> {
        const url = `http://127.0.0.1:${this.port}/health`;
        const startTime = Date.now();
        const timeoutMs = 30000;

        while (Date.now() - startTime < timeoutMs) {
            // Si el proceso murió prematuramente, interrumpimos la espera.
            if (!this.process && !this.isShuttingDown) {
                return false;
            }

            try {
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json() as any;
                    if (data.status === 'ready') {
                        console.log(`✅ [AlprServiceManager] El servicio está READY.`);
                        this.restartAttempts = 0;
                        return true;
                    }
                }
            } catch (err) {
                // Ignore connection errors while starting
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        console.error(`❌ [AlprServiceManager] Timeout (30s) esperando que el servicio esté ready.`);
        return false;
    }

    shutdown() {
        this.isShuttingDown = true;
        if (this.process) {
            console.log('🛑 [AlprServiceManager] Apagando servicio...');
            try {
                this.process.kill('SIGINT');
            } catch (e) {
                // Ignore kill errors
            }
            this.process = null;
        }
    }

    getUrl(): string {
        return `http://127.0.0.1:${this.port}`;
    }
}
