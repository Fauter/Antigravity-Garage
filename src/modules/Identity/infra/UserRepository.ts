import { db } from '../../../infrastructure/database/datastore.js';

export interface User {
    id: string;
    nombre: string;
    apellido: string;
    username: string;
    password?: string; // Optional because we might return user without password
    role: string;
}

export class UserRepository {
    constructor() {
    }

    async findByUsername(username: string): Promise<User | null> {
        return await db.employees.findOne({ username }) as User | null;
    }

    async findById(id: string): Promise<User | null> {
        return await db.employees.findOne({ id }) as User | null;
    }
}
