const fs = require('fs');
let text = fs.readFileSync('src/frontend/src/components/layout/MainLayout.tsx', 'utf8');
text = text.replace('                            )\r\n                            )\r\n                        // @ts-ignore', '                            )\r\n                        // @ts-ignore');
text = text.replace('                            )\n                            )\n                        // @ts-ignore', '                            )\n                        // @ts-ignore');
fs.writeFileSync('src/frontend/src/components/layout/MainLayout.tsx', text, 'utf8');
