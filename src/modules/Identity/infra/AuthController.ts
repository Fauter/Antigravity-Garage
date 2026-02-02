import { Request, Response } from 'express';
import { UserRepository } from './UserRepository';

export class AuthController {
    private userRepo: UserRepository;

    constructor() {
        this.userRepo = new UserRepository();
    }

    login = async (req: Request, res: Response) => {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({ message: 'Username y password requeridos' });
            }

            const user = await this.userRepo.findByUsername(username);

            if (!user) {
                return res.status(401).json({ message: 'Credenciales inválidas' });
            }

            // Plain text password check for prototype as requested
            if (user.password !== password) {
                return res.status(401).json({ message: 'Credenciales inválidas' });
            }

            // Return user without password
            const { password: _, ...userWithoutPassword } = user;

            return res.status(200).json(userWithoutPassword);

        } catch (error) {
            console.error('Login error:', error);
            return res.status(500).json({ message: 'Error interno del servidor' });
        }
    };
}
