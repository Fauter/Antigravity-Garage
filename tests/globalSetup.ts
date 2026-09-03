import fs from 'fs';
import path from 'path';

export function teardown() {
    const testDir = path.join(process.cwd(), '.data', 'test');
    if (fs.existsSync(testDir)) {
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
        } catch (e) {
            console.error('Failed to clean up test directory:', e);
        }
    }
}
