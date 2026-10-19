const fs = require('fs');
let text = fs.readFileSync('src/frontend/src/components/layout/MainLayout.tsx', 'utf8');

text = text.replace(/REINTENTAR CONEXI.N/g, 'REINTENTAR CONEXIÓN');
text = text.replace(/REINTENTAR CONEXIN/g, 'REINTENTAR CONEXIÓN');
text = text.replace(/REINTENTAR CONEXI\uFFFDN/g, 'REINTENTAR CONEXIÓN');
text = text.replace(/REINTENTAR CONEXI\xEF\xBF\xBDN/g, 'REINTENTAR CONEXIÓN');

fs.writeFileSync('src/frontend/src/components/layout/MainLayout.tsx', text, 'utf8');
