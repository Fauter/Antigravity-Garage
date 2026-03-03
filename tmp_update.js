const fs = require('fs');
const path = 'c:/Users/lmfau/OneDrive/Escritorio/Code/ZZZ/Antigravity Garage/src/frontend/src/services/PrinterService.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/font-weight:\s*bold/g, 'font-weight: 900');

const newStyle = `<style>
                @media print {
                    @page { margin: 0; size: 58mm auto; }
                    body { margin: 0; padding: 0; font-weight: 600; color: #000; }
                    .page-break { page-break-after: always; }
                }
                /* Screen styles for PDF/Blob preview */
                body { margin: 0; padding: 0; background: #fff; font-weight: 600; color: #000; }
                .page-break { page-break-after: always; }
                
                b, strong { font-weight: 900 !important; }
                td, th { font-weight: 600; }
            </style>`;

content = content.replace(/<style>[\s\S]*?<\/style>/, newStyle);

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully updated printer styles');
