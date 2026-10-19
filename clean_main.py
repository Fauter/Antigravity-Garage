import re

with open('main.js', 'r', encoding='utf-8') as f:
    text = f.read()

text = re.sub(r"console\.log\('\[STARTUP (\d+)\] (.*?)'\);", r"if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] \2');", text)
text = re.sub(r"console\.log\(`\[STARTUP (\d+)\] (.*?)`\);", r"if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log(`[ELECTRON:TRACE] \2`);", text)
text = re.sub(r"console\.log\('\[STARTUP (\d+)\] (.*?)', (.*?)\);", r"if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] \2', \3);", text)
text = re.sub(r"console\.log\('📦 \[PROD\] (.*?)'\);", r"if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] PROD \1');", text)
text = re.sub(r"console\.log\('🚀 \[DEV\] (.*?)'\);", r"if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] DEV \1');", text)
text = re.sub(r"console\.log\('✅ Servidor cargado exitosamente\.'\);", r"", text)

with open('main.js', 'w', encoding='utf-8') as f:
    f.write(text)
