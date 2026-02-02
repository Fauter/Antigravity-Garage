import fs from 'fs';
import path from 'path';

export class JsonDB<T extends { id?: string; _id?: string }> {
    private filePath: string;
    private data: T[] = [];

    constructor(filename: string) {
        // Resolve data directory relative to this file's location to be safe, 
        // or relative to process.cwd() if we are sure running from root. 
        // User requested "merely data/[filename].json relative to project root".
        // Assuming project root is where package.json is, which is usually process.cwd()

        const dataDir = path.resolve(process.cwd(), 'src/infrastructure/database/data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Remove .json extension if provided to avoid double extension
        const cleanName = filename.replace(/\.json$/, '');
        this.filePath = path.join(dataDir, `${cleanName}.json`);
        this.load();
    }

    private load() {
        if (fs.existsSync(this.filePath)) {
            try {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                this.data = JSON.parse(raw);
            } catch (err) {
                console.error(`Error loading DB ${this.filePath}:`, err);
                this.data = [];
            }
        } else {
            this.data = [];
            this.save();
        }
    }

    private save() {
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    }

    async reset(): Promise<void> {
        this.data = [];
        this.save();
    }

    async find(query: Partial<T> = {}): Promise<T[]> {
        return this.data.filter(item => {
            return Object.entries(query).every(([key, value]) => {
                return (item as any)[key] === value;
            });
        });
    }

    async findOne(query: Partial<T>): Promise<T | null> {
        const result = this.data.find(item => {
            return Object.entries(query).every(([key, value]) => {
                return (item as any)[key] === value;
            });
        });
        return result || null;
    }

    async create(item: T): Promise<T> {
        const newItem = { ...item };
        // Basic ID generation if not present
        if (!(newItem as any)._id && !(newItem as any).id) {
            (newItem as any)._id = Math.random().toString(36).substring(2, 9);
        }
        this.data.push(newItem);
        this.save();
        return newItem;
    }

    async updateOne(query: Partial<T>, update: Partial<T>): Promise<T | null> {
        const index = this.data.findIndex(item => {
            return Object.entries(query).every(([key, value]) => {
                return (item as any)[key] === value;
            });
        });

        if (index === -1) return null;

        this.data[index] = { ...this.data[index], ...update };
        this.save();
        return this.data[index];
    }

    async getAll(): Promise<T[]> {
        return this.data;
    }

    async getById(id: string): Promise<T | null> {
        return this.findOne({ id } as any) || this.findOne({ _id: id } as any);
    }
}
