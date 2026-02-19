import { Request, Response } from 'express';
import { supabase } from '../../../infrastructure/lib/supabase';
import { db } from '../../../infrastructure/database/datastore.js';
import { syncService } from '../../Sync/application/SyncService.js';

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

            // B. LOCAL FALLBACK (Offline Resilience - NeDB)
            if (!authenticatedUser && !isEmail) {
                try {
                    // NeDB findOne
                    const localUser: any = await db.employees.findOne({ username });

                    if (localUser && localUser.passwordHash === password) {
                        authenticatedUser = {
                            id: localUser.id,
                            username: localUser.username,
                            full_name: `${localUser.firstName} ${localUser.lastName}`,
                            first_name: localUser.firstName,
                            last_name: localUser.lastName,
                            role: localUser.role,
                            owner_id: localUser.ownerId,
                            garage_id: localUser.garageId,
                            permissions: localUser.permissions
                        };
                        console.log('✅ Local Auth Success (NeDB)');
                    }
                } catch (e) {
                    console.error('Local Auth Error', e);
                }
            }

            // --- 2. VALIDATE IDENTITY VS TERMINAL CONFIG ---
            if (authenticatedUser) {

                if (garage_id) {
                    console.log(`🛡️ Validating Access to Garage ${garage_id}`);

                    const { data: garage, error: garageError } = await supabase
                        .from('garages')
                        .select('owner_id')
                        .eq('id', garage_id)
                        .single();

                    if (garage) {
                        if (authenticatedUser.owner_id !== garage.owner_id) {
                            console.warn(`⛔ Access Denied: Owner Mismatch.`);
                            return res.status(403).json({ message: 'Personal no autorizado (Dueño Incorrecto).' });
                        }
                    } else if (garageError) {
                        console.warn('⚠️ Could not verify Garage Owner online.');
                    }

                    // --- 3. TRIGGER SYNC (Bootstrap) ---
                    if (garage_id) {
                        (async () => {
                            try {
                                console.log('🔄 Init Bootstrap for:', garage_id);
                                console.log('💉 Injecting SyncService. Available methods:', Object.keys(syncService || {}));
                                await syncService.pullAllData(garage_id);
                                syncService.initRealtime(garage_id);
                            } catch (syncErr) {
                                console.error('background Sync init Error', syncErr);
                            }
                        })();
                    }
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
