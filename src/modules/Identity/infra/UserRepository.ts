import { JsonDB } from '../../../infrastructure/database/json-db';


export interface User {
    id: string;
    nombre: string;
    apellido: string;
    username: string;
    password?: string; // Optional because we might return user without password
    role: string;
}

export class UserRepository {
    private db: JsonDB<User>;

    constructor() {
        this.db = new JsonDB<User>('users');
    }

    async findByUsername(username: string): Promise<User | null> {
        const users = await this.db.getAll();
        return users.find(u => u.username === username) || null;
    }

    async findById(id: string): Promise<User | null> {
        return this.db.getById(id);
    }
}
