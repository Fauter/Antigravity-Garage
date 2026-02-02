const mongoose = require('mongoose');

const TEST_DB_URI = 'mongodb://127.0.0.1:27017/antigravity_test_db';

(async () => {
    try {
        console.log('Intentando conectar a:', TEST_DB_URI);
        await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
        console.log('✅ Conexión Exitosa');
        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error('❌ Error conectando:', err.message);
        process.exit(1);
    }
})();
