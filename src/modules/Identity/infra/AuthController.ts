import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { supabase } from '../../../infrastructure/lib/supabase';
import { EmployeeModel } from '../../../infrastructure/database/models.js';

export class AuthController {

    login = async (req: Request, res: Response) => {
        try {
            const { username, password, garage_id } = req.body;

            if (!username || !password) {
                return res.status(400).json({ message: 'Username/Email y password requeridos' });
            }

            console.log(`🔐 Login Attempt: ${username} for Configured Garage: ${garage_id || 'NONE'}`);

            const isEmail = username.includes('@');
            let authenticatedUser: any = null;

            // --- 1. AUTHENTICATE USER (Remote or Local) ---

            // A. REMOTE FIRST (Cloud Priority)
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

            // B. LOCAL FALLBACK (Offline Resilience)
            // Strict Check: Only attempt Mongoose query if completely connected.
            if (!authenticatedUser && !isEmail) {
                if (mongoose.connection.readyState === 1) {
                    try {
                        const localUser = await EmployeeModel.findOne({ username }).maxTimeMS(2000);
                        if (localUser && localUser.passwordHash === password) {
                            const obj = localUser.toObject();
                            authenticatedUser = {
                                id: obj.id,
                                username: obj.username,
                                full_name: `${obj.firstName} ${obj.lastName}`,
                                role: obj.role,
                                owner_id: obj.ownerId,
                                garage_id: obj.garageId,
                                permissions: obj.permissions
                            };
                        }
                    } catch (e) {
                        console.error('Local Auth Error', e);
                    }
                } else {
                    console.warn('⚠️ Skipping Local Auth fallback: MongoDB not connected.');
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
                    // Only start sync if we have a Local DB to write to!
                    if (mongoose.connection.readyState === 1) {
                        (async () => {
                            try {
                                const { SyncService } = await import('../../Sync/application/SyncService.js');
                                const syncService = new SyncService();
                                await syncService.pullAllData(garage_id);
                                syncService.initRealtime(garage_id);
                            } catch (syncErr) {
                                console.error('background Sync init Error', syncErr);
                            }
                        })();
                    } else {
                        console.log('⚠️ Skipping Local Sync: MongoDB Disconnected (Cloud-Only Session).');
                    }
                }

                return res.status(200).json({
                    id: authenticatedUser.id,
                    username: authenticatedUser.username || authenticatedUser.email,
                    full_name: authenticatedUser.full_name || authenticatedUser.username,
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
