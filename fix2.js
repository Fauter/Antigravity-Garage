const fs = require('fs');
let text = fs.readFileSync('src/modules/AccessControl/infra/AccessController.ts', 'utf8');
text = text.replace(/if \(vehicleTypeId\) \{                const \{ ConfigRepository \} = require\('\.\.\/\.\.\/Configuration\/infra\/ConfigRepository'\);/g, 'if (vehicleTypeId) {\n                const { ConfigRepository } = require(\'../../Configuration/infra/ConfigRepository\');');
text = text.replace(/DB                const \{ ConfigRepository \}/g, 'DB\n                const { ConfigRepository }');
fs.writeFileSync('src/modules/AccessControl/infra/AccessController.ts', text, 'utf8');
