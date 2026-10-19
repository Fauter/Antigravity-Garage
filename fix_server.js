const fs = require('fs');
let code = fs.readFileSync('src/infrastructure/http/server.ts', 'utf-8');

// I will just replace the bad lines manually using regexes
code = code.replace(/SELECT json_data FROM stays WHERE json_extract\(json_data, '\$\.id'\) IN \(\) OR json_extract\(json_data, '\$\._id'\) IN \(\);/g, "\SELECT json_data FROM stays WHERE json_extract(json_data, '$.id') IN (\) OR json_extract(json_data, '$._id') IN (\)\;");

code = code.replace(/SELECT json_data FROM movements WHERE json_extract\(json_data, '\$\.id'\) IN \(\);/g, "\SELECT json_data FROM movements WHERE json_extract(json_data, '$.id') IN (\)\;");

fs.writeFileSync('src/infrastructure/http/server.ts', code);
