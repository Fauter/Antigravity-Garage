import { Request, Response } from 'express';
import { supabase } from '../../../infrastructure/lib/supabase';
import { db } from '../../../infrastructure/database/datastore.js';
import { syncService } from '../../Sync/application/SyncService.js';
import { loadHardwareConfig } from '../../../hardware/config/hardware.config.js';
import { StorageEngine } from '../../../infrastructure/database/StorageEngine.js';
import { SQLiteManager } from '../../../infrastructure/database/sqlite/SQLiteManager.js';
export class AuthController {

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

            console.log(`🔐 Login Attempt: ${username} for Configured Garage: ${garage_id || 'NONE'}`);

            const isEmail = username.includes('@');
            let authenticatedUser: any = null;

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

                    if (profiles && profiles.length > 0) {
                        authenticatedUser = { ...profiles[0], role: 'OWNER', owner_id: profiles[0].id };
                    }
                } else {
                    // Employee
                    const { data: employees, error: empError } = await supabase
                        .from('employee_accounts')
                        .select('*')
                        .eq('username', username)
                        .limit(1);

                    if (employees && employees.length > 0 && employees[0].password_hash === password) {
                        authenticatedUser = employees[0];
                    }
                }
            } catch (err) {
                console.warn('⚠️ Cloud Auth Unreachable');
            }

            // B. LOCAL FALLBACK (Offline Resilience)
            if (!authenticatedUser && !isEmail) {
                try {
                    // B.1 Check Hardware Config for Admin PIN fallback
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
                        console.log('o. Local Auth Success (Hardware Config PIN)');
                    }

                    // B.2 Check Local Employees (SQLite or NeDB)
                    if (!authenticatedUser) {
                        let localUser: any = null;

                        if (StorageEngine.getEngine() === 'SQLITE') {
                            const dbSq = SQLiteManager.getInstance().getDatabase();
                            // json_data stores the employee row as pulled from supabase (e.g. username, password_hash)
                            // Supabase employee_accounts use 'password_hash' and 'username'
                            // We need to parse json_data and check manually, or use JSON_EXTRACT
                            const rows = dbSq.prepare("SELECT json_data FROM employees").all();
                            for (const row of rows as any[]) {
                                const parsed = JSON.parse(row.json_data);
                                // The pulled data might be camelCased by SqliteSyncCoordinator (passwordHash vs password_hash)
                                // Handle both cases for robustness
                                if (parsed.username === username) {
                                    localUser = parsed;
                                    break;
                                }
                            }
                        } else {
                            localUser = await db.employees.findOne({ username });
                        }

                        if (localUser) {
                            const pwMatch = localUser.passwordHash === password || localUser.password_hash === password;
                            if (pwMatch) {
                                authenticatedUser = {
                                    id: localUser.id,
                                    username: localUser.username,
                                    full_name: localUser.full_name || `${localUser.firstName || localUser.first_name || ''} ${localUser.lastName || localUser.last_name || ''}`.trim(),
                                    first_name: localUser.firstName || localUser.first_name,
                                    last_name: localUser.lastName || localUser.last_name,
                                    role: localUser.role,
                                    owner_id: localUser.ownerId || localUser.owner_id,
                                    garage_id: localUser.garageId || localUser.garage_id,
                                    permissions: localUser.permissions
                                };
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

                    try {
                        let garageOwnerId: string | null = null;
                        
                        // 1. Check local SQLite first
                        if (StorageEngine.getEngine() === 'SQLITE') {
                            const dbSq = SQLiteManager.getInstance().getDatabase();
                            const localGarage = dbSq.prepare("SELECT json_data FROM garages WHERE id = ?").get(garage_id) as any;
                            if (localGarage) {
                                const parsedGarage = JSON.parse(localGarage.json_data);
                                garageOwnerId = parsedGarage.ownerId || parsedGarage.owner_id;
                            }
                        } else {
                            const localGarage = await db.garages.findOne({ id: garage_id });
                            if (localGarage) {
                                garageOwnerId = (localGarage as any).ownerId || (localGarage as any).owner_id;
                            }
                        }

                        // 2. Fallback to Supabase if not found locally
                        if (!garageOwnerId) {
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
                        }

                        // 3. Validate
                        if (garageOwnerId) {
                            if (authenticatedUser.owner_id !== garageOwnerId && authenticatedUser.owner_id !== 'UNKNOWN') {
                                console.warn(`>" Access Denied: Owner Mismatch.`);
                                return res.status(403).json({ message: 'Personal no autorizado (Dueño Incorrecto).' });
                            }
                        } else {
                            console.warn('s? Garage owner validation failed - could not resolve owner locally or remotely');
                        }
                    } catch (gErr) {
                        console.warn('s? Garage validation failed due to error', gErr);
                    }

                                        // --- 3. Removed Trigger Sync (Now handled by Frontend Initial Hydration Gate) ---
                }

                return res.status(200).json({
                    id: authenticatedUser.id,
                    username: authenticatedUser.username || authenticatedUser.email,
                    // Prioritize existing full_name, or construct it, or fallback.
                    full_name: authenticatedUser.full_name || (authenticatedUser.first_name && authenticatedUser.last_name ? `${authenticatedUser.first_name} ${authenticatedUser.last_name}` : authenticatedUser.username),
                    // SEND RAW NAMES for Frontend Logic
                    first_name: authenticatedUser.first_name,
                    last_name: authenticatedUser.last_name,
                    role: authenticatedUser.role,
                    owner_id: authenticatedUser.owner_id,
                    garage_id: authenticatedUser.garage_id,
                    permissions: authenticatedUser.permissions
                });
            }

            return res.status(401).json({ message: 'Credenciales inválidas' });

        } catch (error: any) {
            console.error('Login internal error:', error);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
    };
}
