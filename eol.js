const fs = require('fs');
['src/frontend/src/context/AuthContext.tsx'].forEach(file => {
    let text = fs.readFileSync(file, 'utf8');
    text = text.replace(/\r\n/g, '\n');
    fs.writeFileSync(file, text, 'utf8');
});
