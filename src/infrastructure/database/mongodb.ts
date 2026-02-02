import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/antigravity_db';

export const connectDB = async (): Promise<void> => {
    try {
        if (mongoose.connection.readyState >= 1) {
            return;
        }

        await mongoose.connect(MONGODB_URI);
        console.log('✅ MongoDB Conectado');
    } catch (error) {
        console.error('❌ Error conectando a MongoDB:', error);
        process.exit(1);
    }
};

export const disconnectDB = async (): Promise<void> => {
    await mongoose.disconnect();
};
