const fs = require('fs');
let text = fs.readFileSync('src/frontend/src/components/layout/MainLayout.tsx', 'utf8');

text = text.replace(/perdiÃ³/g, 'perdió');
text = text.replace(/conexiÃ³/g, 'conexión');
text = text.replace(/CONEXIÃ“N/g, 'CONEXIÓN');
text = text.replace(/dejÃ³/g, 'dejó');
text = text.replace(/crÃ­tico/g, 'crítico');

fs.writeFileSync('src/frontend/src/components/layout/MainLayout.tsx', text, 'utf8');
