import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/antigravity_db';

// Disable buffering. Fail fast if no connection.
mongoose.set('bufferCommands', false);

export const connectDB = async (): Promise<void> => {
    try {
        if (mongoose.connection.readyState >= 1) {
            return;
        }

        console.log('🔌 Connecting to MongoDB Local...');

        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
            family: 4 // Use IPv4, skip IPv6 (faster lookup)
        });

        console.log('✅ MongoDB Conectado');
    } catch (error) {
        // Log Error but DO NOT KILL PROCESS
        console.warn('⚠️ MongoDB Local no detectado. Iniciando en modo "Cloud-Only" (Supabase).');
        // console.error(error); // Optional verbose log
    }
};

export const disconnectDB = async (): Promise<void> => {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
};
