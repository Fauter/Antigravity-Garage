import re

def hide_log(file_path, pattern):
    with open(file_path, 'r', encoding='utf-8') as f:
        text = f.read()
    text = re.sub(pattern, r"if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log(\g<1>);", text)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(text)

hide_log('src/infrastructure/database/datastore.ts', r"console\.log\((`📦 Local Datastore initialized.*?`)\);")
hide_log('src/infrastructure/database/sqlite/SQLiteManager.ts', r"console\.log\((`🗄️ SQLite: Inicializando en.*?`)\);")
hide_log('src/infrastructure/database/sqlite/SQLiteManager.ts', r"console\.log\((`🗄️ SQLite Engine activo.*?`)\);")
hide_log('src/infrastructure/http/server.ts', r"console\.log\((`✅ \[PROD\] Sirviendo Frontend desde:.*?`)\);")
hide_log('src/infrastructure/lib/supabase.ts', r"console\.log\((`🔗 Supabase Client Initialized:.*?`)\);")
