import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { io as Client } from "socket.io-client";
import { startServer } from './src/infrastructure/http/server';
import { MutationQueue } from './src/modules/Sync/infra/MutationQueue';

(async () => {
    console.log('🏁 Iniciando Demo de Sincronización Real-Time...');

    // 1. Iniciar MongoDB Replica Set (Requerido para Change Streams)
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = replSet.getUri();

    // Patch env para que server.ts use esta DB
    process.env.MONGODB_URI = uri;

    // Conectar Mongoose (Global)
    await mongoose.connect(uri);
    console.log('📦 MongoDB Replica Set en memoria iniciado.');

    // 2. Iniciar Servidor
    const httpServer = await startServer();
    // Obtener puerto aleatorio asignado si el default 3000 estuviera ocupado, 
    // pero server.ts usa 3000 hardcoded por defecto.
    // Asumiremos localhost:3000.

    // 3. Conectar Cliente Socket.io simulado
    console.log('🔌 Conectando cliente Socket.io...');
    const socket = Client('http://localhost:3000');

    socket.on('connect', () => {
        console.log('✅ Cliente conectado al servidor.');
    });

    socket.on('SYNC_UPDATE', (data) => {
        console.log('\n✨✨ EVENTO RECIBIDO EN CLIENTE ✨✨');
        console.log('Tipo:', data.entityType);
        console.log('Operación:', data.operation);
        console.log('Payload:', data.payload);
        console.log('✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨\n');

        // Finalizar demo exitosamente
        setTimeout(() => {
            console.log('Demo completada. Apagando...');
            socket.disconnect();
            mongoose.disconnect();
            httpServer.close();
            replSet.stop();
            process.exit(0);
        }, 2000);
    });

    // 4. Generar Mutación (Simular Cobro)
    setTimeout(async () => {
        console.log('\n📝 Generando mutación en base de datos...');
        await MutationQueue.addToQueue(
            'Movement',
            'mov-12345',
            'CREATE',
            { amount: 1500, plate: 'DEMO-888' }
        );
    }, 2000);

})();
