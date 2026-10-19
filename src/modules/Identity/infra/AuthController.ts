import { Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../../../infrastructure/lib/supabase';
import { db } from '../../../infrastructure/database/datastore.js';
import { syncService } from '../../Sync/application/SyncService.js';
import { loadHardwareConfig } from '../../../hardware/config/hardware.config.js';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager.js';
import { TerminalConfigManager } from '../../../infrastructure/config/TerminalConfigManager.js';
import { OpsLogger } from '../../../shared/OpsLogger.js';

function isNetworkFailure(err: any): boolean {
    if (!err) return false;
    const msg = String(err.message || err.details || err || '').toLowerCase();
    const code = String(err.code || '').toUpperCase();
    return (
        msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('timeout') ||
        msg.includes('enotfound') ||
        msg.includes('econnrefused') ||
        msg.includes('econnreset') ||
        msg.includes('offline') ||
        msg.includes('unreachable') ||
        code === 'ENOTFOUND' ||
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNRESET'
    );
}

function createPasswordVerifier(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(password, salt, 32).toString('hex');
    return `${salt}:${derived}`;
}

function verifyPasswordVerifier(password: string, verifier?: string): boolean {
    if (!verifier || typeof verifier !== 'string' || !verifier.includes(':')) return false;
    try {
        const [salt, expectedHex] = verifier.split(':');
        if (!salt || !expectedHex) return false;
        const derived = crypto.scryptSync(password, salt, 32).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(expectedHex, 'hex'));
    } catch {
        return false;
    }
}

export class AuthController {

    private async cacheLocalAuthenticatedUser(userRecord: any, password: string): Promise<void> {
        if (!userRecord || !userRecord.id) return;
        const verifier = createPasswordVerifier(password);
        const docToSave: any = {
            id: userRecord.id,
            username: userRecord.username || userRecord.email,
            email: userRecord.email || undefined,
            full_name: userRecord.full_name || `${userRecord.first_name || ''} ${userRecord.last_name || ''}`.trim() || userRecord.username || userRecord.email,
            first_name: userRecord.first_name,
            last_name: userRecord.last_name,
            firstName: userRecord.first_name || userRecord.firstName,
            lastName: userRecord.last_name || userRecord.lastName,
            role: userRecord.role,
            owner_id: userRecord.owner_id || userRecord.ownerId,
            ownerId: userRecord.owner_id || userRecord.ownerId,
            garage_id: userRecord.garage_id || userRecord.garageId || null,
            garageId: userRecord.garage_id || userRecord.garageId || null,
            permissions: userRecord.permissions,
            password_verifier: verifier,
            updatedAt: new Date().toISOString()
        };
        // Preserve existing password_hash if came from employee_accounts (do not store plaintext for owners)
        if (userRecord.password_hash) {
            docToSave.password_hash = userRecord.password_hash;
            docToSave.passwordHash = userRecord.password_hash;
        }

        try {
            await db.employees.update({ id: docToSave.id }, docToSave, { upsert: true });
        } catch {}

        try {
            const dbSq = SQLiteManager.getInstance().getDatabase();
            dbSq.prepare(`
                INSERT INTO employees (id, json_data)
                VALUES (?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    json_data = excluded.json_data
            `).run(docToSave.id, JSON.stringify(docToSave));
        } catch {}
    }

    private async findLocalUser(username: string): Promise<any | null> {
        const searchSqlite = (): any | null => {
            try {
                const dbSq = SQLiteManager.getInstance().getDatabase();
                const rows = dbSq.prepare("SELECT json_data FROM employees").all() as any[];
                for (const row of rows) {
                    const parsed = JSON.parse(row.json_data);
                    if (parsed.username === username || parsed.email === username) {
                        return parsed;
                    }
                }
            } catch {}
            return null;
        };

        const searchNeDB = async (): Promise<any | null> => {
            try {
                const found = await db.employees.findOne({
                    $or: [{ username }, { email: username }]
                });
                if (found) return found;
            } catch {}
            return null;
        };

        if (StorageEngine.getEngine() === 'SQLITE') {
            return searchSqlite() || (await searchNeDB());
        } else {
            return (await searchNeDB()) || searchSqlite();
        }
    }

    private async resolveLocalGarageOwnerId(garageId: string): Promise<string | null> {
        if (!garageId) return null;

        const checkSqlite = (): string | null => {
            try {
                const dbSq = SQLiteManager.getInstance().getDatabase();
                const localGarage = dbSq.prepare("SELECT json_data FROM garages WHERE id = ?").get(garageId) as any;
                if (localGarage?.json_data) {
                    const parsedGarage = JSON.parse(localGarage.json_data);
                    return parsedGarage.ownerId || parsedGarage.owner_id || null;
                }
            } catch {}
            return null;
        };

        const checkNeDB = async (): Promise<string | null> => {
            try {
                const localGarage = await db.garages.findOne({ $or: [{ id: garageId }, { _id: garageId }] });
                if (localGarage) {
                    return (localGarage as any).ownerId || (localGarage as any).owner_id || null;
                }
            } catch {}
            return null;
        };

        let ownerId = StorageEngine.getEngine() === 'SQLITE'
            ? (checkSqlite() || await checkNeDB())
            : (await checkNeDB() || checkSqlite());

        if (!ownerId) {
            try {
                const termCfg = TerminalConfigManager.getConfig();
                if (termCfg && termCfg.garage_id === garageId && termCfg.owner_id) {
                    ownerId = termCfg.owner_id;
                }
            } catch {}
        }

        return ownerId;
    }

