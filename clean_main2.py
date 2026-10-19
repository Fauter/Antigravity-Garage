import re

with open('main.js', 'r', encoding='utf-8') as f:
    text = f.read()

text = re.sub(r"console\.log\('\[BACKEND_WAIT\] (.*?)'\);", r"if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log('[ELECTRON:TRACE] \1');", text)
text = re.sub(r"console\.log\(`\[BACKEND_WAIT\] (.*?)`\);", r"if (process.env.GARAGEIA_LOG_LEVEL === 'debug' || process.env.GARAGEIA_LOG_LEVEL === 'trace') console.log(`[ELECTRON:TRACE] \1`);", text)
text = re.sub(r"console\.error\('\[BACKEND_WAIT\] TIMEOUT:', (.*?)\);", r"console.error('[ELECTRON:FATAL] Backend readiness timeout:', \1);", text)

with open('main.js', 'w', encoding='utf-8') as f:
    f.write(text)