    login = async (req: Request, res: Response) => {
        try {
            // Extract garage_id from body OR header (Hybrid support)
            let { username, password, garage_id } = req.body;

            if (!garage_id) {
                garage_id = req.headers['x-garage-id'] as string;
            }

            if (!username || !password) {
                return res.status(400).json({ message: 'Username/Email y password requeridos' });
            }

            // Canonical terminal config check (prevent client-side localStorage garage_id tampering)
            const terminalCfg = TerminalConfigManager.getConfig();
            if (!garage_id && terminalCfg?.garage_id) {
                garage_id = terminalCfg.garage_id;
            }
            if (terminalCfg?.garage_id && garage_id && garage_id !== terminalCfg.garage_id) {
                OpsLogger.warnText('AUTH', '[SECURITY] Login rechazado: garage_id solicitado no coincide con terminal-config', {
                    requestedGarageId: garage_id,
                    configuredGarageId: terminalCfg.garage_id,
                    username
                });
                return res.status(403).json({
                    message: 'El garaje solicitado no coincide con la configuración de esta terminal.',
                    code: 'TERMINAL_GARAGE_MISMATCH'
                });
            }

            console.log(`🔐 Login Attempt: ${username} for Configured Garage: ${garage_id || 'NONE'}`);

            const isEmail = username.includes('@');
            let authenticatedUser: any = null;
            let authMode: 'ONLINE' | 'OFFLINE_LOCAL' | 'OFFLINE_ADMIN_PIN' = 'ONLINE';
            let cloudUnreachable = false;
            let remoteAuthenticated = false;
            let remotePasswordVerified = false;
            let remoteRejectedCredentials = false;

            // --- 1. AUTHENTICATE USER (Remote or Local) ---

            // A. REMOTE FIRST (Cloud Priority) - If Supabase reachable
            try {
                if (isEmail) {
                    // Owner (Profiles)
                    const { data: profiles, error: profError } = await supabase
                        .from('profiles')
                        .select('*')
                        .eq('email', username)
                        .limit(1);

                    if (profError) {
                        if (isNetworkFailure(profError)) cloudUnreachable = true;
                    } else if (profiles && profiles.length > 0) {
                        const profile = profiles[0] as any;
                        const existingLocalOwner = await this.findLocalUser(username);
                        if (profile.password_hash) {
                            if (profile.password_hash === password) {
                                authenticatedUser = { ...profile, role: 'OWNER', owner_id: profile.id };
                                remoteAuthenticated = true;
                                remotePasswordVerified = true;
                            } else {
                                remoteRejectedCredentials = true;
                            }
                        } else if (existingLocalOwner?.password_verifier) {
                            if (verifyPasswordVerifier(password, existingLocalOwner.password_verifier)) {
                                authenticatedUser = { ...profile, role: 'OWNER', owner_id: profile.id };
                                remoteAuthenticated = true;
                                remotePasswordVerified = true;
                            } else {
                                remoteRejectedCredentials = true;
                            }
                        } else {
                            authenticatedUser = { ...profile, role: 'OWNER', owner_id: profile.id };
                            remoteAuthenticated = true;
                            remotePasswordVerified = true;
                        }
                    }
                } else {
                    // Employee
                    const { data: employees, error: empError } = await supabase
                        .from('employee_accounts')
                        .select('*')
                        .eq('username', username)
                        .limit(1);

                    if (empError) {
                        if (isNetworkFailure(empError)) cloudUnreachable = true;
                    } else if (employees && employees.length > 0) {
                        if (employees[0].password_hash === password) {
                            authenticatedUser = employees[0];
                            remoteAuthenticated = true;
                            remotePasswordVerified = true;
                        } else {
                            // User exists in cloud and password did not match: do NOT fall back to a stale local password
                            remoteRejectedCredentials = true;
                        }
                    }
                }
            } catch (err) {
                cloudUnreachable = true;
                console.warn('⚠️ Cloud Auth Unreachable');
            }

            // B. LOCAL FALLBACK (Offline Resilience - only when cloud did not explicitly reject credentials)
            let localUserFound = false;
            if (!authenticatedUser && !remoteRejectedCredentials) {
                try {
                    // B.1 Check Hardware Config for Admin PIN fallback
                    if (!isEmail) {
                        const hwConfig = loadHardwareConfig();
                        if (username === 'admin' && hwConfig.adminPinHash && hwConfig.adminPinHash === password) {
                            authenticatedUser = {
                                id: 'local-admin-fallback',
                                username: 'admin',
                                full_name: 'Administrador Local (Hardware)',
                                first_name: 'Administrador',
                                last_name: 'Local',
                                role: 'ADMIN',
                                owner_id: garage_id || 'UNKNOWN',
                                garage_id: garage_id || 'UNKNOWN',
                                permissions: ['ALL']
                            };
                            authMode = 'OFFLINE_ADMIN_PIN';
                            console.log('o. Local Auth Success (Hardware Config PIN)');
                        }
                    }

                    // B.2 Check Local Employees / Cached Profiles (SQLite and NeDB)
                    if (!authenticatedUser) {
                        const localUser = await this.findLocalUser(username);

                        if (localUser) {
                            localUserFound = true;
                            const pwMatch =
                                localUser.passwordHash === password ||
                                localUser.password_hash === password ||
                                verifyPasswordVerifier(password, localUser.password_verifier);

                            if (pwMatch) {
                                authenticatedUser = {
                                    id: localUser.id,
                                    username: localUser.username || localUser.email,
                                    full_name: localUser.full_name || `${localUser.firstName || localUser.first_name || ''} ${localUser.lastName || localUser.last_name || ''}`.trim() || localUser.username,
                                    first_name: localUser.firstName || localUser.first_name,
                                    last_name: localUser.lastName || localUser.last_name,
                                    role: localUser.role,
                                    owner_id: localUser.ownerId || localUser.owner_id,
                                    garage_id: localUser.garageId || localUser.garage_id,
                                    permissions: localUser.permissions
                                };
                                authMode = 'OFFLINE_LOCAL';
                                console.log('✅ Local Auth Success');
                            }
                        }
                    }
                } catch (e) {
                    console.error('Local Auth Error', e);
                }
            }

            // --- 2. VALIDATE IDENTITY VS TERMINAL CONFIG ---
            if (authenticatedUser) {

                if (garage_id) {
                    console.log(`🛡️ Validating Access to Garage ${garage_id}`);

                    let garageOwnerId: string | null = await this.resolveLocalGarageOwnerId(garage_id);

                    // 2. Fallback to Supabase if not found locally
                    if (!garageOwnerId) {
                        try {
                            const { data: garage, error: garageError } = await supabase
                                .from('garages')
                                .select('owner_id')
                                .eq('id', garage_id)
                                .single();

                            if (garage) {
                                garageOwnerId = garage.owner_id;
                            } else if (garageError) {
                                console.warn('s? Could not verify Garage Owner online.');
                            }
                        } catch {
                            console.warn('s? Could not verify Garage Owner online.');
                        }
                    }

                    // 3. Validate (Fail-Closed Multi-Tenant Isolation)
                    if (garageOwnerId) {
                        if (authenticatedUser.owner_id !== garageOwnerId && authenticatedUser.owner_id !== 'UNKNOWN') {
                            console.warn(`>" Access Denied: Owner Mismatch.`);
                            return res.status(403).json({
                                message: 'Personal no autorizado (Dueño Incorrecto).',
                                code: 'UNAUTHORIZED_GARAGE'
                            });
                        }
                    } else if (authenticatedUser.owner_id !== 'UNKNOWN') {
                        console.warn('s? Garage owner validation failed - could not resolve owner locally or remotely');
                        return res.status(403).json({
                            message: 'No se pudo verificar la pertenencia del garaje solicitado.',
                            code: 'UNAUTHORIZED_GARAGE'
                        });
                    }
                }

                // Cache verified remote user locally for future offline authentication
                if (remoteAuthenticated && remotePasswordVerified) {
                    await this.cacheLocalAuthenticatedUser(authenticatedUser, password);
                }

                OpsLogger.infoText('AUTH', `[OK] Login autorizado (${authMode})`, {
                    username: authenticatedUser.username || authenticatedUser.email,
                    role: authenticatedUser.role,
                    garageId: garage_id || authenticatedUser.garage_id || 'NONE'
                });

                return res.status(200).json({
                    id: authenticatedUser.id,
                    username: authenticatedUser.username || authenticatedUser.email,
                    full_name: authenticatedUser.full_name || (authenticatedUser.first_name && authenticatedUser.last_name ? `${authenticatedUser.first_name} ${authenticatedUser.last_name}` : authenticatedUser.username),
                    first_name: authenticatedUser.first_name,
                    last_name: authenticatedUser.last_name,
                    role: authenticatedUser.role,
                    owner_id: authenticatedUser.owner_id,
                    garage_id: authenticatedUser.garage_id,
                    permissions: authenticatedUser.permissions,
                    auth_mode: authMode
                });
            }

            if (cloudUnreachable && !localUserFound) {
                OpsLogger.warnText('AUTH', '[OFFLINE] Login rechazado: sin conexión remota y sin evidencia local para el usuario', { username });
                return res.status(401).json({
                    message: 'Sin conexión a internet y el usuario no registra datos locales previos en esta terminal.',
                    code: 'OFFLINE_NO_LOCAL_USER',
                    offline: true
                });
            }

            return res.status(401).json({
                message: 'Credenciales inválidas',
                code: 'INVALID_CREDENTIALS'
            });

        } catch (error: any) {
            console.error('Login internal error:', error);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
    };
}

